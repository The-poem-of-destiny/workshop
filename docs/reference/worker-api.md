# Worker HTTP API 参考

本文描述 `apps/worker/src/app.ts` 挂载的外部 HTTP 路由，不包含 ContentService 等 Durable Object 的内部接口。部署、绑定和允许的来源见[运行时配置](runtime-configuration.md)；宿主集成见[宿主协议](host-protocol.md)。请求和响应的复杂字段、枚举与限制以 [`packages/contracts/src`](../../packages/contracts/src/) 中的 Zod schema 为准；各路由的实际解析及状态以 [`apps/worker/src/http/routes`](../../apps/worker/src/http/routes/) 为准。表中省略的成功状态为 200；`id`、`revisionId`、`submissionId`、`projectId` 等为路径参数。

## 通用约定

- 登录接口以外，受保护请求使用 `Authorization: Bearer <session token>`。角色为 `member`、`reviewer`、`owner`；reviewer 接口也允许 owner。作者操作要求项目作者或 owner，权限不足的项目通常表现为 404，而非披露其存在。
- API JSON 错误格式为 `{ "error": { "code": "...", "message": "...", "details": ... } }`，`details` 可省略。状态映射见 [errors.ts](../../packages/contracts/src/errors.ts)：400 `bad_request`、401 `unauthorized`、403 `forbidden`、404 `not_found`、409 `conflict`、412 `precondition_failed`、413 `payload_too_large`、415 `unsupported_media_type`、426 `upgrade_required`、429 `rate_limited`、500 `internal`。校验错误可能带 Zod details；未捕获异常返回 500。callback 返回 HTML 而不是此 JSON 格式。
- 非公开缓存路径默认 `Cache-Control: private, no-store`；入口白名单中的匿名公开响应和静态资源具有不同缓存语义，详见[运行时配置](runtime-configuration.md#公开缓存和私有绕过)。API 的 OPTIONS 仅对 `ALLOWED_ORIGINS` 中精确匹配的 Origin 返回 204，否则 403；允许的方法为 GET、POST、PUT、PATCH、DELETE、OPTIONS，允许的请求头为 `authorization,content-type,if-match,x-client-version,x-client-channel`。普通 API 响应对允许的 Origin 设置 CORS；不应假设预检支持其他头。
- 项目列表使用不透明 `cursor` 和 `nextCursor`；下一页保留原有排序与筛选条件，传入返回的 cursor。`total` 为完整筛选集数量，不是本页数量。管理列表也返回 `nextCursor`；其参数和响应分别见 [admin.ts](../../packages/contracts/src/admin.ts) 与 [admin-dto.ts](../../packages/contracts/src/admin-dto.ts)。无更多结果时 cursor 为 null。

应用运行时的 D1/R2 I/O 经同一 Worker 的 `DataService` 和 `CachedReads` 具名入口；公开读取使用内部 fetch，实时业务使用 RPC，文件通过内部 fetch 流式传输。ContentService 保留 Durable Object 内的检查计算，并通过 `state.exports` 请求数据。入口及客户端类型与静态检查约束代码边界，不是 Cloudflare 绑定权限隔离；发布、备份和迁移工具保留受控运维通道。

## 登录和会话

`POST /api/v1/auth/flows` 必须带配置允许的 `Origin` 和 JSON `{"mode":"browser"}`、`{"mode":"device"}` 或 `{"mode":"embed","codeChallenge":"..."}`，成功 201，返回 id、state、url、expiresAt、mode，device 还返回 deviceCode，并设置浏览器绑定 cookie。流程有效期 10 分钟。embed 的 challenge 是客户端 verifier 的 SHA-256 base64url 值；Discord 自身 OAuth 使用独立的服务端 PKCE。无效输入 400，来源不允许 403，Discord 身份组配置错误 500。服务端以 Discord 用户、服务器成员身份及可选身份组要求决定登录资格。

| 方法和路径 | 输入、权限和结果 |
| --- | --- |
| GET `/api/v1/auth/flows/:id` | 查询状态和过期时间。device 需 `?deviceCode=...` 或 `x-device-secret`，device/embed 还需原浏览器绑定 cookie；不匹配 404。browser 状态查询不要求绑定。浏览器跨源预检不允许 `x-device-secret`，可使用查询参数。 |
| POST `/api/v1/auth/flows/:id/redeem` | JSON 见 `authFlowRedeemSchema`。device 使用 `deviceCode`；embed 使用 callback 交付的 `code` 和原 `verifier`。需原绑定 cookie，成功返回 token、expiresAt、user；错误 secret 403，未授权、过期或已兑换 409。browser 不走此兑换流程。 |
| GET `/api/v1/auth/callback` | Discord 回调的 `state`、`code` 或 `error`；返回 HTML，向 opener 发送消息。browser 的 `oauth-success` 包含 session token 和 state；embed 的 `oauth-code` 包含 code、flowId、state；device 的 `oauth-authorized` 通知授权完成。回调错误为 HTML 400，重复使用可为 409。 |
| DELETE `/api/v1/sessions/current` | Bearer 会话；撤销后 204，无会话 401。 |

例如，同源浏览器创建 browser 流后打开响应中的 URL；校验 callback 消息的来源和 state，使用消息中的 token 请求 `/api/v1/me`。device/embed 必须保留创建流时的绑定 cookie，让 OAuth callback 和兑换请求使用同一浏览器上下文；device 状态查询还要提供 deviceCode。不要把 token、deviceCode 或兑换 code 写入日志。

## 发现、项目和下载

以下路径以 `/api/v1` 为前缀。公开读取不要求会话；私有发布内容的读取权限由各 handler 和 storage 判定。

公开项目的 `updatedAt` 表示当前发布修订的发布时间，草稿编辑不会改变该值或按更新时间的排序。人工批准和自动发布在切换发布版本时原子更新该时间；历史数据按当前修订的最近批准时间回填，缺失时回退至发布时间或修订创建时间。公开缓存可能暂时展示旧值。

| 方法和路径 | 输入、成功结果及特殊错误 |
| --- | --- |
| GET `/health` | 服务版本和 DB、R2、ASSETS 绑定是否存在；不是依赖连通性检查。 |
| GET `/home` | 返回 `site`、`discovery`、`projects` 三段；每段为 `{ok:true,data}` 或 `{ok:false,error}`。全部成功为公开 200，部分失败为 no-store 200，全部失败为 no-store 500。默认项目列表等价于无筛选的 `/projects`。 |
| GET `/projects` | `limit` 1–50 默认 25；`cursor`、`sort`、`period`、`projectType`、`authorId`、`tag`、`search`；合法值见 [projects.ts](../../packages/contracts/src/projects.ts)。非法查询或 cursor 400。 |
| GET `/projects/batch` | 唯一 `ids` 参数为逗号分隔的 1–50 个 ID，trim、去重并按字典序排列；响应 `{items,missingIds}`，隐藏或不存在的项目只列入 missingIds。空项、重复参数或未知非 tracking 参数为 400。 |
| GET `/projects/discovery` | 发现项目列表。 |
| GET `/projects/rankings` | `kind=daily\|7d\|30d`，默认 `7d`；其他值 400。 |
| GET `/projects/:id` | 已发布项目详情；不存在或不可公开访问 404。 |
| GET `/projects/:id/entries` | 已发布项目条目索引；不存在 404。 |
| GET `/projects/:id/preview/:kind` | Bearer；kind 为 `worldbook` 或 `regex`，返回预览；无会话 401，kind 无效 400，不存在 404。 |
| POST `/projects/:id/downloads` | Bearer；对可访问的当前发布版本签发各文件票据，201 `{revisionId, files:[{kind,url,expiresAt}]}`；无发布版本或无权访问 404。 |
| POST `/projects/:id/acquisitions` | Bearer，头 `X-Client-Version` 和 `X-Client-Channel: stable\|staging` 必须匹配该频道当前版本；成功 201，返回 project、release、tickets，见 [acquisitionResponseSchema](../../packages/contracts/src/release.ts)。版本缺失或不匹配 426，发布版本不可访问 404。 |
| GET `/downloads/:token` | Bearer；消耗对应票据并返回文件流、Content-Type、Content-Length、attachment。票据无效、过期、已使用、权限或发布版本变化、文件缺失均为 404。 |
| GET `/recommendations` | `{items}` 推荐列表。 |
| GET `/reference-sets` | 参考集列表。 |
| GET `/reference-sets/:id` | 参考集详情，不存在 404。 |
| GET `/site` | 站点 banner 和内容。 |

票据有效期为 5 分钟，绑定用户及 session version，只能消费一次；消费时重新检查会话、项目可见性、当前发布版本和文件。公共项目的成功消费按用户、项目、UTC 日去重计数；作者、审核者和私有访问不计公开下载数。签发不是下载成功。客户端须使用返回的相对 URL 和同一用户有效 Bearer 会话，不要缓存票据。

可执行示例（设置 `BASE`、`TOKEN`、`PROJECT_ID`，需 `curl` 和 `jq`）：

```sh
curl -fsS -G "$BASE/api/v1/projects" --data-urlencode 'limit=10' > /tmp/workshop-page.json
CURSOR=$(jq -r '.nextCursor // empty' /tmp/workshop-page.json)
[ -z "$CURSOR" ] || curl -fsS -G "$BASE/api/v1/projects" --data-urlencode 'limit=10' --data-urlencode "cursor=$CURSOR"
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/projects/$PROJECT_ID/downloads" > /tmp/workshop-tickets.json
URL=$(jq -r '.files[0].url // empty' /tmp/workshop-tickets.json)
[ -z "$URL" ] || curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE$URL" -o workshop-download
```

## 当前用户与互动

下表均需 Bearer，缺失或失效 401。项目不可互动或不存在时互动操作返回 404。

| 方法和路径（`/api/v1/me` 下） | 输入与结果 |
| --- | --- |
| GET `/` | 当前用户及角色，见 `meResponseSchema`。 |
| GET `/projects` | 当前用户可管理的作者项目列表。 |
| GET `/projects/:id/submissions` | 项目投稿历史，无权或不存在 404。 |
| GET `/subscriptions` | 订阅项目 `{items}`。 |
| GET `/state` | `ids` 为逗号分隔项目 ID，最多 50 个；返回互动状态。 |
| PUT、DELETE `/likes/:id` | 添加或取消点赞，204。 |
| PUT、DELETE `/subscriptions/:id` | 添加或取消订阅，204。 |
| PUT `/ratings/:id` | JSON `ratingInputSchema`，成功 204，无效 JSON 或评分 400。 |
| DELETE `/ratings/:id` | 删除评分，204。 |

## 作者写入和并发

下表均在 `/api/v1/projects` 下，需要 Bearer 和相应项目作者或 owner 权限。请求 JSON schema 见 [authoring.ts](../../packages/contracts/src/authoring.ts)。所有需要版本的操作发送 `If-Match: <rowVersion>`，接受正整数或加引号的正整数；先读取草稿或使用上次写入响应中的新 `rowVersion`。缺少、格式错误或版本过期通常返回 412；部分版本冲突的 `details` 含 `resource`、`expectedVersion`、`currentVersion`。刷新草稿并重新协调变更，不要盲目覆盖。提交冻结的版本不可编辑；元数据更新和新版本创建可能返回 429。

| 方法和路径 | 输入及结果 |
| --- | --- |
| POST `/` | `createProjectSchema`，201 返回 project、rowVersion、workingRevisionId；元数据或 Discord 线程 URL 不合法 400。 |
| GET `/:id/draft` | 返回项目、rowVersion、workingRevisionId、latestSubmission；不存在或无权 404。 |
| PATCH `/:id` | If-Match、`patchProjectSchema`；成功返回更新结果；冻结 409。 |
| DELETE `/:id` | If-Match；软删除，204。 |
| PATCH `/:id/visibility` | If-Match、`{"visibility":"public"}` 或 `private`；返回 rowVersion。 |
| POST `/:id/revisions` | If-Match、`patchProjectSchema`；201 返回 revisionId、rowVersion。 |
| GET `/:id/gallery` | 作者图片及 rowVersion。 |
| PUT `/:id/gallery/:slot` | If-Match、图片原始字节；slot 为 0 或 1；返回 rowVersion、sha256、bytes、mime。 |
| DELETE `/:id/gallery/:slot` | If-Match；删除图片并返回结果。 |
| GET `/:id/revisions/:revisionId/files/:kind` | 返回原始文件；kind 为 `worldbook`、`regex`、`cover`。 |
| PUT `/:id/revisions/:revisionId/files/:kind` | If-Match、原始文件字节；返回 `uploadResponseSchema`；无效内容 400，非工作版本或已冻结版本 404，前置查询后发生编辑状态竞态可返回 409。 |
| DELETE `/:id/revisions/:revisionId/entries/:kind/:entryKey` | If-Match，kind 为 worldbook 或 regex，entryKey URL 编码；成功返回结果，不能从该版本删除时 409。 |
| POST `/:id/revisions/:revisionId/submit` | If-Match、`submitProjectSchema` JSON；201 返回 submissionId、status、checkStatus、rowVersion。仅工作版本可提交，冻结或状态冲突 409；验证服务不可用 500。 |
| POST `/:id/submissions/:submissionId/withdraw` | If-Match；返回结果，已处理或状态变化 409。 |

文件上传需正数 `Content-Length`。worldbook 和 regex 接受 `application/json` 或 `text/plain`，上限 10 MiB，服务端验证内容；cover 和 gallery 接受 PNG、JPEG、WebP，上限 5 MiB。cover 的内容格式必须匹配 MIME，尺寸上限 4096×4096；gallery 另由存储层校验图片和 slot。超限 413，MIME 不支持 415。请求体直接为文件，不是 multipart。

示例：已登录且有写入权限，使用一个合法 worldbook JSON 文件，依次读取版本、上传并提交；每次变更后使用返回的新版本：

```sh
DRAFT=$(curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/projects/$PROJECT_ID/draft")
REVISION_ID=$(printf '%s' "$DRAFT" | jq -r '.workingRevisionId')
VERSION=$(printf '%s' "$DRAFT" | jq -r '.rowVersion')
UPLOAD=$(curl -fsS -X PUT -H "Authorization: Bearer $TOKEN" -H "If-Match: $VERSION" -H 'Content-Type: application/json' --data-binary @worldbook.json "$BASE/api/v1/projects/$PROJECT_ID/revisions/$REVISION_ID/files/worldbook")
VERSION=$(printf '%s' "$UPLOAD" | jq -r '.rowVersion')
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" -H "If-Match: $VERSION" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v1/projects/$PROJECT_ID/revisions/$REVISION_ID/submit"
```

提交还受项目元数据、内容检查和确认要求约束，示例文件不满足实际发布要求时会返回校验错误。示例中的空对象使客户端 gate 为 `missing`，成功提交后为 `pending`、`needs_human`，不会排队自动检查；客户端 gate 为 `pass` 或 `warn` 才排队，服务端检查未阻断时可能自动发布。

## 审核和管理

路径前缀 `/api/v1/admin`。除标注 owner 的操作外，均需 reviewer 或 owner；未登录 401、角色不足 403。JSON 输入见 [admin.ts](../../packages/contracts/src/admin.ts)，响应见 [admin-dto.ts](../../packages/contracts/src/admin-dto.ts)。

| 方法和路径 | 输入及结果 |
| --- | --- |
| GET `/submissions` | `status` 为逗号分隔状态，默认 pending；`limit` 默认 20、最大 100，`cursor` 可选。返回 counts、items、nextCursor。 |
| GET `/submissions/:id` | 投稿详情，不存在 404。 |
| GET `/submissions/:id/files/:kind` | worldbook、regex、cover 原始文件；无效 kind 400，文件不存在 404。 |
| GET `/submissions/:id/diff` | 投稿 diff，不存在 404。 |
| POST `/submissions/:id/recheck` | 重新排队检查，202；已解决或检查进行中 409。 |
| POST `/submissions/:id/review` | `adminReviewRequestSchema`，approve 或 reject；拒绝必须有非空理由，客户端 gate 为 `block`、`missing` 或服务端 gate 为 `block` 时批准也必须有非空理由，否则 400。成功 201 `{id,status}`，不存在 404，状态冲突 409。审核界面对人工批准要求至少 8 字说明。 |
| GET `/projects` | `limit`、`cursor`、`search`、`projectType`、`includeDeleted=true`；管理项目列表。 |
| GET `/members` | `limit`、`cursor`；成员列表。 |
| PUT `/members/:id/role` | owner；JSON 例如 `{"role":"reviewer"}`，角色取值为 member、reviewer 或 owner；成功 `{ok:true}`；最后一个 owner 不能降级，返回 409。 |
| GET `/audit-events` | `limit`、`cursor`、`action`；审计事件列表。 |
| PUT `/recommendations/:projectId` | owner；`adminRecommendationUpdateSchema`，返回推荐内容；项目不存在 404。 |
| DELETE `/recommendations/:projectId` | owner；204，不存在 404。 |
| POST `/reference-sets` | owner；`adminReferenceSetCreateSchema`，201 返回 id、versionId；名称或版本冲突 409。 |
| POST `/reference-sets/:id/versions` | owner；`adminReferenceVersionCreateSchema`，201 返回 id、ordinal；不存在 404，版本冲突 409。 |
| PUT `/reference-sets/:id` | owner；`adminReferenceSetUpdateSchema`，返回 `{ok:true}`，不存在 404。 |

站点和伴随脚本的 owner 写入不在 admin 前缀：

| 方法和路径 | 输入及结果 |
| --- | --- |
| POST `/api/v1/site/banner` | owner，PNG/JPEG/WebP 原始字节，最多 10 MiB、尺寸最多 4096×4096；201 返回 banner。空或无法识别的图片 400，超限 413，MIME 不支持 415。 |
| PUT `/api/v1/site` | owner；`adminSiteUpdateSchema`，至少提供 banner 或 siteContent，返回站点设置；无效 400。 |
| GET `/api/v1/companion-scripts/:scriptId` | 公开读取当前伴随脚本版本，不存在 404。 |
| GET `/api/v1/companion-scripts/:scriptId/versions/:version` | 公开读取指定版本，不存在 404。 |
| PUT `/api/v1/companion-scripts/:scriptId/versions/:version` | owner；`companionVersionInputSchema`，创建 201、相同注册 200，不可变版本冲突 409；参数或输入无效 400。 |

## 客户端和静态资源

| 方法和路径 | 权限、结果及缓存 |
| --- | --- |
| GET `/api/v1/client/version` | 公开，`channel=stable\|staging` 默认 stable；返回当前频道版本，不存在或无效频道 404。成功缓存 5 秒，错误 `no-store`；CORS `*`。 |
| GET `/api/v1/client/compatibility` | 公开，同上 channel 和可选 `version`；返回 compatible、bootstrap、required、revision、reason；频道不存在时返回 200 且 `channel_unavailable`，无效频道 404。已配置频道的成功响应缓存 5 秒，不可用和错误响应 `no-store`。 |
| GET `/client/stable/index.js`、`/client/staging/index.js` | 公开频道入口；`no-store`，CORS `*`；对象不存在 404。 |
| GET `/client/v/:revision/index.js` | 公开版本文件，revision 为 8–64 位小写十六进制；一年 immutable，支持 ETag 和 `If-None-Match` 304，CORS `*`。 |
| GET `/client/checker/v/:revision/:file` | 同上版本格式和 immutable 缓存；file 仅允许 `browser-checker.js`、`upload-checker.mjs`、`review-checker.mjs`、`manifest.json`、`NOTICES.txt`。响应带 ETag，但入口重建请求时丢弃 `If-None-Match`，不要依赖源站返回 304。 |
| GET `/test-dist/CreativeWorkshop/index.js` | 旧地址兼容脚本，导入 stable 入口；`public, max-age=0, must-revalidate`，CORS `*`。 |
| GET `/assets/*` | ASSETS 绑定提供的前端静态文件，成功为一年 immutable；未配置或不存在 404。 |
| GET `/api/v1/public-assets/*` | 仅当前公开发布的 cover/gallery 或当前注册 banner；成功 `public, max-age=300, stale-if-error=0`，CORS `*`。权限不满足或对象缺失 404。 |
| GET `/api/v1/assets/*` | 公开图片也可读取；私有 cover 对作者、owner 及符合待审条件的 reviewer/owner 可见，私有 gallery 对作者或 owner 可见；当前 banner 可见。成功 `private, no-store`、`Vary: Authorization`，无权或不存在 404。 |
| GET `/` | 正常部署由 Static Assets 返回 Web 首页 HTML；Worker 后备 handler 返回纯文本 `workshop`。 |

未匹配的 `/api/*` 返回 JSON 404；其他未知路径返回纯文本 404。版本文件设置 immutable 缓存头及 cache tag；checker 经过公开入口时会移除 CDN 专用缓存头。响应头不保证平台缓存一定命中。

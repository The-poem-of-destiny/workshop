# Worker HTTP API 参考

本文描述 Worker 的外部 HTTP 入口，包括 `apps/worker/src/app.ts` 挂载的路由与入口层维护控制，不包含 ContentService 等 Durable Object 的内部接口。部署、绑定和允许的来源见[运行时配置](runtime-configuration.md)；宿主集成见[宿主协议](host-protocol.md)。请求和响应的复杂字段、枚举与限制以 [`packages/contracts/src`](../../packages/contracts/src/) 中的 Zod schema 为准；业务路由解析以 [`apps/worker/src/http/routes`](../../apps/worker/src/http/routes/) 为准，维护控制以 [`write-barrier.ts`](../../apps/worker/src/write-barrier.ts) 为准。表中省略的成功状态为 200；`id`、`versionId`、`submissionId`、`projectId` 等为路径参数。

## 通用约定

- 登录和维护接口以外，受保护请求使用 `Authorization: Bearer <session token>`。角色为 `member`、`reviewer`、`owner`；reviewer 接口也允许 owner。作者操作要求项目作者或 owner，权限不足的项目通常表现为 404，而非披露其存在。
- API JSON 错误格式为 `{ "error": { "code": "...", "message": "...", "details": ... } }`，`details` 可省略。状态映射见 [errors.ts](../../packages/contracts/src/errors.ts)：400 `bad_request`、401 `unauthorized`、403 `forbidden`、404 `not_found`、409 `conflict`、412 `precondition_failed`、413 `payload_too_large`、415 `unsupported_media_type`、426 `upgrade_required`、429 `rate_limited`、500 `internal`。校验错误可能带 Zod details；未捕获异常返回 500。callback 返回 HTML 而不是此 JSON 格式。
- 非公开缓存路径默认 `Cache-Control: private, no-store`；入口白名单中的匿名公开响应和静态资源具有不同缓存语义，详见[运行时配置](runtime-configuration.md#公开缓存和私有绕过)。API 的 OPTIONS 仅对 `ALLOWED_ORIGINS` 中精确匹配的 Origin 返回 204，否则 403；允许的方法为 GET、POST、PUT、PATCH、DELETE、OPTIONS，允许的请求头为 `authorization,content-type,if-match,idempotency-key,x-client-version,x-client-channel`。普通 API 响应对允许的 Origin 设置 CORS；不应假设预检支持其他头。
- 项目列表使用不透明 `cursor` 和 `nextCursor`；下一页保留原有排序与筛选条件，传入返回的 cursor。`total` 为完整筛选集数量，不是本页数量。管理列表也返回 `nextCursor`；其参数和响应分别见 [admin.ts](../../packages/contracts/src/admin.ts) 与 [admin-dto.ts](../../packages/contracts/src/admin-dto.ts)。无更多结果时 cursor 为 null。
- 公开项目的 `updatedAt` 只随成功发布更新，保存草稿不会改变公开更新时间或更新时间排序；历史数据优先回填当前已发布版本的审批时间。审核重查采用原子状态转换，同一提交的并发重查只有一个成功排队。

应用运行时的 D1/R2 I/O 经同一 Worker 的 `DataService` 和 `CachedReads` 具名入口；公开读取使用内部 fetch，实时业务使用 RPC，文件通过内部 fetch 流式传输。ContentService 保留 Durable Object 内的检查计算，并通过 `state.exports` 请求数据。入口及客户端类型与静态检查约束代码边界，不是 Cloudflare 绑定权限隔离；发布、备份和迁移工具保留受控运维通道。

## 维护控制

`/api/v1/maintenance` 在入口层处理，只接受独立 `MAINTENANCE_TOKEN` 的 Bearer 凭据，不接受普通用户会话。它不经过业务路由的 CORS 处理；缺失或错误凭据返回无 JSON body 的 401。

| 方法和路径 | 输入与结果 |
| --- | --- |
| GET `/api/v1/maintenance` | 返回 `closed`、`drained`、`outstanding`（最多 100 张工作票据）与 `outstandingTruncated`；成功响应为 `no-store`。 |
| POST `/api/v1/maintenance` | JSON `{"action":"close"}` 或 `{"action":"open"}`；返回同样状态。无效 JSON／action 为 400；还有票据时 open 返回 409 `{"error":"not_drained"}`；其他方法为 405。 |

关闭准入不等于已排空；只有 `closed`、`drained` 均为 true 且无截断时才证明协调器已知工作排空。关闭或无法确认准入时，普通请求（包括 health、资源和缓存命中）返回 503 `{"error":{"code":"maintenance","message":"Service temporarily unavailable"}}`，带 `Cache-Control: private, no-store` 和 `Retry-After: 30`。运维步骤、失联票据和外部写入者限制见[维护屏障操作规范](../operations/deployment-safety.md#maintenance-barrier)。

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
| GET `/projects/:id` | 已发布项目详情；不存在或不可公开访问 404。 |
| GET `/projects/:id/entries` | 已发布项目条目索引；不存在 404。 |
| GET `/projects/:id/preview/:kind` | Bearer；kind 为 `worldbook` 或 `regex`，返回预览；无会话 401，kind 无效 400，不存在 404。 |
| POST `/projects/:id/downloads` | Bearer、`Idempotency-Key` UUID v4；返回当前可访问发布版的 201 `{versionId, files:[{kind,url}]}`。缺少或非法幂等键 400；日获取上限 429；不可访问 404。 |
| POST `/projects/:id/acquisitions` | Bearer、`Idempotency-Key` UUID v4，头 `X-Client-Version` 和 `X-Client-Channel: stable\|staging` 必须匹配当前频道；201 返回 project、release、downloads。版本缺失或不匹配 426，发布版不可访问 404。 |
| GET `/downloads/:projectId/:versionId/:kind` | Bearer；直接实时验证登录、可见性、当前发布版和文件关联，返回文件流；无登录 401，不可访问／文件缺失 404。读取可重复，不签发或消费授权票据。 |
| GET `/recommendations` | `{items}` 推荐列表。 |
| GET `/site` | 站点 banner 和内容。 |

一次逻辑获取由客户端生成一个 UUID v4；网络重试必须复用同一键，独立获取使用新键。POST 按用户、版本、UTC 日汇总，重复键不递增；世界书和正则 GET 不额外计数。每用户每版本每日最多 128 次不同逻辑获取，以有界 JSON 保存当天幂等键，达到上限返回 429，既有键重试仍成功。项目累计和日汇总计逻辑获取次数，不宣称字节传输完成。旧项目日指标保留为历史权威，不补造旧用户／版本下载记录。URL 本身不授予权限；每次 GET 都需有效 Bearer，并在打开对象后重查授权和发布指针。
用户日统计记录所有授权逻辑获取；公开下载指标只统计公开项目的非作者普通玩家获取，作者、reviewer／owner 和私有访问不贡献公开指标。

玩家推荐使用 `PUT /api/v1/recommendations/:projectId`，Bearer 和 JSON `{projectVersionId,comment}`；仅当前公开发布版可写，同一玩家／版本保留一条，可编辑或以 `DELETE` 携带同一 JSON 撤回。旧版本不会自动背书新版本。匿名 401，版本过期或项目不可访问 404。发现响应包含 `batchId`、`scheduledAt` 和项目条目；评论只随机选取当前仍有效的非作者玩家非空评论。

`POST /api/v1/recommendations/changes` 接受作者客户端计算的版本／清单哈希及 changedEntries、totalEntries；服务端对照两份不可变条目目录验证，元数据修改不贡献内容变化。此提示不是通用 diff 服务。

可执行示例（设置 `BASE`、`TOKEN`、`PROJECT_ID`，需 `curl` 和 `jq`）：

```sh
curl -fsS -G "$BASE/api/v1/projects" --data-urlencode 'limit=10' > /tmp/workshop-page.json
CURSOR=$(jq -r '.nextCursor // empty' /tmp/workshop-page.json)
[ -z "$CURSOR" ] || curl -fsS -G "$BASE/api/v1/projects" --data-urlencode 'limit=10' --data-urlencode "cursor=$CURSOR"
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(cat /proc/sys/kernel/random/uuid)" "$BASE/api/v1/projects/$PROJECT_ID/downloads" > /tmp/workshop-downloads.json
URL=$(jq -r '.files[0].url // empty' /tmp/workshop-downloads.json)
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
| POST `/` | `createProjectSchema`，201 返回 project、rowVersion、workingVersionId；元数据或 Discord 线程 URL 不合法 400。 |
| GET `/:id/draft` | 返回项目、rowVersion、workingVersionId、latestSubmission；不存在或无权 404。 |
| PATCH `/:id` | If-Match、`patchProjectSchema`；成功返回更新结果；冻结 409。 |
| DELETE `/:id` | If-Match；软删除，204。 |
| PATCH `/:id/visibility` | If-Match、`{"visibility":"public"}` 或 `private`；返回 rowVersion。 |
| POST `/:id/versions` | If-Match、`patchProjectSchema`；201 返回 versionId、rowVersion。 |
| GET `/:id/gallery` | 作者图片及 rowVersion。 |
| PUT `/:id/gallery/:slot` | If-Match、图片原始字节；slot 为 0 或 1；返回 rowVersion、sha256、bytes、mime。 |
| DELETE `/:id/gallery/:slot` | If-Match；删除图片并返回结果。 |
| GET `/:id/versions/:versionId/files/:kind` | 返回原始文件；kind 为 `worldbook`、`regex`、`cover`。 |
| PUT `/:id/versions/:versionId/files/:kind` | If-Match、原始文件字节；返回 `uploadResponseSchema`；无效内容 400，非工作版本或已冻结版本 404，前置查询后发生编辑状态竞态可返回 409。 |
| DELETE `/:id/versions/:versionId/entries/:kind/:entryKey` | If-Match，kind 为 worldbook 或 regex，entryKey URL 编码；成功返回结果，不能从该版本删除时 409。 |
| POST `/:id/versions/:versionId/submit` | If-Match、`submitProjectSchema` JSON；201 返回 submissionId、status、checkStatus、rowVersion。仅工作版本可提交，冻结或状态冲突 409；验证服务不可用 500。 |
| GET `/:id/versions/:versionId/change-evidence` | 作者会话、当前工作版本；返回当前／上一发布版不可变条目目录与 manifestHash，任一目录缺失或无上一版 404，不回退读取完整内容。 |
| POST `/:id/submissions/:submissionId/withdraw` | If-Match；返回结果，已处理或状态变化 409。 |

文件上传需正数 `Content-Length`。worldbook 和 regex 接受 `application/json` 或 `text/plain`，上限 10 MiB，服务端验证内容；cover 和 gallery 接受 PNG、JPEG、WebP，上限 1 MiB。cover 的内容格式必须匹配 MIME，尺寸上限 4096×4096；gallery 另由存储层校验图片和 slot。超限 413，MIME 不支持 415。请求体直接为文件，不是 multipart。

示例：已登录且有写入权限，使用一个合法 worldbook JSON 文件，依次读取版本、上传并提交；每次变更后使用返回的新版本：

```sh
DRAFT=$(curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/projects/$PROJECT_ID/draft")
CONTENT_VERSION_ID=$(printf '%s' "$DRAFT" | jq -r '.workingVersionId')
VERSION=$(printf '%s' "$DRAFT" | jq -r '.rowVersion')
UPLOAD=$(curl -fsS -X PUT -H "Authorization: Bearer $TOKEN" -H "If-Match: $VERSION" -H 'Content-Type: application/json' --data-binary @worldbook.json "$BASE/api/v1/projects/$PROJECT_ID/versions/$CONTENT_VERSION_ID/files/worldbook")
VERSION=$(printf '%s' "$UPLOAD" | jq -r '.rowVersion')
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" -H "If-Match: $VERSION" -H 'Content-Type: application/json' -d '{}' "$BASE/api/v1/projects/$PROJECT_ID/versions/$CONTENT_VERSION_ID/submit"
```

提交还受项目元数据、内容检查和确认要求约束，示例文件不满足实际发布要求时会返回校验错误。示例中的空对象使客户端 gate 为 `missing`，成功提交后为 `pending`、`needs_human`，不会排队自动检查；客户端 gate 为 `pass` 或 `warn` 才排队，服务端检查未阻断时可能自动发布。

客户端检查器版本使用 `checkerVersion` 提交，持久化为 `automated_reviews.client_checker_version`；管理详情分别返回 `clientCheckerVersion` 与服务端 `checkerVersion`，不再接受旧 checker revision 字段。

当前工作版本一旦成为已发布版本，即使历史导入没有重建提交／审核记录，也视为冻结：不能原地修改元数据、替换文件、删除条目或重复提交。先创建后继工作版本；新版本号按该项目全部历史版本的最大编号加一分配，并以项目行版本 CAS 阻止并发创建两个后继。未提交且未发布的草稿仍可原地修改元数据。

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
| GET `/audit-events` | `limit`、`cursor`、`action`；`action` 必须符合 `auditActionSchema`，未知值 400。事件按 action 判别 detail，读写复用 `adminAuditEventSchema`，不接受任意 JSON 冒充已知操作。 |
| PUT `/recommendations/:projectId` | owner；`adminRecommendationUpdateSchema`，返回推荐内容；项目不存在 404。 |
| DELETE `/recommendations/:projectId` | owner；204，不存在 404。 |

操作审计不保存项目批准、拒绝或计数重算；批准与拒绝的权威记录属于审查表。迁移明确排除对应三种旧日志，原始备份不变。历史兼容信息修改统一为 `project.patch`，detail 保留来源表、原作者／目标标识及 beforeValue／afterValue；不因此恢复兼容字段。其余保留的历史管理操作使用明确的 `legacy.*` 枚举，不开放任意前缀。

自动检查的状态、尝试次数、租约、门禁、检查器版本、时间、耗时和最终报告键／哈希属于 `automated_reviews`；人工决定属于 `manual_reviews`，decision 是受约束的 approve/reject 文本。报告精确字节写入 `reports/{submissionId}/{sha256}.json` 后才保存引用，读取校验哈希：有 key 但对象缺失或损坏是错误；key、hash、cleaned_at 均为空表示尚未生成；key 为空而 hash 和 report_cleaned_at 有值表示已清理，hash 仅为历史指纹，不证明对象存在。详情保留结构化结论；当前完整报告缺失时 diff 不伪造检查项差异。每次领取有独立租约 token，过期尝试不能覆盖新报告、重新排队或发布。此处不实现报告 GC。

角色基线的 reference-set 读写接口已移除，不再用于内容重复检测；JSON 格式、安全策略、元数据检查和安装 diff 不依赖该接口。

定时清理目前仅生成只读预警：软删除项目、过期会话、已完成或过期 OAuth flow、孤立资产关联数和最老待处理时间。保留策略未定，不物理删除项目、审查证据或 R2 对象。

### 资源生命周期与删除责任（方案，非执行授权）

本节替代旧计划中按 90 天自动回收版本的描述。staging 可单独获准重建不授权清理 legacy、production、备份或用户内容；下面的期限、审批及执行器均未确定，不自动执行。责任人是未来维护者／数据所有者；每次操作需明确环境、账号、数据库和 bucket 身份，并由有权负责人批准候选与不可逆范围。

| 父对象／资源 | 引用与目标删除责任 | 保留及前提 |
| --- | --- | --- |
| 用户 | projects.author、audit actor 等证据 RESTRICT；session 等纯附属 CASCADE；site_settings updater SET NULL | 作者归属、审计和人工决定默认保留，不能删除用户时抹掉证据；隐私／法定义务另行决定 |
| 用户的其他引用 | project_versions.created_by、submissions.submitted_by/withdrawn_by 默认 NO ACTION；manual_reviews.reviewer、recommendations.curator、download_daily_stats.user RESTRICT；oauth_flows.user SET NULL；likes、ratings、subscriptions CASCADE | 删除用户必须逐项处理阻断关系并保全证据；OAuth 准入证据及互动删除影响须另审 |
| 项目纯派生／互动 | project_likes、project_ratings、project_subscriptions、project_metrics_daily、project_search_tags CASCADE；FTS 搜索索引不由外键维护 | 可级联不等于已批准硬删除；清理后复核触发器维护的搜索索引与聚合 |
| 项目 | project_versions、submissions、assets、下载、推荐、change signals 等业务记录 RESTRICT；纯关系允许 CASCADE | 软删除不等于硬删除；先明确恢复期和证据处理，清查全部依赖并人工批准 |
| 版本 | 项目 working/published 指针是同项目、延迟检查的引用；投稿 version/base、assets 和其他业务证据 RESTRICT | 当前工作／发布版本、审核中的冻结版本及基线禁止直接回收；历史版本须先决定保留与可恢复策略 |
| 投稿 | automated_reviews、manual_reviews 是审核证据，RESTRICT | 不能靠父项目删除级联抹除审核结论和人工决定；先完成独立证据政策 |
| 资产与 R2 key | assets 是关联权威，版本可共享同一对象；站点 banner、报告及客户端分发等各自 key 也须纳入完整引用清单 | 不以某版本或前缀无引用断言对象孤儿；失败上传和替换旧图先只读列候选 |
| 自动报告 | checked_at、report_r2_key、report_hash、report_cleaned_at；共享 key 的所有引用均须检查 | 期限及仍待人工审核是否豁免待定；结构化结论和 hash 保留，禁止先删仍依赖原文的报告 |
| recommendation_batches、project_change_signals | 批次可能正在展示或用于机会衰减，change signals 参与内容变化评分 | 先确定算法完整历史窗口及审计要求后定期限；已移除的曝光／点击 signals 不恢复 |
| sessions、OAuth flows | session 关联用户；flow 的状态、有效期和兑换是安全边界 | 过期／撤销后仍须确定安全追溯与秘密最小化期限，分别审批，不记录 secret、授权码或令牌 |
| 下载日记录、互动日汇总、审计 | 日记录可能承担幂等、限额、周期排序及累计统计；audit actor 和 manual review 是证据 | 先证明聚合／归档后的计数、窗口、幂等与追责不变；默认保留审计，不因软删除抹除 |
| 本地备份、冻结计划、临时文件、工作树 | 独立于线上资源；核验唯一恢复副本、输入指纹和未合并工作 | 保留根工作区归档和 legacy 原始备份；单独盘点审批，禁止将 staging 重建许可当成本地删除许可 |

未来执行器先生成只读预演：对象及大小、关联表和引用、资格理由、最老时间、候选数量／成本、保留政策版本、账号／环境／资源身份和可恢复性；冻结清单供负责人审阅。批准后限批、限速、记录每项操作 ID、原始 key/hash/checked_at、结果及错误，逐批复核，成本收益须按真实对象字节和请求量估算而非承诺节省。

D1 与 R2 不跨服务原子：单次 SELECT 无引用不防止删除瞬间重新引用，报告按 hash 相同重查也可能复用 key。执行前必须以覆盖所有写入和引用路径的互斥／删除墓碑等机制阻止新增引用，隔离／宽限后在保护内重新检查所有引用；无法证明保护完整则不删除。报告仅在资格成立且引用安全时删除，随后以 submission_id、原 checked_at、key、hash 条件 CAS 置空 key 并记录清理时间；删除成功而 CAS 失败时保留失败账本并停止相关对象处理，核对并发引用，按已验证备份恢复或在保护下重试；对象已不存在的删除可幂等，绝不吞掉错误或标记成功。若无有效备份，物理删除不可回滚；恢复演练成功前不可宣称可恢复。验收核对 D1 外键、存活引用与 R2 对象／hash、结构化审查、排行和幂等，记录剩余失败并人工处置。

站点和伴随脚本的 owner 写入不在 admin 前缀：

| 方法和路径 | 输入及结果 |
| --- | --- |
| POST `/api/v1/site/banner` | owner，PNG/JPEG/WebP 原始字节，最多 2 MiB、尺寸最多 4096×4096；201 返回 banner。空或无法识别的图片 400，超限 413，MIME 不支持 415。 |
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
| GET `/client/v/:revision/index.js` | 公开版本文件，revision 为 8–64 位小写十六进制；默认一年 immutable，支持 ETag 和 `If-None-Match` 304，CORS `*`。TTL 可配置，设为 0 或非法值时 no-store。 |
| GET `/client/checker/v/:revision/:file` | 同上版本格式和默认 immutable 缓存；file 仅允许 `browser-checker.js`、`upload-checker.mjs`、`review-checker.mjs`、`manifest.json`、`NOTICES.txt`。响应带 ETag，但入口重建请求时丢弃 `If-None-Match`，不要依赖源站返回 304。 |
| GET `/test-dist/CreativeWorkshop/index.js` | 旧地址兼容脚本，导入 stable 入口；`public, max-age=0, must-revalidate`，CORS `*`。 |
| GET `/assets/*` | ASSETS 绑定提供的前端静态文件，成功为一年 immutable；未配置或不存在 404。 |
| GET `/api/v1/public-assets/*` | 仅当前公开发布的 cover/gallery 或当前注册 banner；成功默认最多 60 秒，`stale-if-error=0`，CORS `*`；TTL 可配置，设为 0 或非法值时 no-store。权限不满足或对象缺失 404。 |
| GET `/api/v1/assets/*` | 公开图片也可读取；私有 cover 对作者、owner 及符合待审条件的 reviewer/owner 可见，私有 gallery 对作者或 owner 可见；当前 banner 可见。成功 `private, no-store`、`Vary: Authorization`，无权或不存在 404。 |
| GET `/` | 正常部署由 Static Assets 返回 Web 首页 HTML；Worker 后备 handler 返回纯文本 `workshop`。 |

未匹配的 `/api/*` 返回 JSON 404；其他未知路径返回纯文本 404。版本文件设置 immutable 缓存头及 cache tag；checker 经过公开入口时会移除 CDN 专用缓存头。响应头不保证平台缓存一定命中。

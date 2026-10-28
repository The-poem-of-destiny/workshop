# API 设计：用户旅程、不变量与缓存边界

日期：2026-10-22。状态：API 原剩余缺陷曾经独立复核及本地验证；用户随后要求纠正旧数据兼容优先的重构方向。现按 D-39 收敛 schema、删除历史索引回退；本次验证与本地提交结果见 [state.md](state.md)，不沿用旧检查作为新结果。

2026-10-26 目标与实现以 [D-40～D-47](decisions.md#d-40-完整替代旧版与完整数据迁移) 为准：统一提交审核、按位置安装实例及完整迁移范围取代旧展示直写／单项目登记。当前实施与运行验收见 [state.md](state.md)，尚未执行完整迁移或正式切换；工作包见 [checklist.md](checklist.md#本轮工作包2026-10-26)。

2026-10-29 缓存路径调整：本页缓存设计与 I01 以第 6 节为准，取代早期 epoch 网关方案；具体验证状态见 state.md。

## 1. 平台事实：Workers Cache 不是 Cache API

**Workers Cache ≠ Cache API。** 前者位于启用缓存的 Worker `fetch()` entrypoint 之前；HIT 不执行被缓存入口。后者是 Worker 内显式 `caches.default.match/put/delete`，每次仍运行 Worker，且不自动提供分层与请求合并。当前使用 default entrypoint Workers Cache，不使用旧 Cache API helper。

已核实能力与限制：

- Wrangler `cache.enabled` 及 `exports.<entrypoint>.cache` 控制入口；同一 Worker 的 `ctx.exports` fetch 也可经过目标入口缓存，自定义 RPC 不经过缓存。
- 键包括 entrypoint、path/query、默认 Worker version、受信任 `ctx.props`；host、普通身份头和 body 不自动隔离身份。GET/HEAD 共用；query 顺序／尾斜杠需要规范化。
- 自动 lower/upper tier、同一数据中心内同 key 可缓存请求的 collapsing；不是业务全局单次执行保证。
- TTL、SWR、`stale-if-error`、Vary、条件重验证由 HTTP 策略控制。缺少显式头时 200 可缓存两小时，404 可缓存三分钟；默认错误兜旧可能无限期，不能只凭 max-age 宣称陈旧有界。
- `ctx.cache.purge` 删除，`invalidate` 标 stale；均限缓存所属 entrypoint，全球传播但 success 只证明接受请求，不是 D1 提交与失效的共同事务。Free purge 每分钟 5 次，不能把每次互动都变成强制 purge。
- HIT 仍计请求；静态交付也有计费影响。入口命中可跳过 Worker 执行和源站查询，但需要 hosted 证据确认。
- 本地代码／类型／路由验证不能证明全球 HIT、分层和 purge。生产开启仍受 D-24 的授权与运行证据门禁约束。

官方依据：[配置](https://developers.cloudflare.com/workers/cache/configuration/)、[键](https://developers.cloudflare.com/workers/cache/cache-keys/)、[组合](https://developers.cloudflare.com/workers/cache/examples/)、[purge](https://developers.cloudflare.com/workers/cache/purge/)、[限制](https://developers.cloudflare.com/workers/cache/limitations/)、[计费](https://developers.cloudflare.com/workers/platform/pricing/)。项目本地完整研究在被忽略的 `ref/cloudflare-workers-cache/`，不作为部署依赖。

## 2. 旅程先于端点

| 旅程 | 用户需要的结果 | 必须守住的边界 |
|---|---|---|
| 匿名浏览 | 唯一主列表搜索／筛选／排序，顶部发现栏，项目详情与条目索引 | 不出现发现页；只读当前 public + published + nondeleted 投影，不返回可安装字节 |
| 登录 | Discord 准入后获得可撤销会话，浏览器与 ST iframe 均可完成 | token 不交给随机宿主域；每次私有请求重新鉴权；退出使后续请求失效 |
| 普通下载 | 登录后取得当前发布内容并保存文件 | 不要求 Tavern client；仍需权限、单次短票据；不等于安装／订阅 |
| ST 安装／更新／修复 | 当前受支持客户端安装精确 release | channel/version 精确匹配；所有文件属于同一 revision；本地安装状态由 ST 决定 |
| 创作 | 编辑草稿、替换部分文件、保留未替换文件、提交冻结快照 | 版本冲突不得暗写数据；R2 不覆盖；提交失败不产生可领取任务，不损坏上一轮 |
| 审核／发布 | 人工或 DO 对固定快照作决定，公开指针一次切换 | 任务、报告、manifest、checker 版本绑定；并发只能一方成功；删除项目不得假发布 |
| 个人互动 | 明确点赞、订阅和私人评分，能立即读到自己的修改 | 私有关系与公开计数分离；取消订阅不卸载；不把缓存显示值用于授权 |
| 管理／分发／调度 | 角色、站点、参考集、客户端版本、完整排行榜可维护 | 角色变更撤销会话；版本对象不可变；重建不得暴露半份排行 |

## 3. 不变量与线性化点

| ID | 不变量 | 权威与生效点 |
|---|---|---|
| I01 | 隐藏／删除后源站立即拒绝新的匿名读取；已公开内容的浏览器或边缘副本允许最多所选缓存期限内陈旧 | 源站公开查询校验当前状态；公开变更尽力 purge，但不作为同步屏障。公开响应 TTL 300 秒、`stale-if-error=0`；已经交付的字节无法追回 |
| I02 | 公开 API 不混入用户关系、草稿、审核报告或下载票据 | 公开 projection schema 与入口 allowlist；私有读取始终走鉴权路径 |
| I03 | 失败的 CAS 不得改 revision、资产、审计或指针 | 同一 D1 batch 内，所有后继语句只依赖本次成功 mutation，不能只看 expected+1 这样的可被竞争者满足的状态 |
| I04 | 冻结待审快照的内容及审核相关元数据不可再编辑 | submit 的最终原子 batch；修改需新建 successor revision。D-30 的已发布展示元数据走独立 project-level 操作，不更新 pending revision 或其 manifest |
| I05 | 一旦任务可领取，其校验、manifest、条目索引已完成 | 先在 DO 生成并验证候选 snapshot，再在 D1 校验当前版本／资产指纹并一次提交；没有先排队再补偿回滚 |
| I06 | 审核只决策同一个未解决快照，成功记录与发布指针一致 | 条件 transition + review/audit + 指针在同一 batch；非赢家不写副作用 |
| I07 | 下载票据绑定用户、session version、revision、kind、过期与单次消费 | 打开 R2 后，在消费 CAS 校验当前项目／发布／权限和本请求精确 session token hash 的版本、未撤销与未过期；ticket/session 到期均用事务中的 D1 当前时钟。消费与日计量同一 batch，事件日期取已持久化 consumed_at |
| I08 | “下载成功”不是客户端确认收完流 | 计数口径是服务端成功取得对象并赢得消费权；不宣称网络末端收到完整字节。申请、缺失文件、过期和重复消费不计数 |
| I09 | 私有关系读己所写；公开计数可短暂陈旧 | 私有请求 no-store 直读 D1；公开计数只影响展示，最多所选显式 TTL，不允许默认无限 stale-if-error |
| I10 | 排行读者只见完整旧快照或完整新快照 | 使用同一参考时间，候选数据先算，entries/run 可见性原子替换；窗口包含上界，未来指标不进入当前榜 |

### 3.1 设计复核补充

- Workers Cache 的默认键不含 host。公开响应必须对 host 无关，不能让请求的 Host 污染共享对象。
- 入口缓存命中可能绕过所有 Worker 代码，因此公开 URL 必须对所有身份返回相同匿名投影，不能回退到私人内容。


## 4. 状态归属与资源职责

| 资源 | 权威 | 可变性／版本 | 主要读者 |
|---|---|---|---|
| user/session/OAuth flow | D1；token 仅客户端持有 | 角色实时；flow 一次性交付；session 可撤销 | 鉴权网关、本人、管理者 |
| project | D1 | 稳定 ID；可见性、working/published 指针、rowVersion | 匿名公开投影、作者、管理者 |
| revision | D1 + 不可变 R2 引用 | working 可编辑；提交后冻结；新 draft 继承未变资产而非复制 R2 | 作者、审核、当前发布消费者 |
| submission/report/review | D1 | 固定 revision/manifest/checker 与提交时的 `base_published_revision_id`；只通过合法 transition 解决 | 作者状态、审核者、DO |
| likes/subscriptions/ratings | D1 | 幂等 PUT/DELETE；私人评分不公开 | 本人、公开计数投影 |
| download ticket/event | D1 + R2 字节 | 票据短时单次，事件 user/project/day 幂等 | 已登录取件者；不形成安装历史 |
| install registry／玩家修改 | 本地 ST／Tavern client | 本地 revision/hash 与实际条目扫描 | 宿主桥接；服务端无 install 表 |
| client/checker artifact | 不可变 R2 对象；D1 channel 记录 | 版本对象不可变；channel 可切换 | 随机酒馆域、Web checker |
| catalog／home／榜单／封面 | D1 当前公开投影与受控缓存 | 公开展示可有界陈旧；写后尽力失效 | 匿名／登录用户相同公开表示 |
Schema migration: `submissions.base_published_revision_id` is captured from the current published pointer at submit time (`NULL` means first publication). It is a publication precondition, never inferred during review. Existing unresolved submissions without a trustworthy baseline are superseded by migration `0015`; the importer does not recreate legacy submissions or reports. Current-system review history remains available.

完整索引是可发布内容的前置条件，`entry_index_ready` 是显式完成状态，不从 manifest 或行数推断。submit 同一原子 batch 写全部 index 行、计数、manifest 与 ready=1；合法空索引允许 ready=1。匿名读取仅查询 ready=1 的持久索引，不解析 R2 或转发 DO 修复历史数据。`0021` 撤下 ready=0 的旧发布指针并清除不完整派生索引，保留 revision 供作者创建 successor；导入必须从实际有效字节一次建立完整索引。

`0021` 同时删除无 consumer 的 OAuth verifier 镜像、revision 泛型 metadata/facets/custom_tags、重复 submission gate/checker 字段和人工 review report；保留 client_*、类型化 metadata 审计、DO checker history／当前报告投影以及实际使用的 28 张表。项目 assets 仅 worldbook／regex／cover；完整删减依据见 D-39，不让旧导出字段成为新模型要求。

## 5. 权限矩阵

| 能力 | 匿名 | member | 作者（自己的资源） | reviewer | owner |
|---|---|---|---|---|---|
| public 已发布摘要／索引／封面 | 是 | 是 | 是 | 是 | 是 |
| 普通下载／客户端获取 | 否 | public release | 自己的当前 release，含 private | 可审阅当前 release | 可审阅当前 release |
| 草稿及作者写 | 否 | 不能写他人项目 | 是 | 无作者身份时不能编辑 | 是 |
| pending 内容／报告／人工决策 | 否 | 否 | 查看自己的状态／历史 | 是 | 是 |
| 本人互动／订阅 | 否 | 是 | 是 | 是 | 是 |
| 角色、站点、精选、参考集写 | 否 | 否 | 否 | 否 | 是 |

不存在／隐藏资源向无权者返回 404；角色级能力不足返回 403；无有效会话返回 401。CORS 不是鉴权。公开脚本和 compatibility 可 ACAO:*，其余 API 继续使用 Origin 白名单。公开读取即使携带 token，也不因此变成含私有字段的表示。

## 6. 缓存设计：公开投影与实时权限分离

default entrypoint 在 staging 启用 Workers Cache，production 关闭。明确登记的公开 URL 始终返回匿名投影，不根据 Cookie 或 Authorization 返回私有内容；私有接口、下载票据与文件仍逐次鉴权并返回 `private, no-store`。不使用旧 Cache API 或每请求 D1 epoch 查询。

公开成功响应使用 `public, max-age=300, stale-if-error=0`；错误和带 Set-Cookie 的响应不缓存。公开图片使用独立 `/api/v1/public-assets/*`，绝不因携带 token 回退到私人图片。旧图片路径保留实时授权。客户端和浏览器也可缓存公开响应，因此隐藏、删除或修改后允许最多 300 秒展示陈旧；任何要求即时撤回的内容不得进入此缓存。

公开结构写入、自动发布及排行榜重建按受影响路径尽力调用 `cache.purge`；失败记录错误，不回滚已成功的写入。purge 接受不等于全球即时失效，正确性不能依赖它。互动计数允许 TTL 内陈旧，权威计数、私有状态、权限和写入前置条件不读取缓存投影。迁移 `0025` 删除旧 epoch 触发器，保留 epoch 行供先迁移后部署期间及旧版本回滚读取；旧版本在触发器删除后不再按写入更新代际，其公开缓存可在旧 TTL 内陈旧。远端应用迁移前仍会产生旧写放大。

Workers Cache 入口缓存发生在 Worker 执行前，不能依赖入口代码对每次命中做规范化或鉴权；公开 URL 的所有响应必须不依赖身份。默认缓存键不含 host，公开结果不能依赖 host。未列入公开路径的接口不应获得可缓存响应；无效请求和错误必须显式 no-store，避免平台启发式缓存。

本地检查只能证明源站路由、响应头、权限与行为，不能证明 hosted HIT、全球 purge、分层或实际费用。staging 部署后需单独观察真实命中及失效；production 仍关闭，开启需要独立授权与证据。

## 7. 资源与端点契约

### 7.1 公开读取与个人关系

- `GET /api/v1/projects?cursor=&sort=&search=&projectType=&tag=&authorId=`：顺序 keyset；Web 每页 24，只显示区间不显示总量；搜索保留中文短索引。
- `GET /api/v1/projects/:id`、`/:id/entries`：相同公开规则；返回当前 publishedRevisionId。索引不在普通 Worker 匿名热路径解析完整文件。
- `GET /api/v1/projects/discovery`：顶部发现栏的数据，不是发现页。
- `GET /api/v1/projects/rankings?kind=daily|7d|30d`：最后完整快照，不读 building。
- `GET /api/v1/home`、`/site`、`/recommendations`、`/reference-sets`、`/reference-sets/:id`、`/assets/*`：只返回登记的公开投影／当前有权引用的图片。
- `GET /api/v1/me`、`/me/state?ids=`（最多 50 个）、`/me/subscriptions`：必须会话，直读本人状态；禁止 Public。
- `PUT/DELETE /api/v1/me/likes/:id`、`/subscriptions/:id`、`/ratings/:id`：显式幂等设置，不使用 toggle；取消订阅不触发卸载。

### 7.2 身份

- `POST /api/v1/auth/flows`：Origin 白名单；browser/embed/device 的交付边界不混淆。
- `GET /api/v1/auth/flows/:id`：只返回状态；embed/device 必须绑定的 secret，不因知道 flow id 泄露 token。
- `POST /api/v1/auth/flows/:id/redeem`：一次兑换；embed 需要 code/verifier，device 需要 device secret。
- `GET /api/v1/auth/callback`：服务端校验 Discord/state/TTL/准入；token 不能交给随机宿主。
- `DELETE /api/v1/sessions/current`：实际撤销当前 token，不仅清前端 storage。

### 7.3 作者与并发

- `POST /api/v1/projects` → private 项目与初始 draft，返回 workingRevisionId、rowVersion。
- `GET /api/v1/me/projects`、`GET /projects/:id/draft`、`GET /me/projects/:id/submissions`：作者状态与历史，不公开。
- `PATCH /projects/:id`：If-Match；仅编辑未提交 working revision。若 working revision 与 published revision 不同，它只编辑未提交 draft；有 submission 的 frozen revision 必须拒绝编辑，作者需创建 successor。
- 元数据、封面展示位置／缩放和内容属于同一 working revision；独立 `published-metadata`／`published-cover` 读写路线已移除。资料保存和文件上传不改变公开快照，只有成功审核发布才更新公开投影；公开更新时间与更新排序取当前已发布 revision 的批准时刻，不使用草稿 updated_at。
- `POST /projects/:id/revisions`：If-Match；生成 successor，继承当前未变不可变资产，移动 working 指针；保留上一轮历史。
- `PUT /projects/:id/revisions/:rid/files/:kind`：If-Match；校验 MIME/长度/内容，R2 写不可变对象；资产关联、revision 计数及 project rowVersion 在同一 guarded D1 batch 成功 CAS，rowVersion 恰增一并返回。两个相同 If-Match 的并发上传至多一个成功；失败不得更改资产、计数或版本。R2 可能留下无引用不可变对象，由孤儿清理回收。
- `DELETE /projects/:id/revisions/:rid/entries/:kind/:key`：If-Match；产生 successor，不改旧资产、不复制未变 R2。
- `POST /projects/:id/revisions/:rid/submit`：If-Match。路由先校验会话、作者/owner、项目未删除、当前 `working_revision_id = rid`、rowVersion 与无冻结 submission，**然后**才调用 DO 做内容读取/解析；最终 batch 再绑定捕获的 rowVersion、working 指针与资产指纹。DO 校验与索引完成后才原子冻结 revision、递增 rowVersion、写 manifest/完整索引、supersede 前一个未解决 submission 并插入可领取/待人工项。提交行在该 batch 前不存在，因此 scheduler/DO 无法领取未完成校验。失败不创建可领取项、不 supersede 旧 pending。返回真实 status、checkStatus、rowVersion。
- 作者侧 pass／warn 进入独立云检查，云 pass／warn 自动发布、block 转人工；作者 block／缺少标记直接转人工且允许提交。不抽查、不自动拒绝。云检查同时检查冻结内容与元数据。
- `POST /projects/:id/submissions/:submissionId/withdraw`：作者／owner、If-Match，仅 pending／checking；保留冻结 revision、报告与 superseded 历史，并记录 withdrawnAt／withdrawnBy。撤回／替代后旧检查完成不得发布或重新排队。
- `PATCH /projects/:id/visibility`、`DELETE /projects/:id`：If-Match；可见性／软删除与公开代际同事务。

作者调用方必须串行传递 metadata／revision → 每个 revision upload → submit／withdraw 返回的最新 rowVersion。任一步 412 后停止并刷新，不继续把旧版本传给后续步骤。

### 7.4 审核、管理与调度

- `GET /api/v1/admin/submissions?cursor=&limit=`：reviewer 工作队列默认 pending，并返回全状态 counts；若支持 status 历史过滤，明确是管理历史查询，不新增第二套前端队列。无 snapshot 承诺。
- `GET /admin/submissions/:id`、`/:id/diff`、`/:id/files/:kind`：固定快照／固定 checker 报告。
- `POST /admin/submissions/:id/recheck`：仅未解决且非运行中，旧报告保留，显式升级当前检查版本并写 previousRevision 审计；保持 pending 人工归属，检查通过也不自动发布。lease 到期且次数耗尽时转 needs_human。
- Submit 时持久化 submission 的 `base_published_revision_id`；migration 如第 4 节。手动与 DO 发布只能在该基线仍为当前 pointer 时推进。
- `POST /admin/submissions/:id/review`：拒绝理由必需；可不主动重检直接人工决定。批准／拒绝事务均检查未运行、精确 revision、manifest、报告 hash 和 checker revision；批准另检查项目未删除与捕获的 published baseline，项目指针／submission／review／audit 同批条件写入，证据变化返回 409。
- `GET /admin/projects`、`/members`、`/audit-events`；`PUT /admin/members/:id/role`：owner 改角色并撤销／递增会话版本，保护最后 owner。
- `PUT /site`、`POST /site/banner`；`PUT/DELETE /admin/recommendations/:projectId`；`POST/PUT /admin/reference-sets*`：owner 写，业务与审计同 batch；唯一约束竞争可明确 409，不引入自动重试系统。
- cron：使用 scheduledTime 为统一参考；排行指标窗口有上下界，完整候选结果原子替换，旧结果在准备／失败期间仍可读；DO 只领取 finalized 任务，lease／重试状态不得复活已解决任务。

## 8. 获取协议：两种意图，一个字节通道

| 动作 | 前置条件 | 响应职责 |
|---|---|---|
| `POST /api/v1/projects/:id/downloads` | 有效会话、当前 release 访问权 | 通用浏览器下载；返回 revisionId 与按 kind 的短时票据，不要求 Tavern client |
| `POST /api/v1/projects/:id/acquisitions` | 上述 + 精确 X-Client-Channel/X-Client-Version | 安装／更新／修复；返回 project、release manifest、同一 revision 的 tickets |
| `GET /api/v1/downloads/:token` | 会话与 ticket user/sessionVersion/revision/kind/TTL | 唯一计量字节通道；取对象后由消费 CAS 重新检查 project 未删除、当前可见性、当前 published revision、作者／审核权限、session version、未消费及未过期。消费与日计量同一 batch；R2 缺失或消费／权限 CAS 失败则不计量。private release 成功消费不增加公开计数 |

缺 client channel/version 或当前记录不匹配返回 426；通道无发布记录不假装安装兼容。普通下载不借道安装接口。公开摘要不出现 ticket／R2 key／文件 URL。

裸 `releases/:rid/manifest|files/:kind` 不保留迁移兼容入口；当前只有本地 E2E／旧测试使用，改为票据流程后移除路由，避免两套交付／计数契约。旧 `/install` 不恢复。

计数定义见 I08；单次 ticket 失败不吞掉计量错误后谎报成功。文件流响应 no-store，不做共享缓存或边缘计数。

## 9. 客户端分发与宿主桥接 API

### HTTP

- `GET /api/v1/client/version?channel=stable|staging`：唯一版本记录路径，返回 channel/revision/version 与可选 size/sha256/publishedAt，no-store；删除无调用方的 `/client/version` 别名。
- `GET /api/v1/client/compatibility?version=&channel=`：返回 compatible/bootstrap/channel/required/revision/reason；`bootstrap=true` 只允许 client 脚本打开工坊并引导 client 版本加载／更新，不授权项目 acquisition。没有 channel release 时不得表示 install-compatible；acquisition 必须返回 426。
- client version／compatibility 均 no-store。
- `GET /client/stable/index.js`、`/client/staging/index.js`：可变指针，当前策略 no-store；不是 immutable 版本对象。
- `GET /client/v/:revision/index.js`：内容版本对象，immutable 一年、ETag、公共跨域。
- `GET /client/checker/v/:revision/:file`：允许列表内 browser/upload/review checker、manifest、NOTICES，固定 checker revision。
- `/test-dist/CreativeWorkshop/index.js`：已有明确兼容周期的迁移提示 loader，区别于不再保留的裸 release API。

### iframe ↔ Tavern Helper bridge

宿主只接收 `event.origin === workshopOrigin()` 且 `event.source === activeFrame.contentWindow` 的 iframe 消息；Web 也只接受正确 parent/source 与配置的宿主消息类型。会话 token 不交给宿主。

| 方向 | 消息 | 语义 |
|---|---|---|
| Web → host | cw:ready / cw:request-context | 请求角色、世界书、installationScan 与客户端版本 |
| host → Web | cw:context | connected、characterName、worldbooks、installationScan、clientVersion；失败 error |
| Web → host | cw:scan | 重新扫描全部可读世界书和当前角色正则；明确失败、存疑与其他角色未扫描 |
| Web → host | cw:preview-install | install／update／uninstall／migrate 意图、明确 instanceId／目标及取得的内容；只读，返回完整 diff 与确认 token |
| Web → host | cw:confirm-install | 绑定预览 token；重读核对状态，明确整体替换或删除所选实例所属内容 |
| Web → host | cw:cancel-install | 丢弃预览；不写宿主内容或归属记录 |
| host → Web | 上述消息名 + -result | 回显 requestId；ok/result 或 ok:false/message；Web 核验 origin/source 并处理超时 |

同项目可有多个按世界书／角色位置独立管理的实例；本地扫描不是服务端 installs。只接管可靠身份，存疑项不得自动认领／删除。世界书用宿主支持的 extra，正则 UUID 用角色绑定归属记录；写入中断 pending 明确列疑项。宿主 updater 只提供写前核对，不是底层原子 CAS，也没有跨世界书／正则事务：updater 之后、实际保存之前的外部并发修改无法由该 API 严格排除；失败报告实际不确定状态并要求重扫，不伪造回滚保证。

### 配套脚本版本登记（独立于客户端分发）

- owner 会话可 `PUT /api/v1/companion-scripts/:scriptId/versions/:version`，输入 `{displayName, downloadUrl}`，严格字段、无凭据 HTTPS URL；匿名 GET 同路径或 `/:scriptId` 读取精确／最新登记。首次 201、相同重放 200、修改既有版本 409；latest 按新登记顺序，不按 semver 排序，重放不回退。
- `WORKSHOP_SESSION_TOKEN` 配合 `node tools/push-companion-version.mjs --script character-manager --version 0.3.4 --name '角色管理库' --url https://example.org/v0.3.4.js`；默认仅本机 origin，其他环境须显式 `--origin`。工具不读 .env、不上传脚本、不执行脚本、不发通知；PUT 后匿名读精确版本核对。token 不进入命令参数或输出。

## 10. 错误、契约与验证

统一 `{error:{code,message,details?}}`。400 输入／cursor，401 会话，403 角色，404 隐藏，409 状态机冲突，412 资源版本前置条件，426 客户端版本。412 必须带 resource/expectedVersion/currentVersion；失败之后再读取真实 currentVersion，不能返回竞争前捕获的旧值。

HTTP/bridge DTO 的公共定义归 `packages/contracts`；调用方不维护平行类型，不用文档中的示例替代 schema。设计合理性由独立 review 评估；现有测试与最小烟雾证明行为与回归，不写源代码断言、接线断言或繁琐参数组合矩阵。

原四轮 API 复核后的暂停及续作记录、设计质量与行为验证见 `api-audit.md`／`state.md`；历史授权不代表当前执行状态。详情互动状态加载前禁用关系写入。2026-10-28 产品整合允许按关注点提交 PR、强制 CI 与独立审查通过后合并；不授权生产部署、tag 或远程业务数据迁移。

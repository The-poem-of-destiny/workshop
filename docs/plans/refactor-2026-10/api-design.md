# API 设计：用户旅程、不变量与缓存边界

日期：2026-10-22。状态：API 原剩余缺陷曾经独立复核及本地验证；用户随后要求纠正旧数据兼容优先的重构方向。现按 D-39 收敛 schema、删除历史索引回退；本次验证与本地提交结果见 [state.md](state.md)，不沿用旧检查作为新结果。

## 1. 平台事实：Workers Cache 不是 Cache API

**Workers Cache ≠ Cache API。** 前者位于启用缓存的 Worker `fetch()` entrypoint 之前；HIT 不执行被缓存入口。后者是 Worker 内显式 `caches.default.match/put/delete`，每次仍运行 Worker，且不自动提供分层与请求合并。本轮已删除旧 Cache API helper，使用 gateway 与命名 Public 入口，未以改名替代机制。

已核实能力与限制：

- Wrangler `cache.enabled` 及 `exports.<entrypoint>.cache` 控制入口；同一 Worker 的 `ctx.exports` fetch 也可经过目标入口缓存，自定义 RPC 不经过缓存。
- 键包括 entrypoint、path/query、默认 Worker version、受信任 `ctx.props`；host、普通身份头和 body 不自动隔离身份。GET/HEAD 共用；query 顺序／尾斜杠需要规范化。
- 自动 lower/upper tier、同一数据中心内同 key 可缓存请求的 collapsing；不是业务全局单次执行保证。
- TTL、SWR、`stale-if-error`、Vary、条件重验证由 HTTP 策略控制。缺少显式头时 200 可缓存两小时，404 可缓存三分钟；默认错误兜旧可能无限期，不能只凭 max-age 宣称陈旧有界。
- `ctx.cache.purge` 删除，`invalidate` 标 stale；均限缓存所属 entrypoint，全球传播但 success 只证明接受请求，不是 D1 提交与失效的共同事务。Free purge 每分钟 5 次，不能把每次互动都变成强制 purge。
- HIT 仍计请求；内部缓存 fetch／静态交付也有计费影响。网关执行与查询不会因为内部命中而消失。
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
| I01 | 对新到达的匿名读取，隐藏／删除后不能因旧共享缓存继续泄露摘要、索引或封面 | D1 primary 上读取公开代际；公开状态变更与代际递增在同一事务。epoch 读取失败必须 fail closed（返回不可缓存错误），不得退回常量／旧值。已开始且取得旧 epoch 的读取可在线性化点之后完成，不承诺追回已送达字节 |
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

- Workers Cache 的默认键不含 host。Public 响应必须对 host 无关；如未来内容依赖 host，须拒绝共享或由可信网关显式分区，不能让请求的 Host 污染共享对象。
- HIT 保留外层 gateway 执行及其 epoch D1 read；评估不能把它描述为完全消除 Worker 或 D1。
- gateway epoch 查询失败必须 fail closed，不能复用旧 helper 的 `row?.value ?? "0"` 默认值。


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
| catalog／home／榜单／封面 | D1 当前公开投影与受控缓存 | 必须定义依赖、键和失效代际 | 匿名／登录用户相同公开表示 |
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

## 6. 缓存设计：先满足边界，再选择平台能力

### 6.1 选择与未选择

选择默认不缓存的外层 gateway，加一个只处理明确公开资源的 named `Public` entrypoint；只有目标入口使用 **Workers Cache**。删除旧 Cache API lookup/put，不保留第二套本地 TTL cache。

拒绝“把整个 Hono 默认入口缓存”：会让 HIT 绕过鉴权或状态检查，错误响应也可能启发式缓存。暂不增加 Viewer 个人缓存：数据低共享、写后立即读取，与本轮收益不匹配；个人读取 no-store 更直接。拒绝仅靠 tag purge 实现 I01：其接受响应不是同步全球完成屏障，且有 Free 限流。

**一致性选择：受信任公开代际作为 `Public` props。** Gateway 每次可缓存公开请求从 D1 primary 读取一次公开代际；公开结构写入在同一事务递增。Workers Cache 键因 props 代际变化而变化；Public 的 HIT 可跳过完整投影加载，但不能消除 gateway 的一次小查询。这个有意的成本换取下架／隐藏边界，不宣称零 D1 或全程不执行 Worker。

不依赖未证实的 `private,no-store` 与 cacheable CDN 头组合：内部 Public 响应有明确缓存策略；外层 gateway 收到响应后重新设置外部 `Cache-Control: private, no-store`，剥离内部 Cache-Tag／CDN 控制头。浏览器和下游 CDN 不能绕过下一次 gateway 检查。仅真正不可变、公开且不要求撤回的脚本版本对象对浏览器 immutable。

- `ctx.cache.purge()` 的成功仅表示失效请求被接受，不代表同步全球清除已完成；正确性使用新 epoch namespace，不能把 purge 成功返回当作线性化屏障。

### 6.2 入口与缓存键

- default：缓存显式关闭；负责 allowlist、query 规范化、读取代际、身份／私有路由，不允许客户端头或 props 冒充内部身份。
- Public：只接受 GET/HEAD 的已登记公开表示，不接受写、票据、私有资源或任意 Hono 路径；MISS 时仍用公开查询条件获取数据。
- key：entrypoint + canonical path/query + Worker version + trusted public epoch。保留所有影响结果的合法 query 值；去掉无关追踪参数，排序 query，归一已知默认值／尾斜杠。无效参数应明确失败，不悄悄缓存另一种请求。
- 转发新 Request，不修改原请求；移除 Authorization、Cookie、Origin 和不参与规范的 header。CORS 在最外层按原始 Origin 重建，避免把某用户的 Origin 头缓存给别人。
- 不启用 cross_version_cache；部署产生新的 version namespace。不能声称回滚删除旧 namespace。

### 6.3 每类响应的策略

| 响应 | 内部策略 | 外部浏览器策略 | 代际／失效依据 |
|---|---|---|---|
| 列表、搜索、详情、发现栏、榜单、home、site、推荐、reference 投影 | 明确短 TTL，基线 30s，`stale-if-error=0`，不启用 SWR | private,no-store | 公开结构代际；不能缓存用户字段 |
| 公开封面／当前 banner | 相同公开代际内短 TTL | private,no-store | 当前有权引用的存在性，不按任意 assets 第一行判断 |
| 私人关系／作者／审核／OAuth／票据／文件 | 不进入 Public | private,no-store | 每请求会话和状态检查 |
| 不可变 client/checker 版本对象 | named 公共缓存，长期，version 分区 | public,immutable 一年 | 内容寻址、禁止覆盖；不依赖当前项目 visibility |
| client channel pointer | 当前先不缓存可变指针，始终回源，使用 ETag | no-store | D1 channel 与 R2 对象顺序未有部署证据前，不使用 300s 旧指针掩盖不一致 |
| compatibility／version／health／错误响应 | 不缓存 | no-store | 版本门禁必须当前；错误不启发式缓存 |

这里的公开计数 30s 陈旧是展示取舍，不扩展到可见性、身份、票据或写前置条件；不允许无限错误兜旧。

### 6.4 公开代际的依赖闭包

代际必须与变更同一事务，覆盖：公开项目发布指针／可见性／删除／可见元数据，当前公开 revision 的展示元数据／封面关联，用户公开名称／头像，发现曝光／完整排行快照切换，精选、site/banner、参考集／版本／条目变化。计数型 likes/downloads/subscriptions 不逐次递增，以短 TTL 表示允许的计数延迟。草稿私有编辑尽量不使公开键失效。

读取顺序是 epoch → Public lookup/loader，不能先读 DTO 再取 epoch。变更期间已读到旧 epoch 的在途请求可按该点完成；后续请求读取新 epoch，不会命中旧 namespace。缓存旧代际无需立即删除才能保证 I01。

tag 可用于拥有缓存的 Public 内管理失效；purge/invalidate 的真实实现与验收需区分。当前正确性不依赖 purge 接受结果，不为“能力已支持”添加无调用方的控制 API。以后若使用，必须从 Public 自身调用、检查结果，不能声称 default purge 已清理所有入口。

### 6.5 开启门禁与运行证据

Wrangler 代码只对预发入口配置缓存，production 继续关闭；不自动部署。没有本地 Cache API fallback 或伪造 HIT。Local E2E 验证路由、权限、代际变化、外部头与用户行为；真实 Workers Cache HIT、tiering、全局 purge 和请求费用留授权后的最小 hosted smoke，不扩建繁琐测试矩阵。

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
- `PATCH /projects/:id/published-metadata`：If-Match；D-30 对当前 public projection 单独改展示元数据，写 project-level public fields，不写 `project_revisions`。即使另有 pending revision，也不得变更其 review metadata／manifest；public query 明确使用 project-level 当前展示字段。metadata checker、audit 与公开代际同批写入。
  - 展示字段包含 title、description、authorNote、project/extension type、tags、versionLabel、schemaVersion、Discord thread URL、precautions 与 cover presentation。迁移从已发布 revision 初始化必要字段，后续直接读 project-level 值，使显式 null 清空不被 fallback 撤销。Discord URL 先 normalize／allow-list，再写入，不改冻结 revision。
  - `GET /projects/:id/published-metadata` 与 `GET /projects/:id/published-cover` 是作者／owner 的编辑读取；`PUT /projects/:id/published-cover` 使用 If-Match、MIME／大小／尺寸校验与不可变 R2 字节，原子切换 project-level cover association、递增 rowVersion／epoch 并写审计。无 display cover 时读取 published revision cover；不得改写 pending／published revision 的 snapshot。
- `POST /projects/:id/revisions`：If-Match；生成 successor，继承当前未变不可变资产，移动 working 指针；保留上一轮历史。
- `PUT /projects/:id/revisions/:rid/files/:kind`：If-Match；校验 MIME/长度/内容，R2 写不可变对象；资产关联、revision 计数及 project rowVersion 在同一 guarded D1 batch 成功 CAS，rowVersion 恰增一并返回。两个相同 If-Match 的并发上传至多一个成功；失败不得更改资产、计数或版本。R2 可能留下无引用不可变对象，由孤儿清理回收。
- `DELETE /projects/:id/revisions/:rid/entries/:kind/:key`：If-Match；产生 successor，不改旧资产、不复制未变 R2。
- `POST /projects/:id/revisions/:rid/submit`：If-Match。路由先校验会话、作者/owner、项目未删除、当前 `working_revision_id = rid`、rowVersion 与无冻结 submission，**然后**才调用 DO 做内容读取/解析；最终 batch 再绑定捕获的 rowVersion、working 指针与资产指纹。DO 校验与索引完成后才原子冻结 revision、递增 rowVersion、写 manifest/完整索引、supersede 前一个未解决 submission 并插入可领取/待人工项。提交行在该 batch 前不存在，因此 scheduler/DO 无法领取未完成校验。失败不创建可领取项、不 supersede 旧 pending。返回真实 status、checkStatus、rowVersion。
- `PATCH /projects/:id/visibility`、`DELETE /projects/:id`：If-Match；可见性／软删除与公开代际同事务。

作者调用方必须串行传递 metadata／revision → 每个 revision upload → submit 返回的最新 rowVersion；published-metadata 与 published-cover 也使用 If-Match、返回最新 rowVersion，并在同一作者工作流中串行刷新。任一步 412 后停止并刷新，不继续把旧版本传给后续步骤。

### 7.4 审核、管理与调度

- `GET /api/v1/admin/submissions?cursor=&limit=`：reviewer 工作队列默认 pending，并返回全状态 counts；若支持 status 历史过滤，明确是管理历史查询，不新增第二套前端队列。无 snapshot 承诺。
- `GET /admin/submissions/:id`、`/:id/diff`、`/:id/files/:kind`：固定快照／固定 checker 报告。
- `POST /admin/submissions/:id/recheck`：仅未解决且非运行中，旧报告保留，切换检查版本写审计。
- Submit 时持久化 submission 的 `base_published_revision_id`；migration 如第 4 节。手动与 DO 发布只能在该基线仍为当前 pointer 时推进。
- `POST /admin/submissions/:id/review`：拒绝理由必需；绑定 revision、manifest、report 版本。批准必须原子检查 project 未删除、当前 `published_revision_id IS base_published_revision_id`、submission 仍 unresolved，再写成功状态、review/audit 并切 published pointer；这些操作必须互相依赖。手动或自动发布若 project 条件不满足，整组不记成功，返回/记录冲突。
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
| Web → host | cw:ready / cw:request-context | 请求角色、世界书、registry、扫描结果与客户端版本 |
| host → Web | cw:context | connected、characterName、worldbooks、registry、installStates、clientVersion；失败 error |
| Web → host | cw:install | 精确 project/revision 元数据、已取得的文件、目标世界书 |
| host → Web | cw:install-result | ok/projectId、目标／条目数／冲突，失败 message |
| Web → host | cw:uninstall | 明确 projectId；不能由退订隐式触发 |
| host → Web | cw:uninstall-result | removed、preservedEntries、preservedRegexes；保留玩家修改 |
| Web → host | cw:scan | 重新扫描实际本地条目／正则 |
| host → Web | cw:scan-result | registry、clean/localChanged/scanIncomplete 或错误 |

本地扫描状态不是服务端 installs 记录；Web 结合本地 revision 与公开 publishedRevisionId 区分未安装、最新、可更新、本地修改、扫描不全。

## 10. 错误、契约与验证

统一 `{error:{code,message,details?}}`。400 输入／cursor，401 会话，403 角色，404 隐藏，409 状态机冲突，412 资源版本前置条件，426 客户端版本。412 必须带 resource/expectedVersion/currentVersion；失败之后再读取真实 currentVersion，不能返回竞争前捕获的旧值。

HTTP/bridge DTO 的公共定义归 `packages/contracts`；调用方不维护平行类型，不用文档中的示例替代 schema。设计合理性由独立 review 评估；现有测试与最小烟雾证明行为与回归，不写源代码断言、接线断言或繁琐参数组合矩阵。

原四轮 API 复核后的暂停及用户授权续作记录保留；设计质量与行为验证分别留证，见 `api-audit.md`／`state.md`。前端第 3 轮确认已列修复；详情互动状态加载前禁用关系写入。最新用户授权要求先纠正 schema／历史兼容问题，再按职责创建本地 commit；仍不 push、不创建 PR、不部署、不破坏性修改远程数据。

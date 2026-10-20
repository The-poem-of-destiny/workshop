# Creative Workshop 独立重构方案

## 0. 结论与调查边界

**重写 Web 与后端的组织方式，保留经过验证的内容规则和安装安全机制；用“不可变修订 + D1 原子发布指针”替代现有草稿复制发布；一次性切换全部客户端、API 与新数据存储。** 不做旧 API 兼容，不以搬目录代替重构，不引入微服务、通用仓储框架或新供应商。

目标是一个 pnpm workspace、一个对外 Worker、一个明确的 HTTP/bridge 契约。React + Tailwind + shadcn/ui + Vite 是后续 Web 实现边界，本方案不设计组件和视觉。

### 调查口径

- 调查对象：本地 `main`，读取到的 HEAD 为 `0e6761e831b253f9e1b17de2f828d3ebeedb598d`。来源：`.git/HEAD:1`、`.git/refs/heads/main:1`。未刷新远端，不据此声称它是最新 `origin/main`。
- 下文证据路径均相对 `workshop/`。已读取项目规则、README、两层 package.json、manifest、Wrangler、完整 schema，以及路由、授权、上传、审批、存储、缓存、bridge、测试和部署的相关实现。
- 只读研究；未运行构建、测试、HTTP 服务、浏览器或 Cloudflare 命令。运行时性能、线上数据量、线上漏洞是否被利用均未实测。`277 KB` 这类生成响应大小不冒充测量结果。
- 未读取其他重构方案；仅本方案文件为交付物。下面的验收命令和场景是实施要求，不是本次已执行的检查。

### Brief 数字逐项核对

物理行数包含空行、注释；通过检索各源文件末行行号汇总，不把模板里的浏览器 JS/CSS 当作 Worker 业务 TypeScript。

| Brief 项目 | 仓库实际证据与结论 |
| --- | --- |
| Worker 约 29k LOC | `cloudflare/src/` 下 70 个 `.ts`（含声明文件）合计 **26,155 行**；23 个 `.mjs/.js` 合计 **2,813 行**，共 **28,968 行**。约 29k 成立，但不是全部 TypeScript。生成 `.txt` 不计入。 |
| endpoints 约 4.5k | 合计 **4,526 行**。例如 `endpoints/admin.ts:968`、`projects/read.ts:644`、`projects/write.ts:621` 为末行。 |
| utils 约 8.4k | `.ts` **5,537 行**，加 `.mjs/.js` 后 **8,350 行**；`utils/db.ts` 确为 **1,916 行**。 |
| home 约 15k 浏览器 JS | `pages/home/` 合计 **14,954 行**，其中 `styles.ts:2703`、`shell-styles.ts:1824` 两个样式源占 **4,527 行**；其余 **10,427 行**还包含 TS 组装代码。不能准确称为“15k JS”。 |
| 50 个 OpenAPI 路由 | 成立：`src/index.ts:225-264,267-271,275-276,324-336`，按显式 method/path 注册计 **50**，不含框架自动文档/HEAD。 |
| 3 个手工 GET | 不成立：**6 个 GET**，即首页、4 个 asset 路径、文件代理；另有 **1 个手工 POST** staging 排行重建。见 `index.ts:189-222,280-320,339-350`。`/assets/*` 不是一个实际通配注册。 |
| 一个 DO / regex 分流 | 成立：`index.ts:357-390`。`CodeCheckService` 重新进入同一个 Hono app；这里没有使用 DO storage。它有真实的 CPU/请求流转发历史理由，不能只因名字而判断仍在跑重型检查。 |
| `/assets/home.js` 约 277 KB，只以 new Function 验证 | 字符串组装成立，见 `pages/home/app.ts:34-69`；HTTP 语法检查确实只有 `new Function`，见 `scripts/check-home-js.mjs:1-8`。**277 KB 未核实**：仓库没有这份独立生成响应，本次没有执行组装或请求在线服务。且“只有语法测试”不成立：`tests/home-js-smoke.mjs:78-128` 执行了部分状态逻辑，另有 Playwright。 |
| 74 个 Node 脚本、10 个 Playwright specs | `cloudflare/tests/` 顶层确为 **74 个 `.mjs`**；`tests/e2e/` 确为 **10 个 `.spec.mjs`**。另有 `tests/worker/ejs-syntax-worker.mjs` 辅助 Worker，不计为第 75 个测试套件。文件数量不是行为覆盖率。 |
| 17 个 migrations | 不成立：目录为 **36 个 SQL 文件**，从 `0001` 连续到 `0036`；见 `migrations/0001_project_list_indexes.sql` 至 `0036_project_period_tracking_meta.sql`。 |
| 生成物约 932 KB | 两个 checker `.txt` 的工具目录尺寸显示约 **461.9 KB + 459.8 KB = 921.7 KB**；这不是字节级统计，不能确认 brief 的 932 KB。还存在约 615.2 KB 的 `util/ejs-checker-v2.js`。`dist/`、`test-dist/`、`test-bundles/` 均存在；`index.ts:6-13` 证明服务端导入并解码两个 Base64 生成物。 |
| D1/R2/KV/DO/cron | 生产声明分别为一个 D1、一个 R2、一个 KV、一个 DO binding，以及 `0 2,8,14,20 * * *`。见 `wrangler.jsonc:18-46`；这是配置事实，不等于已核实线上绑定和调度状态。 |
| 两种包管理器 | 成立：根 `package.json` 声明 pnpm；Worker 的 `package-lock.json`、README npm 命令及 `.github/workflows/cloudflare-checks.yaml:32-45` 构成独立 npm 流程。 |
| PowerShell hardcode upstream/main | 成立：`scripts/deployment/deploy-worker.ps1:309-310,377-395`；实际 Git config 仅配置 `origin`。但该目录 README 明说是 **未激活的候选实现**，不能断言线上正在用它。见 `scripts/deployment/README.md:3-7`。 |
| 三处 caches.default、五类 Cache-Control | 成立：`endpoints/projects/read.ts:157,206`、`endpoints/recommendations.ts:69,113`、`utils/site-settings.ts:54,74,91`；`index.ts:154-178` 为五类中间件分支，文件代理和 checker 还有各自策略。 |
| 浏览器 15s fresh / 60s stale，酒馆缓存 5min | 列表成立：`pages/home/api.ts:217-220,292-300`。但清单不完整：同文件有详情 60s、repair 5min；酒馆 `services/project-fetch.ts:5-6` 为详情 5min、世界书源 30min，`services/diff.ts:21` 为 diff 5min；checker 另有模块内缓存。 |

## 1. 诊断：先修不变量，再缩减结构

优先级定义：P0 是发布/权限/切换门禁；P1 是本次重构必须解决的结构性问题；P2 是无需阻塞业务的清理。以下安全结论来自静态路径分析，不声称已完成利用验证。

### P0：发布不是一个原子动作，补偿代码已经替代了数据模型

**证据：** `endpoints/admin.ts:576-700` 先更新审核状态，再复制 R2，再逐字段覆盖正式项目，失败时分别回滚 R2、恢复草稿状态，最后清理兄弟草稿并删除已批准草稿。`utils/r2.ts:127-288` 为此预读新旧对象到内存，维护 backups/mutatedKeys 和反向恢复。`utils/db.ts:709-753` 又用 `content_mutation_token` 协调上传和审核。

**问题：** D1 和 R2 没有共同事务；异常退出不一定运行 catch，补偿失败也只能记录日志。由此推导的风险是正式元数据和文件代际不一致、待审内容被覆盖、孤儿锁/对象以及并发审批恢复交错；不是说现有每次发布都会坏。

**决定：** R2 对象不可变，修订快照不可变，发布只切 D1 指针。删除跨存储覆盖回滚，而不是再加一层锁或后台补偿状态机。

### P0：鉴权规则散落，登录门禁与真实内容访问不是同一条规则

**证据：** `projects/read.ts:501-555` 的 install-info 要登录且检查公开状态；`index.ts:280-311` 的实际文件代理对 `approved` 项目允许匿名获取，且不检查 `visibility/is_published`；`projects/read.ts:593-638` 的公开详情又返回世界书/Regex 内容预览。只把 downloadUrl 清空不能形成内容访问控制。

**决定：** 匿名允许浏览元数据；完整可安装 JSON 与完整源内容必须经过同一访问函数。草稿仅作者/审核者可读。公开详情可保留内容摘要和条目索引，不返回绕过登录门禁的完整 source。隐藏项目默认对非作者/审核者返回 404；若产品实际需要“不上架但持链接可访问”，另建明确的 `unlisted` 状态，不能继续让 visibility 含糊。

### P0：管理员权限被长期固化在 token，登出不撤销会话

**证据：** `utils/jwt.ts:92-114` 默认签发七天 JWT，payload 含角色；管理员 endpoint 直接检查 payload，例如 `endpoints/admin.ts:509-511`。`endpoints/auth.ts:448-468` 的 logout 只返回成功；`AuthMe` 同样读取 token 中角色。撤销管理员后旧 token 仍可能具有旧权限，这是静态推导。

**决定：** 改为可撤销的 opaque session，角色从 D1 当前记录读取；OAuth 领取凭证与授权 URL state 分离。不用 KV eventual consistency 承担“一次性消费”或角色撤销。

### P1：Web 不在语言工具链里，代码组织是假模块化

**证据：** `pages/home/app.ts:34-69` 将多个片段注入一个 IIFE；还有数组逐行拼 JS，见 `modal/admin-review.ts:738`。`cloudflare/tsconfig.json:12-15` 关闭 implicit-any 与 strict-null 的关键约束；字符串中的浏览器代码本来就不接受 TS 检查。`webpack.config.cjs:34-37` 对酒馆脚本也仅 transpile。

**决定：** 删除整套字符串 UI；Web 用独立 Vite 应用，真实模块、类型检查、静态资产。不要做“先把字符串移到另一个目录”的中间架构。

### P1：路由、CPU 分流、内容传输协议互相打补丁

**证据：** `index.ts:357-390` 按 regex 维护另一份需转发的 method/path；`projects/assets.ts:87-150,266-283` 的 preflight 先传完整内容以取得签名，正式上传再传一次。该签名不证明创作者真的执行了规则分析，注释对此说得很清楚。`admin.ts:23-27,132-167` 则明确把审核者视为可信批准者。

**决定：** 删除 creator receipt/preflight 的重复传输，上传一次即完成服务端大小、结构、hash 检查；创作者本机 checker 仍是体验预检。保留审核者检查及 hash/修订/规则版本绑定，不能把删 DO 曲解为取消审核。

### P1：db.ts 混合访问、产品策略、序列化、兼容和后台生成

**证据：** `utils/db.ts:1-25` 依赖 taxonomy、排行生成、R2 与版本规则，方法接收 Hono `AppContext`；`read.ts:16-40` 靠删除字段限制公开 DTO，`db.ts:35-38` 用 Symbol 防止审核证据混入 JSON。

**决定：** 具体 SQL repository + 显式 DTO + 模块 use case。禁止通用 `update(project, arbitraryFields)`，禁止“先查全字段再删私有字段”。数据层不依赖 HTTP，也不调用 cron 或 R2。

### P1：缓存不是三层，而是多份有副作用的数据副本

**证据：** 列表命中前仍查 D1 revision，命中后再合并用户点赞，见 `read.ts:143-164`、`read.ts:44-67`；公开计数与 revision 由 `schema.sql:112-175` 多个 trigger 维护。文件 GET 同步计数，`index.ts:299-301`，因此不能简单把所有文件直接缓存。banner 删除当前缓存键并不构成跨 Cloudflare 机房的全局失效证明。

**决定：** 首版动态 API 不做共享缓存；缓存只给内容哈希静态构建资产。保留真正的排行物化数据，但不把它们混称缓存。删除 revision 计数器驱动的列表缓存及酒馆的时效型远程副本；先用预算与实际查询证明是否需要恢复优化。

### P1：发布流程的仓库事实已变，工具链仍停在拆仓前

**证据：** 部署脚本依赖 `upstream/main`，本地实际 remote 仅 `origin`；脚本还依赖 `C:\Project\cotel\...`，见 `deploy-worker.ps1:147-160`。工作流 build 使用 `pnpm install --no-frozen-lockfile`，见 `.github/workflows/bundle.yaml:39-43`；Worker CI 只跑选定的 check:home 和语法检查，不是全部 74 个脚本。

**决定：** 可复现的跨平台 CI 发布，固定 lockfile，staging 验收 exact SHA 对应的同一制品，再生产提升。不把候选 PowerShell 修到能跑当作长期方案。

### P2：可以直接证实的死代码、历史表和兼容镜像

- `utils/auth.ts:259-351` 的 KV session 模块只见内部 `session.get` 调用，生产 endpoints 使用 JWT；重构删除，不同时维护两套登录体系。
- `utils/project-ranking-snapshots.ts:89-235` 的旧小时排行模块，源码调用仅在自身；外部引用是 `tests/project-ranking-snapshot-smoke.mjs:4-13`。真实 cron 是 `index.ts:391-393` 的新排行生成。删除模块和旧 `project_rank_snapshots` 表，不迁移其派生数据。
- `schema.sql:480-488` 已明确 `admins` 是旧保留表；实际权限来自 users/super_admins。删除旧表。
- taxonomy 的旧 `tags` 镜像、显示标签 NULL 回退是历史契约，见 `cloudflare/README.md:70-82`。新契约只保留 canonical taxonomy，数据迁移阶段一次性解码旧值。

### 明确删除清单

删除发生在新系统通过验收、替换旧路径的同一 cutover 分支；旧服务在此之前继续独立运行。旧提交/备份用于回退，不在新生产代码里留并行实现。

| 删除对象 | 替代/保留边界 |
| --- | --- |
| `cloudflare/src/pages/home/**`、`pages/home.ts`、动态 home.js 路由 | `apps/web` 的 Vite 静态资产；功能验收后整组删除。 |
| `contentServiceKey`、`CodeCheckService` HTTP 转发、对应 binding | 单一 Worker 路由；使用满足 CPU 预算的 Workers 付费执行环境。旧 DO namespace 不在切换时破坏性删除。 |
| `ProjectUploadPreflight`、creator receipt 协议及校验 | 单次限流上传；保留真实结构校验与受信审核者的内容绑定。 |
| chanfana endpoint 类、旧 `/api/*`、toggle like/subscribe 双协议 | 一份 Hono schema 路由表生成 OpenAPI；新 `/api/v1` 契约。 |
| `utils/db.ts` 大对象、任意字段 update、私有字段删减 DTO、Symbol 隐藏证据技巧 | 按领域 SQL 与显式读模型。 |
| R2 覆盖复制发布、backups/mutatedKeys rollback、`content_mutation_token` | 不可变对象和修订；D1 条件更新发布指针。 |
| 三处共享响应缓存、public counts revision 失效 trigger、自制前端列表/详情/repair TTL cache | 动态 API no-store；直接查询计数；仅 in-flight 去重与按内容哈希复用字节。 |
| 旧小时排行模块/表、`admins`、重复权限存储、legacy tags/version fallback | 一次数据规范化；保留当前有效排行功能及历史审核证据。 |
| `test-dist/` shim、`test-bundles/`、版本写死的调试 bundle | 新客户端分发通道，无旧路径 shim；历史 tag/外部备份不是新构建输入。 |
| 受版本控制的 `dist/`、checker Base64 `.txt`、离线 checker 生成 JS | CI 从源码生成发布制品，作为 Static Assets/下载包分发；保留第三方许可证来源与 notices。 |
| 两套 lockfile、webpack、多余包装 check 脚本、机器专属部署 helper | 一个 pnpm lockfile，Vite/esbuild + Wrangler，少量可组合脚本。 |
| 源字符串/文案/实现写法断言、从文本切函数再 eval 的测试 harness | 保留对应业务反例，改为真实模块或 HTTP/宿主行为测试；不重钉旧字符串。 |
| staging 固定 magic-header 重建路由、生产可见 local-preview 登录分支 | 本地测试入口由独立测试 Worker 组成，不进生产路由。运维任务从受控 CI 调用。 |

不借清理删除私人评分/留言、抽签、编辑精选、兼容性或修复能力；这些是产品行为，不因作者是 AI 就自动判为无用。

## 2. 目标架构

### 2.1 仓库与依赖方向

```text
workshop/
├─ apps/
│  ├─ web/                    # React/Vite；只约定网络与 bridge 边界
│  ├─ worker/
│  │  ├─ src/
│  │  │  ├─ index.ts          # fetch/scheduled 组合入口，无业务分流 regex
│  │  │  ├─ http/             # 路由、auth context、DTO、错误映射
│  │  │  ├─ modules/
│  │  │  │  ├─ identity/      # OAuth、会话、角色
│  │  │  │  ├─ projects/      # 修订、投稿、审核、发布
│  │  │  │  ├─ catalog/       # 搜索、精选、榜单、抽签
│  │  │  │  ├─ interactions/  # 点赞、订阅、私人评分
│  │  │  │  └─ administration/# 成员、站点设置、审计
│  │  │  ├─ storage/          # D1 连接、R2 对象读取/写入的具体函数
│  │  │  └─ jobs/             # 排行生成、过期会话/孤儿资产回收
│  │  ├─ migrations/          # 新库从 0001 开始，唯一 schema 演进源
│  │  └─ wrangler.jsonc       # 显式 environment bindings
│  └─ tavern-client/          # TH 适配、bridge host、安装/更新/卸载/修复
├─ packages/
│  ├─ contracts/              # Zod HTTP/bridge schemas、错误码、公开类型
│  └─ content/                # 格式解析/规范化、fingerprint、checker 纯逻辑
├─ config/
│  └─ workshop.json           # 发布通道/端点/配套脚本依赖唯一来源，删 legacy 字段
├─ data/                      # 有版本的官方基线；不是用户数据导出
├─ tools/                     # 构建、发布、迁移程序
├─ tests/                     # 集成、端到端、迁移样本
├─ docs/                      # API/发布/数据迁移手册及决策记录
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml
└─ package.json
```

规则：

1. `contracts` 和 `content` 不引入 Hono、Cloudflare binding、DOM、TH 全局对象；Web Worker wrapper 放在 Web/离线工具入口。
2. Web 和酒馆仅引用 contracts/content，不引用 Worker 实现。不得复制 DTO、taxonomy 或 checker 规则到浏览器字符串。
3. Worker HTTP → use case → 具体 repository/storage；repository 接收 D1 binding，不接收 `Context`、不直接返回 `Response`。多表事务由 use case 组织具体 SQL，无通用 ORM/repository interface 工厂。
4. 产品 taxonomy、内容要求等纯规则放入 `content` 的具名模块；排行参数只在 Worker catalog 模块维护。不要增加一个什么都装的 `shared/utils`。
5. Tavern Helper 依赖在 `tavern-client` 内适配。安装逻辑可提取纯函数，但不把宿主读写抽象成全仓库插件框架。
6. 所有包 strict TypeScript；第三方边界用 `unknown` + schema，而非 `Record<string, any>`。checker 现有 JS 先用真实行为套件约束，迁入时逐模块类型化，不同时改规则语义。

### 2.2 运行拓扑

```text
普通浏览器 / SillyTavern iframe
     ├─ HTTPS ── 同源 Worker
     │              ├─ /、/assets/*、/client/*、离线 checker → Static Assets
     │              ├─ /api/v1/* → Hono → D1 / 私有 R2
     │              └─ scheduled → 排行/维护任务 → 同一个 D1/R2
     └─ postMessage / MessageChannel → 酒馆脚本 → Tavern Helper 本地状态
```

- 单一公网入口，不拆前后端域名，不新增 BFF、内部 HTTP 服务或常驻 DO。
- Static Assets 的 API、文件及 OAuth 路径必须 Worker-first，未匹配 `/api/*` 返回 JSON 404，不得被 SPA fallback 返回 index.html。
- 完整 checker 在创作者/审核者的 Web Worker 跑；服务器只做上传格式、大小、hash、身份、修订、批准结果绑定。绝不执行上传的 EJS/Regex 代码。离线 checker 使用同一源码和规则版本。
- **执行环境决定：** 新 Worker 按付费 Workers CPU 配额设计，配置有限的 CPU 上限，以实测预算验证。当前网关“10ms”理由见 `index.ts:353-356`，不能在原配额下盲删 DO。若费用未获批准，阶段 1 不得宣称完成该拓扑；必须明确重新评估资源约束，不隐式保留第二套路由表。
- 不引入 KV：新 OAuth 和 session 使用 D1 原子消费；现有 KV 仅属于旧环境直到退出。

### 2.3 数据模型：身份、修订、审核、正式版本分开

新库不执行旧 schema + 36 个迁移；从新 `0001_initial.sql` 建库。此后 migration 是结构唯一来源，schema 快照只能生成，不能手写维护第二份。

| 表/集合 | 关键字段与约束 |
| --- | --- |
| `users` | 保留 Discord user id；展示名、头像；单一 role=`member/reviewer/owner`。不重复 users.is_admin/super_admins/admins 三套权限。 |
| `sessions` | token 的 SHA-256、user_id、expires_at、revoked_at；token 原文不存库；每请求读取有效会话与当前角色。 |
| `oauth_flows` | state hash、独立 redeem-secret hash、状态、过期时间、临时 claim token、result user/session 关联；终态原子消费。 |
| `projects` | 稳定 id、author_id、visibility、published_revision_id、working_revision_id、row_version、deleted_at。作者权限和上架状态属于项目，不复制到每个草稿身份。 |
| `project_revisions` | id、project_id、revision_no、base_published_revision_id、元数据快照、asset 引用、manifest_hash、创建人/时间；插入后不可变。`UNIQUE(project_id, revision_no)`。 |
| `assets` | id、R2 key、sha256、bytes、mime、kind、created_at；R2 key 用不可变 UUID，不存环境绝对 URL；全项目不做跨用户去重。 |
| `submissions` | revision_id、state=`pending/approved/rejected/superseded/withdrawn`、提交人/时间；一个项目最多一个 pending，用 partial unique index 约束。 |
| `reviews` | submission_id UNIQUE、reviewer_id、decision、reason、manifest_hash、checker_version、report、人工风险接受原因；审计证据独立存放，不进入公共 DTO。 |
| `likes/subscriptions/ratings` | project_id + user_id 唯一；评分 1..5，留言仍仅本人可见；服务器不信任“我已安装”的客户端自报作为权限证明。 |
| `project_metrics_daily` | 项目/日的下载、点赞变化；保留旧追踪起点与历史基数，不用重建当前点赞数冒充历史事件。 |
| `ranking_runs/ranking_entries` | 一个 complete run 指针；类型/排行/项目/序号；生成完整后发布，读请求只查询，不启动生成。 |
| `discovery_exposures/draw_state` | 保留有效曝光窗口、抽签次数/最近项目；日期规则明确，计数条件更新，不把客户端 UI 禁用当配额。 |
| `recommendations/site_settings` | 保留精选作者、说明和 banner。展示资料确有引用才保留 curator profile；不迁移无调用的历史预设副本。 |
| `character_references/reference_versions/reference_items` | 保留基线版本、源条目标识、hash 和兼容性/冲突选择，发布修订引用对应版本。 |
| `audit_events` | actor、action、subject、requestId、时间、必要 before/after；业务关键写入与审计同一个 D1 batch。 |

所有关联 FK、枚举 CHECK、唯一约束在 migration 中实现。项目指针必须指向同项目的修订，用组合键/FK 约束；submission 与 review 只能指向该项目的修订。内部时间统一 UTC 整数毫秒；抽签/排行的产品时区显式配置，不靠 `CURRENT_TIMESTAMP` 字符串与 ISO 混用。

#### 写入与发布算法

1. **编辑：** HTTP 必须带 `If-Match`，对应项目 row_version。创建不可变修订；在 D1 batch 中条件切 working 指针并递增版本。所有后续 SQL 以该 CAS 成功标记为前提，不能“batch 第一条更新 0 行，后续仍插入投稿/审计”。每次冲突返回 412。
2. **上传：** 有限流读取，不能只信 Content-Length；一次读取、验证、计算 hash，R2 写入新对象成功后登记 asset。上传不覆盖现有 asset。D1 登记失败只产生无引用对象，不影响旧修订。草稿文件引用必须属于本项目可访问资产。
3. **提交：** 将当前修订封为 submission；本机创作者 checker 是预检提示。用户后续编辑建立新修订；重新提交在同一事务 supersede 旧 pending，不能修改审核者正在看的字节。
4. **审核：** 审核者按 submission 读取不可变 manifest 与文件，运行 checker；决策携带 submissionId、manifestHash、checkerVersion、report 和必要 override reason。服务器检查当前角色、pending 状态、规则版本和完整内容绑定。不再签发创作者“检查通过”证明，也不声称能远程证明审核者执行了未修改的 JS。
5. **批准：** 验证所有被引用 asset 已就绪，在一个 D1 batch 内 CAS submission 状态、检查 base published 指针、写 review/audit、切 published_revision_id。以变更标记 guard 所有后续 SQL。竞争者必须 409；过期 base 必须重新提交，不能最后写入者静默覆盖。
6. **下载：** 从 published revision 的 manifest 得到具体 asset；每次检查 session 和项目访问权，再 stream R2。发布后撤下项目立即阻止后续请求，不依赖 CDN purge。
7. **删除/回收：** 项目先软删除。定时清理超过保留期、无修订/审核/站点引用的对象；D1 未登记的对象通过 R2 分页 inventory 比对处理。首次只产 dry-run 报告，确认后启用回收。旧桶永不作为回收目标。

D1 batch 事务和条件 guard 在真实 workerd/D1 测试中证明，不能把 mock 的 `.changes` 当成原子性证据。无需 R2 跨对象事务、DO 项目锁或数据库 advisory lock。

#### 查询与搜索

- 保留直接 SQL 与显式索引，不引入 ORM。按 use case 给出参数化查询；列表返回轻量摘要，不读取 R2、解析世界书或进行逐卡片 enrich。
- 新目录读模型显式关联 published revision；项目总数按同一公开条件 `COUNT`，不保留全局 revision/counter triggers。点赞/订阅按当前页批量查询，私人状态走独立 `/me` 接口。
- **不草率删除现有中文短搜索。** `schema.sql:490-618` 已实现 trigram + 短字索引和精确标签索引。迁移时保留搜索字段范围和 1/2 字中文子串行为，重新生成搜索派生表。先保留经行为测试验证的 FTS 方案；只有测量证明更简单查询满足相同结果与预算，才替换。描述当前不参与搜索，不擅自扩大范围。
- 列表采用有上限 limit + 不透明 cursor；按 `(排序值,id)` 稳定排序，榜单 cursor 包含 runId。数值实时变化时不承诺跨页 snapshot isolation，但保证确定的 tie-break；新榜发布使旧 cursor 明确失效，而非静默混页。
- 保留当前发现/评分/时间/互动/7日/30日排序能力，取消把页号最大 19 当作架构限制。配额、页大小、搜索长度集中配置，以真实扫描行数验收。

### 2.4 配置与安全边界

- `config/workshop.json` 仍是发布通道、地址、配套脚本依赖的单一来源，删除旧 shim/migrations/别名；不得把 secrets 或 D1/R2 数据放进去。
- Wrangler 管 binding 和环境，不再 `keep_vars` 隐式继承机器状态。生产/预发明确不同 Worker、D1、R2、OAuth app/redirect、session 密钥；本地使用本地模拟存储。
- 服务端 allowlist、上传/配额、排行参数与客户端提示分开：客户端可见规则从共享纯配置或 `/api/v1/config` 取得；服务端仍独立执行，浏览器配置不具权威性。
- 首个 owner 从一次性受控初始化命令写入 D1，记录审计；禁止每请求拿 env user id 暗中覆盖角色。迁移将旧 super-admin 来源统一成 owner，冲突必须人工确认。
- `/api`、`/files` 等响应不向任意 origin 开 credentialed CORS。正常网络请求都在 Workshop iframe 同源发出；TH 宿主通过 bridge 接收所需字节/结构化任务，不把 bearer token 存酒馆变量。
- CSP 不使用 script unsafe-inline；外部依赖打包为本地静态资产，保留 iframe 嵌入所需策略，不设置会禁止 SillyTavern 的 X-Frame-Options。固定允许 frame ancestor 不适合用户自托管酒馆，安全依赖窄 bridge 与显式用户授权，而非全站 wildcard credential CORS。

### 2.5 Auth、错误与 bridge 契约

**会话选择：opaque bearer session，而不是把 iframe 登录押在第三方 cookie 上。** 目前存在 WebView/外部浏览器路径，见 `endpoints/auth.ts:32-36,210-224`；改成 cookie-only 会引入第三方 cookie 阻断风险。

- 32 随机字节 token，仅服务端存 hash；Web 在 sessionStorage 持有，登出撤销当前 session。角色变更即时按 D1 生效，session 绝对有效期先维持七天。XSS 仍可窃取 bearer，靠 CSP、无任意 HTML 执行、依赖管控降低风险，不宣称 opaque token 自动解决 XSS。
- `POST /auth/flows` 返回 authUrl、flowId、独立 redeemSecret。OAuth URL 只带 state，不带 redeemSecret。回调原子 claim state，再向 Discord 换 code；claim 设有限租约，外部失败将流程标失败并允许新建登录，不能无限卡住。
- 创建流程和回调都校验已配置 origin/redirect，不使用任意 Origin 生成外部回跳。只保存需要的 Discord 身份及准入结果，不长期保存 access/refresh token；退出不调用 Discord revoke 冒充本地会话撤销。
- 回调只通知“完成”，不通过 `postMessage('*')` 发 token；poll/redeem 必须同时持 redeemSecret。领取使用 D1 原子终态转移，重复消费失败；领取响应丢失时重新登录，不额外维护可重复领取七天 token 的缓存。
- 社区成员资格首次登录检查；会话到期重新检查。即时 Discord 退群撤权若是产品硬要求，必须另定验证周期和 API 预算，不偷偷假设 OAuth 初次检查永久有效。

错误统一为：

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "项目已更新，请刷新后再试。",
    "requestId": "...",
    "details": { "currentRevisionId": "..." }
  }
}
```

400 格式错误；401 无有效会话；403 已登录但不具操作角色；404 不存在或不可见资源；409 业务状态冲突；412 If-Match 失败；413 超限；422 内容规则不满足；429 配额/频率限制；500 只返回通用信息，内部堆栈记录 requestId。修复 `index.ts:96-107` 直接把异常 message 返回客户端的做法。只有允许公开的 details 可出现在响应。

**bridge：** `packages/contracts` 定义带版本的 discriminated union，每条消息严格校验 payload、requestId、操作类型、大小。当前协议只校验 namespace/type 字符串，见 `bridge/protocol.ts:43-49`，不足以成为最终边界。握手校验 `event.source` 与固定 Workshop origin，建立 MessageChannel；随后只用该端口通信。版本不匹配明确提示重装，不兼容旧协议。

保留安装/更新/卸载、目标世界书选择、移动已安装内容、新建附加世界书、diff、修复、原版冲突确认与关闭界面能力。Web 负责远端数据/auth，酒馆脚本只负责宿主状态和受用户同意的本地操作。每任务携带 projectId、releaseId、manifestHash、操作 id；串行化同一本地写入范围。超时后先重新扫描真实状态，不能把超时当作“肯定没写入”后盲重试。

本地安装完整验收后才登记新 releaseId；混合版本/Regex 失败必须报告部分完成并保留恢复信息。现有 `bridge/host.ts:116-132` 的最终扫描与 `tests/creative-workshop-install-safety-smoke.mjs:162-176,226-229,262-271` 的反例值得保留，不为简化后端牺牲用户世界书。

### 2.6 最终 HTTP 契约：按资源与状态，不按按钮和存储类型

保留 Hono；删除 chanfana class 层，使用 Hono 的 schema 路由集成与共享 Zod schema 生成 OpenAPI 3.1。只选一种经过当前 Zod 主版本兼容验证的集成，不能手写第三套路由/文档清单。HTTP runtime 同样执行 schema 验证；生成类型不能替代验证。

以下均相对 `/api/v1`；“管理”是权限，不应把每个已有按钮都保留为一个 admin 动词路由。

| method/path | 契约/替代 |
| --- | --- |
| `GET /config` | 公共 taxonomy、支持格式、配额提示、当前 checker/bridge 版本；不含 secrets。 |
| `POST /auth/flows`；`GET /auth/flows/:id`；`POST /auth/flows/:id/redeem` | 创建、查询完成态、一次领取；后两者要 flow secret。OAuth callback 独立 `GET /auth/discord/callback`。 |
| `GET /me`；`DELETE /sessions/current` | 当前身份、即时角色；真实撤销 session。退稿信息不再塞 `/me`，从个人投稿查询。 |
| `GET /projects`；`GET /projects/:id` | 公共摘要/详情元数据；前者支持搜索、分类、标签 AND、排序、cursor。详情不自动带完整 source。 |
| `POST /project-lookups` | 有界批量 ids + installedReleaseId；返回摘要/当前 release 和更新状态，替代 batch + version-check 两套 enrich 路径。每项独立 unavailable，不泄露隐藏项目身份。 |
| `POST /repair-resolutions` | 保留有配额的精确 id/规范名候选匹配。它处理“身份未知”而非普通批量查询，不能为减少路由数强并进 lookup。 |
| `POST /projects`；`DELETE /projects/:id` | 创建空项目、软删除；create 接受操作幂等 key，防止网络丢包生成重复项目。 |
| `GET /me/projects`；`GET /me/submissions` | 明确分页的个人项目、投稿及退稿原因。 |
| `PUT /projects/:id/visibility` | 替换项目上架状态，If-Match；管理员撤下需审计理由。 |
| `POST /projects/:id/assets/:kind` | kind=worldbook/regex/cover；单次上传，返回不可变 assetId/hash/大小。entry remove 变为编辑 JSON 后创建修订，不保留服务器单条删 JSON 的特殊命令。 |
| `POST /projects/:id/revisions`；`GET /projects/:id/revisions/:revisionId` | 原子保存完整 metadata + asset 引用；cover 裁切、taxonomy、兼容选择同一修订，不再各占更新路由。私有读取受权限限制。 |
| `POST /projects/:id/submissions`；`GET /submissions`；`GET /submissions/:id` | 提交指定修订、审核者队列、不可变审核上下文与 manifest；当前稿和正式稿不会共用项目 id 伪装。队列只读 D1。 |
| `POST /submissions/:id/review`；`DELETE /submissions/:id` | 唯一批准/拒绝决策；撤回 pending。审核报告与内容绑定；相同操作重放返回原结果，不新增审核。 |
| `GET /projects/:id/releases/:releaseId/manifest` | 登录后返回安装 manifest：releaseId、序号、版本标签、hash、明确 kind/assetId、兼容/冲突信息。替代 install-info + 重型详情下载。 |
| `GET /projects/:id/releases/:releaseId/files/:kind` | 同一授权策略读取确切不可变文件；无任意 R2 key 代理。Range/HEAD 不计下载，HEAD 仅元数据；有权限的旧 release 可以用于修复，但项目撤下后非作者/审核者不可取。 |
| `GET /projects/:id/revisions/:revisionId/files/:kind` | 作者/审核者读取待审 source 或 cover；不与正式文件共享缓存。 |
| `GET /me/project-state?ids=...` | 批量本人点赞、订阅、评分/私人留言；限定 ids 数量，不拼进共享 DTO。 |
| `PUT /me/likes/:projectId`；`DELETE /me/likes/:projectId` | 显式设为有/无，删除 toggle；重复请求不再反转。 |
| `PUT /me/subscriptions/:projectId`；`DELETE /me/subscriptions/:projectId`；`GET /me/subscriptions` | 同上，支持分页订阅更新中心。 |
| `PUT /me/ratings/:projectId`；`DELETE /me/ratings/:projectId` | 私人评分/留言，保留禁止作者自评规则；不向作者/公众暴露私人信息。 |
| `GET /me/draw`；`POST /me/draw` | 今日抽签状态和一次抽签；操作 key 防止重试扣两次配额，保留当前每日额度与最近排除行为。 |
| `GET /recommendations`；`PUT/DELETE /recommendations/:projectId` | 公开精选与审核者本人推荐维护；保留署名/说明，不靠结果 GROUP BY 吞掉多条推荐语义。 |
| `GET /reference-sets`；`POST /reference-sets`；`POST /reference-sets/:id/versions`；`GET /reference-versions/:id/items` | 公开基线查询与管理员版本登记，版本不可变。 |
| `GET /site`；`PUT /site`；`POST /site/assets`；`GET /site/assets/:assetId` | banner/站点配置与图片；写入仅 owner/reviewer，图片服务不接受任意 R2 key。 |
| `GET /members`；`PUT /members/:id/role`；`GET /audit-events` | owner 角色管理；审核者/owner 审计查询与项目管理使用现有项目查询的授权 scope，不重复实现全套 CRUD。 |

不设“路由必须少于某个数字”的指标；这里增加修订/投稿资源是消除状态歧义，不是少写几个 endpoint。明确删除 recount、旧草稿 cleanup、公开 staging rebuild：新模型不需要它们维持正确性。排名重建与恢复是受审计运维任务，不作为公开 QA 暗门。

返回 JSON 使用 camelCase、独立 success DTO，不保留无意义 `success:true`；集合为 `{items,nextCursor}`，不返回含义不一致的 page/hasMore/total。写接口的 CAS 或幂等保护只用于确有重复副作用的操作，不增加通用自动重试平台。

### 2.7 缓存与计数：选择可解释的一份事实

| 数据 | 最终策略 |
| --- | --- |
| Vite hash 资产、版本化酒馆 bundle、checker worker | Static Assets，`public,max-age=31536000,immutable`；URL 带内容 hash。HTML、当前 release manifest 不长期缓存。 |
| 所有动态 API、会话、个人状态、草稿、审核 | `private,no-store`；无 Cache API、无自制 stale fallback。公开 DTO 也先不共享缓存，以保证下架和权限语义。 |
| 完整项目 JSON、R2 source/cover | 权限检查后 stream，首版 no-store。可用 hash 做完整性校验，但不能因 hash 命中绕过当前权限检查；不把未授权内容放公有桶。 |
| Web 数据与酒馆远端数据 | 请求期间 in-flight 合并；操作后重新取权威结果。已下载字节可按 sha256 在当前任务内复用，不持久保存“某项目最新版”的 TTL 副本。 |
| 本地安装登记 | 用户本地事实，不是服务端缓存；保留，并带 release/manifest 身份。diff 基于当前本地内容计算，不复用 5min 陈旧 diff。 |
| 排行、曝光、周期热度 | D1 派生读模型，cron 完成后发布 run；读不到新 run 使用上一 complete run 并返回 generatedAt，不在 GET 中偷偷补建。 |

下载口径首版保持“成功提供的项目 JSON 文件请求次数”，不伪装成独立安装人数；世界书和 Regex 各请求可能各计一次。只对完整 GET 计数，不对 preview、HEAD、Range 或 304 计数。日预算等现有限制先保留为集中策略。计数采用 D1 原子增量与日期配额，不为每次下载再引入 Durable Object；计数写失败记录错误但不把已可读文件伪装成不存在，允许统计漏计并明确其非财务性质。若产品要求“成功安装一次算一次”，这是另一个事件契约，需另行决策，不能悄悄改口径。

## 3. 迁移与一次性切换

共同原则：旧 Worker 持续服务直到新系统通过验收；迁移工具只能读旧 D1/R2、写新 D1/R2。新库、新桶及 CI 凭证都明确命名，不把 staging-sync 脚本默认目标当成生产迁移保障。不双写、不逐用户灰度、不让新旧客户端同时写同一个新库。

### 阶段 0：行为盘点与恢复材料

工作：从旧源码和可访问的环境导出路由/权限/字段/对象引用清单；取得 exact 线上 Worker version、配置、secret 名称和负责人，获取只读数据库导出与 R2 inventory。盘点源项目规模、最大文件、非法状态和线上账单/执行配额。记录公开 URL 和酒馆安装登记身份。

验收：

- 功能矩阵逐项覆盖：匿名目录/搜索/排序/详情，登录和成员准入，投稿/封面/审核/退稿，点赞/订阅/私人评分/留言，发现/抽签/精选/banner，基线/兼容/原版冲突，酒馆安装/更新/卸载/移动/diff/修复/依赖检查，离线 checker。
- 每项有新接口、验收场景、数据归宿，不允许靠“基本相同”漏功能。
- 旧 D1 导出和 R2 清单可读、有 hash；恢复步骤在隔离库/桶演练成功。凭证和用户数据不提交 Git。

回退：无线上改变，丢弃研究副本即可。

### 阶段 1：契约与可运行边界

工作：建 workspace、共享 schemas、单 Worker/Static Assets、本地 D1/R2、统一 error/auth；确定 CPU 付费环境；打通匿名目录和受权文件读取的最小真实 HTTP 路径。提交 OpenAPI 与 bridge 协议文档，由功能矩阵对照审阅。

验收：一个 frozen install 命令可 typecheck/build；真实 workerd 中 API 404 不被 SPA 吞掉；无浏览器字符串脚本、无第二路由 dispatcher；401/403/404/500 和合法/伪造/已撤销 session 均实际请求验证；不依赖外部生产环境启动。

回退：新 Worker 仅隔离环境；不影响旧服务。

### 阶段 2：修订/审核/发布纵向闭环

工作：新 schema、不可变 R2、编辑投稿、审核报告绑定和原子发布；把纯内容识别/checker 迁入 packages/content。完成全部目录、互动、管理、排行和抽签领域能力，不先堆空 endpoint。

验收：

- 作者上传两类 JSON/封面 → 保存修订 → 提交 → 审核者检查 → 批准 → 普通已登录用户拿 manifest 和真实文件；新修订待审期间旧 release 内容 hash 不变。
- 同时上传/提交/两名审核者批准、过期 base、撤回、隐藏/删除、审批中角色被撤销：结果满足数据约束与公开行为。
- R2 成功而 D1 失败，只产生可回收孤儿；D1 publish 失败，旧指针及文件保持不变；审核报告换文件/换版本不可批准。
- 后台排名完整发布、失败保持旧 run，抽签配额在并发下不超额；非生产 marker/本地身份入口不在生产构建里。

回退：重建新环境即可，旧存储完全不变。

### 阶段 3：消费者集成与本地数据安全

工作：Web 按新契约实现完整功能；酒馆脚本改用新 bridge 和 manifest。此阶段不在本方案指定 UI 细节，但它是切换的硬依赖，不能拿 API 完成代替产品完成。

验收：在真实 SillyTavern + Tavern Helper 环境运行完整安装/更新/修复旅程；桌面/移动浏览器与至少一种目标 WebView 完成登录；旧角色卡/本地世界书内容不会被 onboarding 清空。更新拒绝降级、拒绝未授权重复安装清理；Regex 失败不登记安装完成。

旧 API/旧 bridge 不提供兼容。保留公开项目 id，使既有 DLC 标识仍可定位；新客户端一次性读取旧安装元数据并与本地真实内容扫描对账，生成新登记，迁移完成后不保留在线兼容分支。不能自动确认身份的内容标为需用户确认，绝不猜同名条目并覆盖。客户端升级是明确重装/更新分发，不使用旧 test-dist 自改写 shim。

回退：仅新 staging 客户端受影响；用户本地预先导出的世界书/Regex 可恢复，旧生产继续在线。新本地登记迁移必须可中断且不破坏源登记；源备份在验收后按保留策略移除，不成为永久双写。

### 阶段 4：全量迁移彩排

工具要求：`tools/migrate` 有 extract/transform/load/verify 模式，参数必须包含 source/target resource id、snapshot id；source 和 target 相同直接失败。读取旧对象只用只读凭证，写权限限新资源。manifest、分页游标、结果 hash 写受控迁移目录，不进仓库。可重跑导入靠确定 id 与对象映射，不重建一套通用 ETL 平台。

数据映射：

1. users 保留 Discord id；旧 users/super_admins/env owner 合并为新角色，权限冲突列为阻塞项，不默认提升所有管理员为 owner。旧 JWT、KV OAuth state/result、会话不迁移，全部重新登录。
2. 对旧正式项目保留公开 id；使用 root/published/draft 指针及真实发布状态建立 project 聚合和 `old row id → project/revision/submission` 映射。不能只按 `root_project_id` 无条件合并不同作者数据。
3. 正式与待审文件按旧读取规则解析，包括草稿缺文件时回退正式文件，见 `admin.ts:39-50`。**迁移时物化为完整修订引用**，新运行时不再跨草稿猜文件。被拒、待编辑、待审内容及退稿原因均迁移；无法确定关联的行进入异常清单，必须解决，不直接丢弃。
4. 保留原始 version label 和可识别版本；新 release 序号是独立单调整数，内部身份不靠 semver 字符串回退。旧已安装版本通过 id/hash 映射新 release；不把所有非法版本静默写成 1.0.0。
5. R2 分页列举全部对象，按引用复制到新桶的不可变 key；保留 MIME/必要 metadata，计算并验证 SHA-256 和大小。R2 ETag 不一概当作内容 hash。封面 URL、旧代理 URL 解为资源引用；不可控外链封面单列处理，不能盲 fetch 任意 URL 形成 SSRF。
6. 迁移 likes/subscriptions/private ratings/comments、精选/说明、banner、基线及兼容/冲突引用、审计记录、当前有效抽签/曝光状态、日指标及 tracking 起点。历史 downloads_count 作为累计基数保存，不反推不存在的逐日数据。旧缺失的 accepted_code_check 保持“历史批准、无检查证据”，不伪造新 checker 认证。
7. 原始历史行/审计归档放受控迁移归档，运行新表只留需查询的结构。搜索、计数、排行派生结构在新库重建；不导入旧缓存 revision、锁 token、小时排行或旧 sessions。

验收：

- 每个源业务行均有目标映射或明确的非业务派生/废弃分类，异常为零后才通过；FK check 为零错误。
- 按作者/项目状态/分类的项目数、用户/互动/私人评分/投稿数对账一致；累计指标基数与日期指标分别一致，不能只核总项目数。
- 所有被引用文件全部校验 hash/大小，不以抽样代替；无 dangling asset/项目指针，未审核文件不能被匿名/普通用户取走。
- 全量重跑结果一致；模拟中途停止可恢复。使用生产规模复制数据运行真实 HTTP 场景，记录 D1 rows_read/rows_written、最大 JSON CPU/内存、R2 请求数和 cron 时长。
- 完整演练停写、末次导出、导入、验证和切换；据实测确定停机窗口，再对外公告。没有可信 updated_at/删除日志，不用“增量同步一下”假装最终一致。

回退：销毁/重建新目标环境，或恢复本轮新资源快照；旧资源不改。

### 阶段 5：单次正式 cutover

不用 DNS 必须存在的假设：当前正式入口是 workers.dev。先在独立 next Worker 验收；正式切换时在现有生产 Worker 名称部署经过验收的新构建并绑定新 D1/R2，保留原公开 origin。若将来使用自定义域，仍沿同样的单入口切换流程，不做新旧混流。

执行顺序：

1. 记录旧 Worker version、有效配置/绑定、部署 SHA 和恢复命令；准备已验证的维护版本、新版本及新系统上一良好制品。锁定发布窗口，停止其他部署。
2. **停写屏障：** 部署全维护入口，关闭旧 cron，阻止旧客户端所有 API。不能只拦 POST/PUT/DELETE：旧文件 GET 会计数，旧读路径可能生成排行，OAuth callback 也写库。旧运行实例/外部任务完成后，连续快照校验旧 D1 与 R2 inventory 稳定；确认没有遗留在途写入再取最终快照。
3. 执行彩排同一版本迁移工具，最终全量导入到新正式库/桶。数据量若要求预复制，只能预复制不可变校验过的字节；最终可变旧 key 与删除仍完整重检。执行阶段 4 全部校验。
4. 部署 exact 已验收制品到正式 Worker，绑定**新**资源；Static Assets、Web、checker、client 下载及 API 同一版本。维护屏障先保留，只放行受控验收账户；此时不开放公共写入。
5. 验证实际 Worker version/发布 SHA、目标 binding、资源 hash、旧桶无写入，以及正式 origin 上完整匿名/登录/作者/审核/安装旅程；专用验收项目的写入留有记录，回退时可明确丢弃该测试数据。
6. 验收通过后一次性开放新系统读写、启用新 cron、发布新酒馆脚本导入入口。旧客户端不再工作，公告要求升级；不留运行期兼容 shim。
7. 新系统稳定观察至少七天，保留旧 D1/R2 与旧版本只读，禁止任何“顺手整理旧桶”；到书面确认的保留期后才另行销毁。七天不是法律/备份保留期的替代。

**回退边界：**

- 第 6 步开放用户写入前：恢复旧 Worker/旧绑定/旧 cron，继续使用完全未被迁移修改的旧库桶；废弃新目标或重新迁移。用户没有跨系统新写入，允许干净回退。
- 第 6 步之后：**不能直接把流量切回旧库**，否则会丢失新投稿、审核和互动。普通代码故障回滚到同新 schema 兼容的上一新系统制品；数据保持新库。严重数据故障先全维护、快照新资源、恢复并核对新系统数据或向前修复。
- 若业务坚持开放写入后仍可回退旧数据模型，必须在上线前增加并实测反向迁移，明确冲突处理和停写窗口；本方案不把这项昂贵能力伪装成“点一下 rollback”。默认不建设它，不承诺对旧系统的无损回切。

## 4. 测试策略：保留反例，不保留实现形状

### 保留并迁移

- checker 的语法、policy、外链/媒体、预算、源码映射等真实输入输出语料：例如 `ejs-content-binding-v2.mjs:26-139`、`ejs-processing-budget-v2.mjs`、`external-link-policy-matrix.mjs`。内容规则变化需独立决策，不夹在改目录里。
- 安装身份、世界书 stage/reconcile、Regex 身份、原版冲突、修复和部分完成/降级保护反例。现有 harness 编译真实模块的可用部分改为正常 import + 宿主边界 fixture。
- `content-mutation-approval.mjs:61-105` 的竞争/失败场景，迁成新修订/指针模型的行为测试；不保留旧 token 锁实现断言。
- `admin-review-pending-queue-consistency.mjs:52-56` 后面的真实 SQL 行为、中文搜索与精确标签、当前排行/抽签额度与时间边界。旧小时排行测试随死模块一起删。
- Playwright 中匿名浏览、运行时异常检查、登录/WebView、投稿检查、安装更新修复旅程。`guest-journey.spec.mjs:3-27` 的 pageerror/5xx 监听有价值；不要保留旧 CSS selector 作为产品契约。

### 删除

- `assert.match(source, /某段SQL或函数名/)`、中文文案/颜色/CSS 字符串、转发参数/常量值、bundle 包含某标记等断言。例如 `home-js-smoke.mjs:157-163`、`creative-workshop-conflict-consent-smoke.mjs:13-29`。
- 从源文本正则切函数，再 `new Function()` 执行的测试机制；抽出的函数脱离依赖环境，且给重命名/格式化制造假失败。
- 只证明 wiring、复制、默认值和 bare not-throw 的测试；现有 mixed 文件拆出有用行为案例后删除旧文件，不把旧断言重新钉到新路径。
- 旧 API 对应的手工 JWT/固定 localhost 端口脚本，避免维护第二套认证实现。迁移后的测试用独立测试入口建立会话，不在生产 API 开后门。

### 新测试分层及门禁

1. **纯逻辑：** 正常 module import；测试不可信 JSON、Unicode/中文搜索、版本/身份、hash/manifest、checker 规则边界、游标 tie-break。固定时钟和随机种子，不依赖当前日期或公共项目数量。
2. **SQL/迁移：** 临时真实 SQLite 用于约束与变换测试；workerd 下 D1 再证明 batch、FTS、FK、条件 guard。空库建库 + 前一 schema 升级 + 旧样本 ETL；失败案例包括空文件、坏指针、缺失 R2、旧 NULL taxonomy、重复草稿、被删作者。
3. **Worker HTTP 集成：** Cloudflare 支持的本地 workerd/Vitest 集成，真实 Hono 路由、D1、R2；只 mock Discord 网络边界。测试矩阵覆盖匿名/成员/作者/审核者/owner/撤销角色；文件路径编码、跨项目 asset、隐藏/被删 release、错误体和 body 流超限。
4. **并发/故障：** 两次 approve 仅一次生效，CAS 失败不产生 review/audit/指针副作用；暂停 R2 put 时公开旧 release 不变；上传登记失败只有孤儿；抽签和计数不超配额；重复 like/subscription 请求幂等；被更换 checker 版本的报告不能批准。
5. **浏览器及宿主：** Playwright 使用本次构建启动的本地服务和种子数据，不默认访问公共 staging。登录凭证消费、popup 被拦、外部浏览器返回、reload、iframe token 不外泄；酒馆 fixture 做确定的错误恢复，真实 SillyTavern 做发布前完整 smoke。
6. **真实发布 smoke：** staging 使用隔离数据实际请求上传 → 审核 → 发布 → 下载 → 在 TH 安装/更新/卸载，观察 D1 指针、R2 hash 和宿主状态；不以 mock 测试全绿代替运行证据。

性能门槛在阶段 0/4 定值并记录测试数据规模：至少覆盖最大允许上传、目录第一页/深页/中文短搜索、批量更新检查、最大审核文件、一次完整 cron。门槛必须明确 CPU/内存/rows_read/延迟/费用而非“比以前快”；没有测量不宣称删缓存一定降低成本。CI 保证列表和队列不读 R2 是通过真实请求资源调用计数观测，不检索源码是否出现 `R2_BUCKET`。

## 5. 构建、发布、部署

### 构建与产物

- 一个受支持 Node LTS、固定 pnpm 版本、一个 lockfile；CI `pnpm install --frozen-lockfile`。根脚本统一 `typecheck/test/build/test:integration/test:e2e`，不再 70 多个无聚合关系的 check 入口。
- Vite 生成 Web 与 checker workers；esbuild 生成 TH 单文件脚本和离线 checker，保留用户需要的单文件导入能力；Wrangler 生成 Worker。不为“统一打包器”强迫 TH 使用多 chunk。
- release artifact 包含 Worker、Static Assets、酒馆脚本、离线检查工具/许可证、OpenAPI、migrations、checksums、构建元数据。源码、输入基线、第三方 notices 受控；生成 bundle/source map/types 不提交主分支。
- TH 分发从 Worker Static Assets 发布：版本化 URL + 当前通道 manifest。生产通道必须在 config 唯一来源派生；移除 jsDelivr 测试镜像作为事实来源。用户无旧路径兼容要求，所以不保留 test-dist alias。
- client 默认使用打开它的 Workshop origin，版本不混入环境 endpoint 常量；生产/预发选择由明确导入入口决定。确需环境值的运行配置与同一制品一起校验，不在 staging 验收后重编逻辑代码。
- checker revision 从源码/规则内容 hash 生成，Web、审核 API、离线工具都记录同一 revision。停止 Base64 内嵌及请求时解码；许可证不会随清理生成物消失。

### CI

PR（不接触生产 secrets）：frozen install → 格式/依赖边界 → 全包 strict typecheck → 纯逻辑/SQL → build → workerd HTTP 集成 → 本地 Playwright → 制品完整性校验。构建失败、OpenAPI/runtime schema 不一致、migration 缺失、意外生产 endpoint、测试环境拿到生产 binding 均阻断。

`main`：对 exact SHA 构建一次、上传不可变 CI artifact；部署 staging、执行真实 smoke，保存报告和 Worker version。短期任务分支不另开长期 staging branch。生产经 GitHub Environment 审批提升**同一制品**；secrets 使用最小权限环境凭证，禁止机器目录/profile/token 文件成为部署前提。

发布工作流按环境串行，禁止两个数据库迁移/部署交错；不允许 fork PR 直接取得写 Cloudflare 的 token。GitHub Actions 只是已有 CI，不引入新运行时供应商。

### 环境与上线后维护

- local：本地模拟 D1/R2、假的 Discord 网络边界。
- staging：独立远端 D1/R2/Worker/OAuth；使用可审查匿名样本或脱敏副本，不默认把私人评分/留言复制到公共测试环境。
- production：独立新 D1/R2，绑定及 secret 名称可审计；只通过 CI 发布。
- 后续 migration 先在 staging 执行并跑真实场景；发布前校验兼容区间。代码回滚不是 schema down migration，破坏性删列等留到无需回退的独立发布。
- 对外最小 `/api/v1/health` 仅报告服务/构建版本，不暴露 binding id、用户或 secrets；部署后另用受控探针检查 D1/R2。日志保留 requestId、route、结果和必要错误，不记录 bearer、OAuth code、redeem secret、原始上传文件或私人留言。
- 发布账本记录 SHA、artifact hash、Worker version、migrations、资源 id、验收链接及回退边界；“push 成功”绝不作为部署成功证据。

## 6. 风险、决策与未决问题

这些问题无法仅从仓库确定。它们是对应阶段的门禁，不是让实现者自由发明功能的清单。

| 风险/问题 | 默认决定 | 何时必须有答案 |
| --- | --- | --- |
| 实际 Cloudflare 配额、CPU/内存与费用 | 新 Worker 使用可承担解析的大 CPU 预算；不继续 regex DO 分流。最大文件仍受边界限制。 | 阶段 1 前确认账单权限；阶段 4 测量预算，否则不得切换。 |
| 谁控制现生产 Worker、Discord OAuth app、secret 与旧备份 | 仓库不能证明；机器 helper 未激活不代表没有其他线上流程。 | 阶段 0 取得资源与恢复权限、线上 version。 |
| 生产真实数据量、缺失对象/孤儿项目、停机窗口 | 最终全量快照最可靠，不承诺无停机。 | 阶段 4 彩排测量和对账完成后公告。 |
| `visibility` 是隐藏还是 unlisted | 默认非作者/审核者不可读，登录门禁覆盖原始 source。 | 契约冻结前确认；不能沿用现有模糊语义。 |
| 匿名详情是否必须展示完整可安装源文件 | 默认只给摘要/条目索引，完整 source 要登录。否则“登录才下载”不构成访问限制。 | 契约冻结前产品明确二选一，API/test 同步。 |
| 审核者是否可信，是否允许人工接受 checker 阻断 | 保留当前可信人审模型及有理由 override，不把签名说成远程执行证明。 | 阶段 0 确认审核规则；修改信任模型单列决策。 |
| 社区成员资格、owner/reviewer 映射、退群撤权时效 | 登录检查成员资格，角色即时查库，退群在会话到期重查；权限迁移不静默提权。 | Auth 合入前确认需要的时效和 Discord 调用预算。 |
| 下载口径、评分是否真的只对本人、精选多作者说明如何展示 | 保留文件 GET 统计和私人评分；多条推荐保留原记录，不随 GROUP BY 丢信息。 | 契约冻结时记录现状与最终公开行为。 |
| 旧安装登记和用户改过的本地世界书 | 保留稳定 public id、hash 对账、一次性导入；身份不确定不覆盖，不支持旧 API。 | 阶段 3 真实 TH 样本验收，不以干净新账号代替。 |
| 删缓存导致 D1 成本上升 | 先只保留排行物化；按 rows_read/成本验收，必要时针对单个昂贵读模型优化。 | 阶段 4；不得到生产后再发现预算不可承受。 |
| 当前排行榜和中文短搜索复杂但有真实行为 | 保留语义并检验；删除已无生产调用的旧小时榜，不重写全部为随机/LIKE。 | 阶段 2/4 对照真实样本。 |
| 开放新写入后的回旧系统 | 默认不支持无损直接回旧库；代码回滚留在新 schema，严重故障维护/恢复/前向修复。 | 正式切换审批必须接受此边界；否则先建设反向迁移。 |
| 备份与私人数据保留/删除义务 | 源备份只读、加访问控制；切换观察期不等于无限保留授权。 | 阶段 0 指定责任人和期限，销毁另行审批。 |

## 7. 我不会改什么

1. **Cloudflare 平台与单 Worker 产品形态。** D1/R2 足够表达当前工作流；不用“现代化”引入微服务、队列平台或外部数据库。
2. **Hono、Zod、参数化 SQL。** 问题不在路由库或 SQL 本身，而在状态模型、隐藏依赖和重复契约；不为选框架做无关重写。
3. **人工审核与不可猜测的内容绑定。** 缩减重复签名/传输不等于信任创作者 checker；可信审核者对确切修订负责。
4. **现有项目分类、中文搜索边界、兼容基线和内容规则。** 先保行为，删除历史镜像；不趁重构重新定义创作政策。
5. **Tavern Helper 与 iframe 桥接。** 宿主数据必须由宿主操作。保留安装前确认、串行写入、部分完成恢复、最终扫描和原版冲突保护。
6. **产品能力的大致范围与用户数据。** 不以压缩 LOC 删除抽签、私人留言或修复，也不以新库为理由抛弃待审/被拒稿件。
7. **exact SHA、staging 验收、线上版本核验。** 这些约束正确；要替换的是不具可移植性的实现，不是发布纪律。

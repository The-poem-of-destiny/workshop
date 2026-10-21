# 功能审计 A：features.md 第 1–6、13 节与 Checker 规则内容

- 审计日期：2026-10-21
- 审计对象：分支 `refactor/2026-10`，HEAD `e103ee4`
- 审计方式：只读静态审计。未运行测试、未启动 Worker、未修改源码（仅新增本报告）。
- 结论摘要：第 1–6、13 节中，真正闭环的只有账号角色/会话撤销（A3/A4）、项目创建与两态可见性（D1/D8）、以及按决策**删除**的项（E6/F7/F8/F12）。**Checker 的规则内容、两阶段证明链、DO 权威复核、自动发布与审核路由整体不存在**；酒馆客户端只有未迁移的旧实现，且仍指向已被删除的旧 API。

## 0. 引用缩写与判定口径

| 缩写 | 文件 |
| --- | --- |
| F | `docs/plans/refactor-2026-10/features.md` |
| D | `docs/plans/refactor-2026-10/decisions.md` |
| M | `docs/plans/refactor-2026-10/main.md` |
| S | `docs/plans/refactor-2026-10/state.md` |
| P6 | `docs/plans/refactor-2026-10/p6-cleanup.md` |

状态口径：`done` = 需求行为在代码中端到端可用；`partial` = 有数据模型/部分端点/旧实现残留，但需求行为不完整或不可用；`missing` = 无实现。  
严重度：**高** = 阻断该节验收或移除了安全门；**中** = 行为不完整、有手工绕行；**低** = 体验/待定产品项。

## 1. 状态总表

### 1.1 第 1 节 账号与准入（F:15-24）

| ID | 需求来源 | 状态 | 当前证据（file:line） | 缺口 |
| --- | --- | --- | --- | --- |
| A1 Discord OAuth + 一次性 redeem + Origin 白名单 | F:19；D:52-70 | partial | `apps/worker/src/http/routes/auth.ts:40-98`（只有 flow 创建/状态）；`apps/worker/src/storage/identity.ts:54-60`；`apps/worker/migrations/0001_initial.sql:29-40` | 高 |
| A2 公会准入 | F:20；D:52-70 | missing | `apps/worker/src/env.ts:1-7`（无 `ALLOWED_GUILD_IDS`）；`apps/worker/src/http/routes/auth.ts:40-51`（无 guild 校验） | 高 |
| A3 角色存库、每请求校验 | F:21 | done | `apps/worker/migrations/0001_initial.sql:7-13`；`apps/worker/src/storage/sessions.ts:19-31`；`apps/worker/src/http/routes/admin.ts:117-129` | — |
| A4 登出/会话撤销 | F:22 | done | `apps/worker/src/http/routes/auth.ts:30-38`；`apps/worker/src/storage/identity.ts:76-81`；`apps/worker/src/storage/sessions.ts:28-31` | — |
| A5 本地预览管理员 | F:23 | missing | `apps/worker/src/env.ts:1-7`（无 `LOCAL_PREVIEW_ADMIN`） | 中（仅测试构建） |
| A6 CORS / CSP 允许列表 | F:24；D:54,61 | partial | `apps/worker/src/app.ts:19-26`（仅 nosniff/referrer/no-store）；`apps/worker/src/http/routes/auth.ts:47-51`（仅 flow 校验 Origin） | 高 |

A1 的具体缺口：
- 没有 `POST /api/v1/auth/flows/:id/redeem`，也没有 `GET /api/v1/auth/callback`；`CALLBACK_PATH` 只在 `auth.ts:12` 被引用去拼 Discord 授权 URL（`auth.ts:70-89`），Worker 无对应路由（`apps/worker/src/app.ts:28-37`）。
- 无 client secret/code 交换、无首次创建 session 的代码路径；`oauth_flows.status` 永远不会被写成 `authorized/redeemed`（`apps/worker/src/storage/identity.ts:65-73`）。
- D-10 明确“**不存储请求里的 Origin**”，但 `insertAuthFlow` 把请求 Origin 写入 `oauth_flows.origin`（`apps/worker/src/storage/identity.ts:58-61`）。
- 服务端生成的 PKCE `verifier` 只以 SHA-256 形式落库（`apps/worker/src/storage/identity.ts:55-59`），且从未返回给客户端；当客户端未提供 `codeChallenge` 时，即使补一个 redeem 端点也无法完成校验（`apps/worker/src/http/routes/auth.ts:58,63,76`）。S:88 把这描述为“PKCE challenge 可选”，低估了缺口。
- 未配置 `DISCORD_CLIENT_ID` 时，flow URL 指向 `/auth/pending?flow=...`（`auth.ts:71`），该页面/路由不存在，属于死链。

A6 的具体缺口：全站没有 `Access-Control-Allow-*`、没有 `OPTIONS` 预检处理、没有 CSP；`app.use("*")` 只在响应后补三个安全头（`app.ts:19-26`）。D-10 要求“CORS 只回显白名单 origin”，D-22 要求 `/client/*` 公共脚本 `Access-Control-Allow-Origin: *`——两者都没有实现。

### 1.2 第 2 节 浏览与发现（F:26-41）

| ID | 需求来源 | 状态 | 当前证据（file:line） | 缺口 |
| --- | --- | --- | --- | --- |
| B1 首页货架 + 排序 tab | F:30；D:296-297 | partial | `apps/worker/src/storage/projects.ts:146-151`；`apps/worker/src/storage/home.ts:70-80`；`apps/worker/web/src/App.tsx:108` | 中 |
| B2 发现随机轮换（按小时桶 + 曝光历史） | F:31；D:214 | missing | `apps/worker/migrations/0001_initial.sql:239-246`（`discovery_exposures` 无读写）；`apps/worker/src/storage/home.ts:70-80` | 高 |
| B3 FTS5 搜索（含 1–2 字与标签） | F:32；D:76（D-14） | partial | `apps/worker/migrations/0001_initial.sql:334-345,361-433`；`apps/worker/src/storage/projects.ts:123-143` | 中 |
| B4 筛选：类型/标签，删除最低赞/下载 | F:33；D:297 | partial | `packages/contracts/src/projects.ts:50-56`；`apps/worker/src/storage/projects.ts:158-166` | 中 |
| B5 分页 24/页、顺序翻页 | F:34；D:305 | partial | `packages/contracts/src/projects.ts:51`（默认 20、上限 50）；`apps/worker/web/src/api.ts:43`（UI 传 24）；`apps/worker/src/storage/projects.ts:109-121,153-181`（offset cursor） | 低 |
| B6 首页 Banner（图片 + 位置缩放） | F:35；D:298 | partial | `apps/worker/src/storage/home.ts:15-27`（只读）；`apps/worker/src/http/routes/site.ts:7`；`apps/worker/web/src/App.tsx:85-89`（只用 imageUrl） | 中 |
| B7 编辑精选（多作者 + 说明） | F:36；D:299 | partial | `apps/worker/src/storage/home.ts:37-66`、`apps/worker/src/http/routes/recommendations.ts:6-8`（只读；无后台写） | 中 |
| B8 公共计数 / 7d/30d 周期热度 | F:37；D:220,76 | partial | `apps/worker/migrations/0001_initial.sql:160-178,202-247`；`apps/worker/src/storage/projects.ts:146-151`（排序只有 4 种） | 中 |
| B9 项目详情（匿名摘要 + 私有评分） | F:38；D:267 | partial | `apps/worker/src/storage/projects.ts:184-189`；`packages/contracts/src/projects.ts:43-46`；`apps/worker/src/http/routes/me.ts:30-35` | 中 |
| B10 角色基线引用（官卡版本 + 指纹） | F:39 | partial | `apps/worker/src/storage/references.ts:15-50`；`apps/worker/migrations/0001_initial.sql:267-307`；`apps/worker/migrations/0001_initial.sql:44-92`（项目无基线字段） | 高 |
| B11 每日抽签（入口收起、接口暂留） | F:40 | missing | `apps/worker/src/app.ts:28-37`（无 draw 路由）；schema 无配额表 | 低（Q-10 未定） |
| B12 社区入口 / 待更新高亮 | F:41 | partial | `apps/worker/src/storage/projects.ts:101-107`（只有 Discord URL）；无社区入口聚合 | 低 |

B1：排序参数在 API 层存在（`projects.ts:146-151`），但 Web 默认页展示的是 `/api/v1/home` 的 `latest`，`home.ts:74` 固定 `limit: 6`；`App.tsx:108` 在搜索为空时完全忽略 `projects` 与 `sort`，因此 4 个排序 tab 只在搜索时生效。  
B2：D-27 要求“同一小时内匿名请求看到同一集合，客户端洗牌”，代码中没有桶计算、没有 `discovery_exposures` 读写、没有 `discover` cache tag。  
B3：schema 同时建了 trigram `project_search` 与 1–2 字 `project_search_short`（`0001_initial.sql:334-345`）以及维护触发器（`:361-433`），但 `searchPredicate` 对 ≤2 字直接走 `LIKE`（`projects.ts:125-138`），`project_search_short` 从未被查询。  
B4：只有 `projectType` 过滤（`projects.ts:158-161`）；D-32 要求的标签过滤没有参数，也没有 SQL。最低赞/下载筛选已按决策删除，这一点正确。  
B8：计数与日增量触发器存在（`:160-178,212-218`），但 `ranking_runs`/`ranking_entries` 无任何写入或读取，7d/30d 热度不可用。  
B9：详情只返回摘要字段与 `authorNote`/`discordThreadUrl`；没有条目预览（旧详情有 `worldbookEntriesPreview`/`regexEntriesPreview`），也没有把登录者自己的私有评分并入详情。  
B10：只有 reference-set 列表，没有 version items 端点，也没有项目侧 `built/tested/incompatible`/基线指纹字段；旧的 `character-reference-fingerprint` 能力未迁移。

### 1.3 第 3 节 酒馆客户端（F:43-66）

结论：`apps/tavern-client` 不存在（`apps/` 下只有 `worker`）。旧实现仍保留在 `src/CreativeWorkshop/`（约 6041 行）与 `webpack.config.cjs`，但**仍调用旧 API**，与当前 Worker 不兼容。因此第 3 节没有任何一项达到新架构下的 `done`。

| ID | 需求来源 | 状态 | 当前证据（file:line） | 缺口 |
| --- | --- | --- | --- | --- |
| C1–C14、C16、C19、C20（桥接、免责声明、安装/更新/卸载、diff、冲突、登记表、扫描、DLC 修复、更新中心、转移、正则身份） | F:47-60、62-63、65-66；D:104-124 | partial | `src/CreativeWorkshop/index.ts:1-3`；`src/CreativeWorkshop/services/project-fetch.ts:271,311`；`src/CreativeWorkshop/services/diff.ts:191`；`services/original-conflicts.ts:218-238`；`services/install-registry.ts:57-291` | 高 |
| C15 其他脚本依赖健康（应移除） | F:61；D:38-40（D-08） | partial | `src/CreativeWorkshop/services/script-dependency.ts:1`；`src/CreativeWorkshop/bridge/host.ts:8`；`config/workshop.json:30-42` | 中 |
| C17 版本握手 / 最低客户端 | F:63；D:30-36（D-06） | missing | `config/workshop.json:2-16`（版本只存在于配置文件）；`apps/worker/src/app.ts:28-37`（无 `/client/*`） | 高 |
| C18 旧路径 shim | F:64；D:307-312（D-33） | partial | `test-dist/CreativeWorkshop/index.js`（已提交）；`scripts/build-workshop-legacy-shim.mjs:1`；`config/workshop.json:11-17` | 低（过渡项） |

C 类具体断点：
- 客户端详情请求 `GET {origin}/api/projects/:id`（`src/CreativeWorkshop/services/project-fetch.ts:311`），下载校验只接受 `/api/files/...`（同文件 `:257-271`）。
- 新 Worker 只注册 `/api/v1/*`（`app.ts:28-37`），未匹配的 `/api/*` 一律 JSON 404（`app.ts:79`）；`/api/files/*` 与 `/api/projects/*` 全部 404。
- `wrangler.jsonc:15` 把 `/client/*` 设为 `run_worker_first`，但 `app.ts` 没有任何 `/client/*` 处理器，最终落到文本 404（`app.ts:85`）。
- C17 需要的“服务端知道当前 client 版本并精确匹配”在代码中不存在；`config/workshop.json` 没有被 Worker 读取。
- C15 按 D-08 应删除，但客户端源码、构建入口与配置仍在。

### 1.4 第 4 节 创作（F:68-86）

| ID | 需求来源 | 状态 | 当前证据（file:line） | 缺口 |
| --- | --- | --- | --- | --- |
| D1 创建项目 | F:72 | done | `apps/worker/src/http/routes/authoring.ts:50-60`；`apps/worker/src/storage/authoring.ts:152-185` | — |
| D2 元数据编辑（名称/简介/版本/标签） | F:73；D:269-279（D-30） | partial | `authoring.ts:76-90`；`storage/authoring.ts:200-240`；`0001_initial.sql:70-92`（无版本标签列） | 中 |
| D3 世界书上传（识别 + 策略） | F:74 | partial | `authoring.ts:124-152`（仅大小/MIME）；`packages/domain/src/project-content.ts:169`（未被调用） | 高 |
| D4 正则上传（识别 + 策略） | F:75 | partial | 同上；`packages/domain/src/content-policy.ts:45`（未被调用） | 高 |
| D5 封面上传 + 展示设置 | F:76 | partial | `authoring.ts:124-152`（只有上传）；`0001_initial.sql:95-108`（无位置/缩放） | 中 |
| D6 上传前检查（单次上传 + 记录客户端 gate） | F:77；D:314-320（D-34） | partial | `packages/contracts/src/authoring.ts:32-35`；`storage/authoring.ts:373-379`；`0001_initial.sql:110-120` | 高 |
| D7 单条目删除（生成新修订） | F:78 | missing | `packages/domain/src/project-content.ts:224`（`removeProjectEntryFromJson` 零调用）；`authoring.ts` 无路由 | 中 |
| D8 可见性两态 | F:79；D:14-16（D-02） | done | `0001_initial.sql:54`；`authoring.ts:92-106`；`storage/authoring.ts:258-269` | — |
| D9 删除项目（软删 + 清理） | F:80 | missing | `projects.deleted_at` 仅用于过滤（`storage/authoring.ts:117,129,142`）；无 DELETE 路由/清理任务 | 中 |
| D10 拒绝原因 / 重新提交 | F:81；D:309；D:261 | partial | `storage/admin.ts:291-296`（reason 可空）；无作者侧拒绝原因 DTO；`storage/authoring.ts:373`（重提 supersede） | 中 |
| D11 兼容性元数据 | F:82 | missing | `0001_initial.sql:44-92` 无 built/tested/incompatible 字段；无路由 | 中 |
| D12 安装注意事项 | F:83 | missing | `0001_initial.sql:44-92` 无 precautions 字段；无路由 | 中 |
| D13 原版冲突选择 | F:84 | missing | 无冲突表/字段/指纹；`0001_initial.sql:267-307` 只有 reference items | 中 |
| D14 发布前检查（策略 + 引用） | F:85 | missing | `storage/authoring.ts:358-388` 提交只做冻结 + manifest hash；`packages/domain/src/content-policy.ts:45` 零调用 | 高 |
| D15 我的项目 / 我的订阅 | F:86；D:303 | missing | `apps/worker/src/app.ts:28-37` 无 `/me/projects`、`/me/subscriptions`；`me.ts` 只有 state/点赞/订阅/评分 | 中 |

D2 的“版本”在数据模型里根本没有：`projects` 与 `project_revisions` 都没有 `version`/`version_label` 列（`0001_initial.sql:44-92`），API 也没有该字段。D3/D4 的服务端结构校验完全缺失：`validateProjectContentText` 无任何调用；`validateProjectContentPolicy` 只有单测调用（`packages/domain/test/content-policy.test.ts:2-25`），`apps/` 内没有任何 import；上传只解码 JSON 数条目（`storage/authoring.ts:322-334`），非法 JSON 会被当作 0 条接受。  
D6：`submitProjectSchema` 强制要求 `gate`（`contracts/authoring.ts:32-35`），因此“缺少客户端标记”的请求直接 400，而不是第十三节要求的“进人工队列”；也没有 `client_warning_count` / `client_acknowledged` / `client_checked_at` 字段（`0001_initial.sql:110-120`）。  
D14：提交不要求存在世界书/正则，不校验项目类型策略；一个空 revision 也能提交并最终被“批准”（见 4.3 缺陷 4）。

### 1.5 第 5 节 Checker（F:88-101）

| ID | 需求来源 | 状态 | 当前证据（file:line） | 缺口 |
| --- | --- | --- | --- | --- |
| E1 上传检查器 | F:92；D:281-292 | missing | `apps/worker/src/app.ts:28-37` 无 checker 资源路由；无 checker 源码/包 | 高 |
| E2 审核检查器 | F:93；D:281-292 | missing | 同上；`wrangler.jsonc` 无 DO binding | 高 |
| E3 EJS 语法/语义 | F:94 | missing | `git grep -i checker apps packages` 只命中 submissions 列；旧引擎源码已随 `2aa31fb` 删除 | 高 |
| E4 规则策略（外链/媒体/限额） | F:95 | missing | 无规则实现；`packages/domain` 无相关模块 | 高 |
| E5 处理预算 | F:96 | missing | 无 parser/预算代码 | 高 |
| E6 证明（attestation） | F:97；D:314-320（D-34） | done（按决策删除） | 全仓无 attestation/HMAC 代码；`apps/worker/src/http/routes/authoring.ts:124-152` 单次上传 | — |
| E7 版本握手 `?v=` | F:98 | missing | 无 `/assets/upload-checker.js`、`/assets/review-checker.js` 路由 | 中 |
| E8 离线检查器 | F:99 | partial | `util/ejs-checker-v2.js`（629,917 B，规则齐全但不可重建）；`util/ejs-preflight.html:68-73`（引用该 bundle）；新 Worker/Web 均不提供该页面 | 中 |
| E9 服务端复核（DO 权威） | F:100；D:281-292 | missing | `apps/worker/src/index.ts:5-8` 仅导出 `fetch`；`wrangler.jsonc` 无 `durable_objects`/`crons` | 高 |
| E10 检查报告 / 差异 | F:101 | missing | `storage/admin.ts:158-247` 只返回元数据；`contracts/admin.ts:20-25` 的 `report` 是任意 JSON | 高 |

E8 的准确状态：`util/ejs-checker-v2.js` 是旧 `cloudflare/scripts/build-ejs-offline.mjs` 生成的 IIFE，内嵌 `PW-CODE-POLICY-2026-10-10.1` 与完整规则字符串；但生成脚本与源码已删除，仓库无法重建它，且没有任何新路由/页面引用它（只有旧的 `util/ejs-preflight.html:68` 引用）。因此它是“保留的静态死产物”，不是可用功能。

### 1.6 第 6 节 审核与管理（F:103-119）

| ID | 需求来源 | 状态 | 当前证据（file:line） | 缺口 |
| --- | --- | --- | --- | --- |
| F1 审核队列（分页/筛选/排序） | F:107 | partial | `apps/worker/src/http/routes/admin.ts:38-49`；`storage/admin.ts:124-156` | 中 |
| F2 审核详情 + 差异（三类文件） | F:108 | partial | `admin.ts:51-78`；`storage/admin.ts:158-247`；`admin.ts:64`（只允许 worldbook/regex） | 高 |
| F3 批准/拒绝（基于 submission） | F:109；F:228,289 | partial | `admin.ts:80-91`；`storage/admin.ts:259-338` | 高 |
| F4 审计日志（合并 + 历次报告） | F:110；D:309 | partial | `storage/admin.ts:299-311,418-421`（只写）；无读取端点 | 中 |
| F5 管理员列表 / 设置 | F:111 | partial | `admin.ts:105-129`；无设置端点 | 中 |
| F6 项目管理 | F:112 | partial | `admin.ts:93-104`；`storage/admin.ts:340-368`（只读列表） | 中 |
| F7 公共计数重算（删除） | F:113 | done（按决策删除） | 无对应路由 | — |
| F8 待审核清理（删除） | F:114 | done（按决策删除） | 无对应路由 | — |
| F9 Banner 上传/设置 | F:115 | missing | `apps/worker/src/http/routes/site.ts:7` 只有 GET；无上传/更新路由 | 高 |
| F10 编辑精选设置 | F:116 | missing | `routes/recommendations.ts:6-8` 只有 GET | 中 |
| F11 角色引用版本登记 | F:117 | missing | `routes/references.ts:8-16` 只有 GET；无导入路由 | 高 |
| F12 staging 榜单重建钩子（删除） | F:118 | done（按决策删除） | 无对应路由 | — |
| F13 站点设置（Banner + KV 风格键值，归档进 D1） | F:119 | partial | `0001_initial.sql:260-265`（`site_settings`）；`storage/home.ts:15-27`（只读 `discover_banner`） | 中 |

F1：`status` 过滤存在，但 `sort`/`projectType` 无参数；分页是 offset（`btoa(offset)`，`storage/admin.ts:114-124`），Q-06 未定，因此按现状只能算 partial。  
F2：详情没有文件内容（测试也断言“不含 content”，`apps/worker/test/admin-review.test.ts:79-86`）、没有 worldbook/regex 条目 diff、没有封面读取；审核员只能拿到 asset 元数据。  
F3：审批确实在单 batch 内切 published 指针并 409 冲突（`storage/admin.ts:299-338`），但完全信任请求里的 `checkerVersion`/`report`（`contracts/admin.ts:20-25`、`storage/admin.ts:278-279`），不绑定 DO 报告或内容 hash；这与 F:228,289；D:42-50 冲突。  
F4：`audit_events` 有写无读；`M:170` 约定的 `GET /admin/audit-events` 不存在。`reviews.submission_id UNIQUE`（`0001_initial.sql:130`）使同一 submission 不能保留多份报告；跨 submission 的历史虽存在，但没有“上一轮报告与内容快照对比”的实现（D-33）。  
F9/F10/F11/F13：旧系统的 `AdminDiscoverBannerUpload`、`AdminDevTeamRecommendationSet/Delete`、`AdminCharacterReferenceCreate/VersionCreate`、site settings 写接口都未迁移；当前只有读。

### 1.7 第 13 节 审核流程（F:220-310）

| 层/行为 | 需求来源 | 状态 | 当前证据（file:line） | 缺口 |
| --- | --- | --- | --- | --- |
| 客户端检查记录（5 个字段） | F:235-241 | partial | `contracts/authoring.ts:32-35`（仅 gate/可选 revision）；`0001_initial.sql:116-117` | 高 |
| DO 自动检查（权威） | F:224-230；D:42-50 | missing | 无 DO、无 checker；`wrangler.jsonc` 无 `durable_objects` | 高 |
| 路由表（pass/warn/block/缺失/超时） | F:243-259 | missing | `storage/authoring.ts:373-379` 一律写 `pending`；`contracts/authoring.ts:33` 强制 gate | 高 |
| 状态机（submitted/checking/auto_published/needs_human） | F:261-270 | partial | `0001_initial.sql:113-117` 只有 pending/checking/approved/rejected/superseded；`checking` 无写入路径 | 高 |
| Cron 调度 + 租约 | F:272-278 | missing | `apps/worker/src/index.ts:5-8` 只有 fetch；`wrangler.jsonc` 无 `triggers.crons` | 高 |
| 自动发布（pass/warn） | F:280-285 | missing | 只有人工审批切指针（`storage/admin.ts:313-330`） | 高 |
| warn 前台标记 | F:256；D:217 | missing | `packages/contracts/src/projects.ts:13-46` 无 warning 字段；Web 无展示 | 高 |
| 人工一票 + 绑定 submission/hash/revision | F:287-291；D:281-292 | partial | `storage/admin.ts:259-338` 有一票；但只绑定 revision 的 `manifest_hash` 与请求自带 `checkerVersion`，无 DO 报告、无本地同 revision 重跑 | 高 |
| 自动结果 + 人工结果都写审计 | F:291 | missing | 只有 `review.approve/reject`（`storage/admin.ts:299-311`）；无自动结果 | 高 |

“没有自动拒绝”这一条在现状下是“没有自动检查”，不是实现了该策略。  
`gate` 语义完全由调用方决定：提交接口要求 `pass|warn|block|missing` 之一（`contracts/authoring.ts:33`），但服务端不做任何语义校验，直接写入 `submissions.gate`（`storage/authoring.ts:377-378`）。因此恶意客户端可以把任何内容标成 `pass`，也不会触发任何复核。

## 2. Checker 专章：旧规则内容、证明链与当前缺口

### 2.1 旧检查器的组成与版本

旧实现在 `2aa31fb^:cloudflare/src/utils/ejs-checker/`：

| 文件 | 作用 |
| --- | --- |
| `index.mjs:10-56` | `analyze()` 主流程、`CHECKER_VERSION`、报告组装 |
| `syntax.mjs` | Acorn 解析 EJS/JS/HTML 内嵌脚本，含预算 |
| `source-units.mjs` | EJS tokenizer、模板区间、HTML 属性/脚本单元、source map |
| `policy.mjs` | L1–L7 组合兼容规则 |
| `capabilities.mjs` | M1–M5、U5、AH1–AH4 |
| `links.mjs` | 外链收集与 U2–U5 分类 |
| `api-catalogue.mjs` | ST-Prompt-Template API 目录与 API1/API2 |
| `syntax-findings.mjs` | EJS-PARSE/JS-PARSE/CHECKER-INTERNAL/CHECKER-LIMIT |
| `report.mjs` | gate/audit/certification、可见性、上传版投影 |
| `audit.mjs` | policy version、审计快照、fingerprint、基线合并 |
| `attestation.mjs` | 上传收据与审核 challenge 的 HMAC 校验 |
| `limits.mjs` | 处理预算常量 |
| `review-worker.mjs` / `upload-worker.mjs` | 两个浏览器 Worker 入口 |
| `vendor/ejs-tokenizer.mjs` | EJS 3.1.9 兼容 tokenizer |

固定版本信息（`index.mjs:10-14`、`policy-config.mjs:1`）：
- `engine: v2`，`policyVersion: PW-CODE-POLICY-2026-10-10.1`，`standard: PW-CODE-CHECK-v1`
- `parserCompatibility: EJS 3.1.9 / ST nested tags; Acorn 8.18.0; HTML parse5 8.0.1`

生成物与 revision（`cloudflare/scripts/build-*-checker.mjs`）：

| 产物 | revision |
| --- | --- |
| `review-checker.txt`（base64 bundle） | `e4d8a0770167845471d0` |
| `upload-checker.txt`（base64 bundle） | `4fd02aec81b63cfac825` |
| `util/ejs-checker-v2.js`（离线 bundle） | `76420995fd3609fa27b8`（无 revision 文件记录） |

revision 算法是 `sha256(bundle).slice(0,20)`；`/assets/review-checker.js?v=<revision>` 命中时返回 `immutable`，否则 `no-store`（旧 `index.ts:197-204`）。两个 bundle 由同一份源码构建，规则集完全相同；差异只在入口（上传版额外做外链展示分析，`upload-worker.mjs:1-30`）。

### 2.2 旧规则清单（逐条）

严重度与 gate 的关系是旧实现的真实行为：`gateStatus` 只在“severity=high 且 ruleId 匹配 `L1–L7`”时返回 `reject`（`report.mjs:83`）。M1/M2/M5 虽为 high，但不会把 gate 变成 reject；它们通过 certification/audit 进入人工视野。

#### 2.2.1 EJS 组合兼容（L1–L7）

| 规则 | 严重度 | 检出内容 | 证据 |
| --- | --- | --- | --- |
| L1 | high（局部场景 info） | 顶层 `var`（EJS 函数作用域，可能跨项目共享/覆盖）；函数内或 `@@private` 条目降为 info 提示；同一条目重复声明同名 `var` 也报 high | `policy.mjs:61-75,118-121` |
| L2 | high | 非 private 条目的顶层 `let`/`const` 未放入 `{ ... }` 局部块 | `policy.mjs:77-83` |
| L3 | high | 顶层 `function` 或 `class` 声明（同名会静默覆盖/词法冲突） | `policy.mjs:48-56` |
| L4 | warn（globalThis 且已写 Owner/Lifecycle/Cleanup 说明）；high（裸赋值） | 写 `window/globalThis/self` 成员，或无绑定的裸赋值 | `policy.mjs:91-108` |
| L5 | high | 共享全局名过于通用（`data/value/result/state/temp/tmp/config/ctx/context/output/response/item/utils`），以及同类裸名 | `policy.mjs:5,91-93,104-106` |
| L6 | high | 两个及以上条目公开同名符号（仅 `__PW_<id>__` 且类型为 global 时豁免） | `policy.mjs:125-148` |
| L7 | high | decorator 未位于 entry 首行连续区；位置错误的 `@@private` 不产生 private 豁免 | `report.mjs:66-79` |

#### 2.2.2 能力/风险（M1–M5）

| 规则 | 严重度 | 检出内容 | 证据 |
| --- | --- | --- | --- |
| M1 | high | `eval` 调用/转存/对象解构（含 `globalThis.eval`） | `capabilities.mjs:117-125` |
| M2 | high | `Function` 构造器调用/转存/解构 | `capabilities.mjs:117-127` |
| M3 | warn | `document.cookie`、`localStorage`/`sessionStorage` 的敏感键、`length`/`key`/枚举、`Object.keys(localStorage)` 等 | `capabilities.mjs:128-146` |
| M4 | warn | `fetch`/XHR/WebSocket/EventSource/`sendBeacon` 主动网络通信（含 `call`/`apply` 间接调用），记录 target/method/expression | `capabilities.mjs:148-169`；`links.mjs:98-115` |
| M5 | high | `while(true)`/`while(1)`、`for(;;)` 明显无界循环（token 级兜底，无 AST 时也工作） | `capabilities.mjs:60-92,105-107,148` |

#### 2.2.3 外部目标（U2–U5）

外链收集覆盖：静态字符串、模板串、字符串拼接、常量对象/数组、`URL` 构造、媒体上下文（`avatar/image/cover/poster/gallery/...`）、`window.open`/`location.assign|replace|href`/`setAttribute('href'|'action'|'formaction')`、HTML `href/src/poster/srcset/action/formaction`、CSS `url()`、Markdown 链接/图片、正文裸 URL（`links.mjs:197-326`）。

| 规则 | 严重度 | 检出内容 | 证据 |
| --- | --- | --- | --- |
| U2 | warn | 非官方、非可信媒体主机的 http(s) 目标 | `links.mjs:328-341` |
| U3 | warn | `http:` 明文目标 | `links.mjs:338-339` |
| U4 | warn | IP 地址主机（IPv4/IPv6） | `links.mjs:338-339` |
| U5 | warn | 运行时变量/动态拼接决定的 URL，或包含 `$1`/`${}`/`<%` 等替换占位 | `capabilities.mjs:171-176`；`links.mjs:259,335` |

信任与豁免：
- 可信媒体主机为 `files.catbox.moe`、`i.ibb.co`，且仅当 usage=media 且路径含图片/视频扩展名时豁免（`external-links/policy.mjs:14,100-112`）。
- 官方 URL 规则（仅抑制 U2）：`testingcf.jsdelivr.net`/`cdn.jsdelivr.net`/`raw.githubusercontent.com` 的 `/gh/StageDog/tavern_resource/...`，以及 `github.com/zonde306/ST-Prompt-Template/...`（`links.mjs:6-11`）。
- CharInfo 受管块（`<%# char-info-ejs-builder:start:v2 %>` 到 end）在满足固定结构且全部媒体 URL 可信时，抑制动态媒体提示（`policy-config.mjs:9-120`；`links.mjs:220`）。
- 动态媒体候选只有“全部候选都可信”才抑制提示；空候选不抑制（`external-links/policy.mjs:127-148`）。

#### 2.2.4 API 使用（API1–API2）

`API_CATALOGUE`（`api-catalogue.mjs:21-31`）覆盖：
- 变量：`getvar`/`getLocalVar`/`getGlobalVar`/`getMessageVar`，`setvar`/`setLocalVar`/`setGlobalVar`/`setMessageVar`
- 世界书：`getwi`/`getWorldInfo`、`activewi`/`activateWorldInfo`、`getWorldInfoData`、`getWorldInfoActivatedData`
- 其它：`execute`、`getqr`/`getQuickReply`、`evalTemplate`、`define`

| 规则 | 严重度/可见性 | 检出内容 | 证据 |
| --- | --- | --- | --- |
| API1 | warn / reviewer_only | 异步 API 的返回值在未 `await` 的情况下被当字符串拼接/模板/成员读取（`.then/.catch/.finally` 除外） | `api-catalogue.mjs:99-106` |
| API2 | warn / reviewer_only | 已知 API 实参少于最小数量（有 spread 时不报） | `api-catalogue.mjs:107-114` |

目录是“建议性事实”，未知函数从不拒绝；`define`/扩展可替换上下文（`api-catalogue.mjs:3-7`）。

#### 2.2.5 提示（AH1–AH4）

| 规则 | 严重度 | 检出内容 | 证据 |
| --- | --- | --- | --- |
| AH1 | hint | `atob`/`btoa`、`String.fromCharCode/fromCodePoint` 字符串构造 | `capabilities.mjs:178-180` |
| AH2 | hint | 动态/间接调用；动态媒体/跳转目标；CSS/HTML 属性中的动态 URL | `capabilities.mjs:181-183`；`links.mjs:220,242,282,304` |
| AH3 | hint | 运行时 `replace/replaceAll/split/join` 操作含 `<%`/`%>` 的字符串 | `capabilities.mjs:184-186` |
| AH4 | hint | 运行时 `document.createElement('script')` | `capabilities.mjs:187-188` |

#### 2.2.6 语法与预算

| 规则/预算 | 行为 | 证据 |
| --- | --- | --- |
| EJS-PARSE | 世界书 EJS/内嵌 JS 语法错误，high | `syntax-findings.mjs:2-9` |
| JS-PARSE | 正则 `replaceString` 语法错误，high | `syntax-findings.mjs:2-9` |
| FILE | 文件无法读取/找不到 entries 或 replaceString，high | `index.mjs:17-25` |
| CHECKER-INTERNAL | 检查器内部失败，high | `syntax-findings.mjs:10-16` |
| CHECKER-LIMIT | 超出预算，high | `syntax-findings.mjs:10-16`；`limits.mjs:4-11` |
| 条目上限 | 2000 条/次 | `limits.mjs:5`；`index.mjs:30-33` |
| 代码单元上限 | 500 段/次 | `limits.mjs:6`；`syntax.mjs:24` |
| 单段 JS 字符上限 | 200,000 | `limits.mjs:7`；`syntax.mjs:23` |
| AST 节点上限 | 40,000/段，100,000/次 | `limits.mjs:8-9`；`syntax.mjs:25-31` |
| 浏览器超时 | 120,000 ms | `limits.mjs:10` |

语法解析的实现细节（会丢失的能力）：
- EJS tokenizer 支持 `<% %>`、`<%= %>`、`<%_ %>`、`<%- %>`、`<%# %>`，并把嵌套的 ST 标签独立配对（`source-units.mjs:75-135`）。
- 世界书条目先构建 `(async function(){...})` 包装（ST 非 module、async 执行）；HTML 解析用 parse5，JS 属性/`javascript:` URL/`<script>` 各自成单元（`source-units.mjs:75-135`；`syntax.mjs:68-84`）。
- 动态 EJS 输出会遮蔽模板区间，无法证明最终 HTML 脚本时只保留静态单元（`syntax.mjs:84`）。

#### 2.2.7 报告语义

| 输出 | 行为 | 证据 |
| --- | --- | --- |
| 可见性 | L1–L7、EJS-PARSE、FILE、JS-PARSE、CHECKER-INTERNAL、CHECKER-LIMIT → `uploader_detailed`；M1/M2/M5 → `uploader_generic`；其余 → `reviewer_only` | `report.mjs:58-64` |
| 上传版投影 | M1/M2/M5 变为 `SCRIPT-RISK`（high）；M3/M4 变为 `SCRIPT-REVIEW`（warn）；其余 reviewer_only 隐藏 | `report.mjs:105-134` |
| gate | 仅 high + L1–L7 → `reject`，否则 `accept` | `report.mjs:83` |
| audit | reject → `not_applicable`；否则任意 high/warn/hint → `yellow`，否则 `green` | `report.mjs:84-87` |
| certification | 任意 high → `fail`；任意 warn → `review`；否则 `pass` | `report.mjs:88-91` |

注意：按旧代码，**语法错误（EJS-PARSE/JS-PARSE）不会把 gate 变成 reject**，只会让 certification 失败；这是旧实现的实际行为，迁移时需要明确是否有意保留。

### 2.3 旧的上传前检查 / 收据 / 审核绑定

旧流程（`2aa31fb^`）：

1. **Preflight**：`POST /api/projects/preflight/:kind`（`cloudflare/src/index.ts:257`，实现 `cloudflare/src/endpoints/projects/assets.ts:84-160`）。
   - 校验登录、`Content-Length`、10 MiB、仅 JSON、`validateProjectContentText` 结构校验。
   - 计算 `contentHash = sha256(text)`，签发 HMAC 收据：`PW-CONTENT-BINDING-2026-10-07.1`，30 分钟 TTL，绑定 `uid + kind + checkerRevision + contentHash`（`attestation.mjs:8-9,144-155`）。
   - 明确**不跑规则分析**，也不证明浏览器真的执行了 checker（`assets.ts:27-33,136-149`）。
2. **上传**：`POST /api/projects/:id/upload` / `upload-regex` 要求 `x-workshop-content-attestation`，`validateAttestedUpload` 校验 TTL/用户/kind/checker revision/内容 hash（常量时间比较）（`assets.ts:36-54,269-277`）。
3. **审核详情**：`AdminReviewDetail`（`cloudflare/src/endpoints/admin.ts:340-445`）返回：
   - 精确的待审内容 `files`、`filesHash`、`policyVersion`、`engine`、`parserCompatibility`、`trustedAssetHosts`、上一轮 `baseline`；
   - 20 分钟有效、绑定 `projectId + draftRevision + filesHash + checkerRevision` 的签名 challenge（`attestation.mjs:179-197`）；
   - `buildProjectReviewDiff` 生成的条目级 diff（added/modified/deleted/unchanged、changedFields、current/previous）。
4. **审核提交**：`AdminReview`（`admin.ts:449-560`）要求 `reviewerResult`：
   - challenge + `gate: accept|reject` + `auditSnapshot{filesHash,policyVersion,engine,parserCompatibility,findings[key,fingerprint,rule]}`。
   - `verifyReviewerResult` 逐项校验 challenge 的角色/项目/revision/checker revision/内容 hash、结果的 project/revision/filesHash、snapshot 的 policy/engine/parser 与 finding 形状；任一不符 fail closed（`attestation.mjs:214-260`）。
   - checker gate 为 reject 时，人工批准必须填写 8–500 字理由（`attestation.mjs:17-24`；`admin.ts:188-196`）。
   - 服务端**从不重跑规则**，只做字符串/数组比较；通过后把 `acceptedCodeCheck`（snapshot + reviewerId + reviewedAt + revision）写回项目（`admin.ts:639`）。
5. **审计快照/基线**：`buildAuditSnapshot` 对每个 entry 的规范化语义与整个项目文件做 hash；finding fingerprint = `policyVersion + projectHash + entryHash + rule + occurrence + normalizedEvidence`；`applyAuditBaseline` 把本轮 finding 标成 `new/changed/accepted/removed`，并保留 `removedFindings`（`audit.mjs:113-186`）。

### 2.4 当前仓库里实际存在的 Checker

- **规则源码：无**。`apps/` 与 `packages/` 中没有任何 EJS/正则分析、外链策略、API 目录、预算或报告代码；`git grep -i 'checker' apps packages` 只命中 `submissions.gate/checker_revision` 与 `reviews.checker_version` 的读写。
- **Checker 资源路由：无**。`app.ts:39-59` 的 `/api/v1/assets/*` 只服务 `covers/` 与 `banners/`；没有 `/assets/upload-checker.js`、`/assets/review-checker.js`、`-notices.txt`。
- **DO / Cron：无**。`wrangler.jsonc` 只有 `assets`、`d1_databases`、`r2_buckets`、`vars`；没有 `durable_objects`、`migrations`（DO 类）、`triggers.crons`；`index.ts:5-8` 只有 `fetch`。
- **报告/证明：无**。提交把调用方给的 `gate`/`checkerRevision` 原样入库（`storage/authoring.ts:375-379`）；审核把调用方给的 `checkerVersion`/`report` 原样入库（`storage/admin.ts:278-279`），没有 hash、版本、耗时或 findings 绑定。
- **离线产物：存在但死**。`util/ejs-checker-v2.js` 含完整旧规则（可检索到 `L1..L7/M1..M5/U2..U5/API1..API2/AH1..AH4/CHECKER-LIMIT/EJS-PARSE/JS-PARSE/CHECKER-INTERNAL/FILE` 与 `PW-CODE-POLICY-2026-10-10.1`），但：
  - 新 Worker/Web 不引用它；
  - 其生成脚本 `cloudflare/scripts/build-ejs-offline.mjs` 已随 `cloudflare/` 删除，无法重建；
  - `util/ejs-preflight.html` 是未路由的静态页，`script src="ejs-checker-v2.js"` 只在本地文件布局下有效。
- **语料/测试：无**。当前 `tests/` 只有 `tests/fixtures/legacy/`（旧公开 API 样本）；旧的 `tests/e2e/checker-audit-ui.spec.mjs`、`ejs-preflight.spec.mjs`、`ejs-two-phase-upload.spec.mjs` 与 `cloudflare/tests/fixtures/ejs-checker-v1.mjs` 均已删除（P6 第 4 节）。

### 2.5 当前缺失的规则类别与行为（按旧规则逐项对照）

| 旧类别 | 当前 | 缺失的具体行为 |
| --- | --- | --- |
| L1–L7 | 无 | 顶层 var/let/const/function/class 组合兼容；共享全局/裸赋值；通用命名；跨条目符号冲突；decorator 位置与 `@@private` 语义 |
| M1–M5 | 无 | eval/Function 动态执行；敏感 cookie/storage；主动网络通信（含间接调用与 XHR）；无界循环 |
| U2–U5 | 无 | 外链收集与分类；HTTP/IP；动态 URL；可信媒体主机（catbox/ibb）与扩展名限制；官方 URL 豁免；CharInfo 受管块豁免 |
| API1–API2 | 无 | 19 个 ST-Prompt-Template API 的异步等待与最小实参检查 |
| AH1–AH4 | 无 | 编码构造、动态/间接调用、运行时改写 EJS 标记、运行时创建 `<script>` |
| EJS-PARSE / JS-PARSE / FILE | 无 | EJS tokenizer、嵌套标签、HTML/JS 单元、正则脚本解析、错误行列映射 |
| CHECKER-INTERNAL / CHECKER-LIMIT | 无 | 内部失败分类；2000 条/500 单元/20 万字符/4 万与 10 万 AST 节点/120s 预算 |
| 报告语义 | 无 | gate/audit/certification；severity 与 visibility；上传版 SCRIPT-RISK/SCRIPT-REVIEW 投影；错误提示文案 |
| 审计/基线 | 无 | filesHash/projectHash/entryHash；finding fingerprint；accepted/changed/new/removed；上一轮快照保留与 diff |
| 审核绑定 | 无 | DO/审核同 revision；challenge 绑定 project/revision/filesHash/checkerRevision；snapshot 结构与 policy/engine/parser 校验；manual override 理由 |
| 分发包 | 部分（仅旧离线文件） | 两个浏览器 bundle、revision 文件、`?v=` immutable 缓存、notices |

按决策**不应恢复**的旧行为：attestation 收据与二次上传（D-34）、配套脚本依赖健康检查（D-08）。这两项不计入缺口；但它们的替代物（单次上传 + 服务端结构校验 + DO 权威复核）也没有实现。

## 3. Surprises：state.md 声称完成但未接线

1. **内容策略/结构校验只存在于 `@workshop/domain`，API 从未调用。**  
   S:25 说“新增 `@workshop/domain`：taxonomy、内容策略、上传上限”。实际上 `apps/worker` 只 import 了 `WORKSHOP_LIMITS`（`apps/worker/src/http/routes/authoring.ts:1,27`）；`validateProjectContentText`（`packages/domain/src/project-content.ts:169`）与 `validateProjectContentPolicy`（`content-policy.ts:45`）在 `apps/` 中零调用；只有后者被 domain 单测覆盖（`packages/domain/test/content-policy.test.ts:2-25`），前者连测试都没有。因此 D3/D4 的“识别 + 策略”和 D14 的“发布前检查”实际未生效。

2. **“短搜索保留 FTS 短索引”未使用。**  
   S:36 声称短搜索保留 FTS 短索引。schema 确实建了 `project_search_short` 与维护触发器（`0001_initial.sql:334-345,361-433`），但 `searchPredicate` 对 ≤2 字直接拼 `LIKE`（`apps/worker/src/storage/projects.ts:125-138`），从未查询该表。短索引是死数据；行为退化为全表 LIKE。

3. **Web 的排序 tab 在默认列表上无效。**  
   S:28 说“搜索/排序/详情侧栏”。实际 `App.tsx:108` 在搜索为空时渲染 `home.latest`，而 `home.latest` 固定为 6 条（`storage/home.ts:74`）；`sort` state 只在 `api.projects` 调用中生效（`App.tsx:63-68`）。默认页的 4 个排序 tab 会触发请求，但结果被丢弃，列表不改变。

4. **提交只记录客户端 gate，不产生任何独立复核。**  
   S:20 把“提交”列为已完成；S:88 只承认“内容 checker DO”缺失。实际上 D:42-50 要求的“客户端 gate 只作路由信号”没有配套的 DO 检查、路由或自动发布；`storage/authoring.ts:373-379` 直接把请求里的 `gate` 写入 `pending` 提交。

5. **`GET /admin/audit-events` 不存在，但 README 声称“审核…审计”。**  
   README:47 列出“审核：待审队列、发布指针切换、成员角色、审计”；M:170 的 API 契约包含 `GET /admin/audit-events`。当前 admin 路由只有 submissions/projects/members（`apps/worker/src/http/routes/admin.ts:38,51,60,80,93,105,117`），`audit_events` 只写不读（`storage/admin.ts:299,418`）。

6. **`/client/*` 被设为 Worker 优先，但没有处理器。**  
   `wrangler.jsonc:15` 配了 `"run_worker_first": ["/api/*", "/client/*"]`，但 `app.ts` 没有 `/client/*` 路由；请求最终走文本 404（`app.ts:85`）。D-22 的客户端分发（R2 代理、版本指针、cache tag）整个不存在，`config/workshop.json` 的 client 版本与路径无任何服务端读取。

7. **PKCE “可选”实际是不可兑换。**  
   S:88 说“PKCE challenge 可选”。对于客户端不传 `codeChallenge` 的 flow，服务端生成 `verifier` 后只存其 SHA-256（`storage/identity.ts:55-59`），既不返回给客户端，也没有 redeem 端点（`auth.ts` 无对应路由）；因此这类 flow 永远无法完成 token 交换。传了 `codeChallenge` 的 flow 也没有 redeem 端点。

8. **旧客户端仍指向已删除的 API，构建产物与配置仍宣称可用。**  
   README:30-38 与 AGENTS 仍把 `src/CreativeWorkshop` 作为客户端入口，`pnpm build` 仍构建它。但该客户端请求 `/api/projects/:id`（`src/CreativeWorkshop/services/project-fetch.ts:311`）与 `/api/files/*`（`:257-271`），新 Worker 只有 `/api/v1/*`，未匹配一律 404（`app.ts:28-37,79`）。这不是“未接入 UI”级别的缺口，而是旧客户端在切换后不可安装/更新。

9. **`util/ejs-checker-v2.js` 的保留理由已失效。**  
   P6:63 说该生成产物“但客户端仍引用”。实际当前新仓库没有任何代码/页面引用它；唯一引用在未路由的 `util/ejs-preflight.html:68`。同时生成它的脚本已删除，产物无法重建。

## 4. 额外可证明的功能性缺陷（与上面的功能缺口分开）

1. **私有项目的封面在作者自己的 draft 接口里必然 404。**  
   `GET /api/v1/projects/:id/draft` 返回 `getProjectSummary` 的 `coverUrl`（`authoring.ts:62-74`；`storage/authoring.ts:97,114` 以 `working_revision_id` 查 cover），但 `/api/v1/assets/*` 对 `covers/` 只允许 `visibility='public'` 的项目（`app.ts:44-52`），且不接受会话。触发条件：作者打开一个带封面、尚未发布的私有项目草稿页。影响：作者看不到自己的封面；审核者也无法通过 `GET /admin/submissions/:id/files/:kind` 读取封面（`admin.ts:64` 只允许 worldbook/regex）。

2. **拒绝可以没有原因，与 D10 的“项目卡显示拒绝原因”冲突。**  
   `adminReviewRequestSchema.reason` 可选（`packages/contracts/src/admin.ts:22`），`reject` 路径直接写 `request.reason ?? null`（`storage/admin.ts:295`）；同时没有作者侧接口暴露 `reviews.reason`。触发条件：审核者直接点拒绝、不填理由。影响：作者无法看到任何可执行的拒绝原因。

3. **`discordThreadUrl` 只校验“是 URL”，未执行 Discord 主机/线程/guild 白名单。**  
   `packages/contracts/src/authoring.ts:15` 使用 `z.string().url()`；配置里有 `config/workshop.json:26-28` 的 `discordGuildIds`，但 Worker 从不读取它。旧实现的 `normalizeProjectDiscordThreadUrl` 会限制 `https://discord.com/channels/<guild>/<thread>`、snowflake 长度与 guild 白名单（旧 `external-links/policy.mjs:202-241`）。触发条件：作者提交任意 URL（包括邀请链接、其他 guild、`http:`）。影响：详情页“Discord 帖子”按钮可指向任意站点，绕过社区入口策略；D-30 的 URL 允许列表未实现。

4. **空内容/不合规内容可以提交并被批准。**  
   提交只做“revision 是 working、未被提交过”的判断（`storage/authoring.ts:358-379`），不检查是否存在可用世界书/正则，也不校验项目类型策略。`manifest_hash` 对空 asset 列表也会得到 `sha256("")`（`:383-387`），因此审批的 `!target.manifest_hash` 检查（`storage/admin.ts:274`）不会拦截。触发条件：创建项目后不传任何文件直接 submit。影响：空项目可被发布；D14 的策略检查缺失使这一点在审核层也无人拦截。

5. **审核报告字段可被任意替换且不校验结构。**  
   `adminReviewRequestSchema` 的 `report` 是 `z.unknown()`、`checkerVersion` 是任意短字符串（`packages/contracts/src/admin.ts:20-25`）；存储直接采用请求值（`storage/admin.ts:278-279`），仅在审批时要求 `manifest_hash` 存在。现有测试甚至以 `{ checkerVersion: "review-2", report: { warnings: 1 } }` 直接批准（`apps/worker/test/admin-review.test.ts:88-99`）。触发条件：任何 reviewer 调用 review API。影响：审计记录中的 `checker_version/report` 不能证明任何检查发生过；与 F:228,289、D:281-292 的绑定要求相反。

6. **`/api/v1/site` 只返回 banner，`site_settings` 的通用键值没有入口。**  
   `site.ts:7` 固定返回 `{ banner }`；`site_settings` 表只有 `discover_banner` 被读取（`storage/home.ts:18-27`）。F13 的“KV 风格键值 + 归档进 D1”只完成了表结构。

7. **admin 项目列表包含已软删项目且无筛选。**  
   `storage/admin.ts:340-368` 的查询没有 `deleted_at IS NULL` 过滤，返回 `deletedAt` 字段但无过滤参数。触发条件：有软删项目后打开管理列表。影响：管理面会展示已删除项目且无法按状态筛选（F6 只做到“全量列表”）。

## 5. 范围外架构缺口（与缺失功能行为分开）

这些是重构骨架/决策层面的未完成项，不应与“功能未实现”混为一谈：

- `apps/tavern-client` 不存在；D-20 的双产物目录只完成了 Worker 侧。
- `packages/content` 不存在；checker/解析应有的归属包未建立（D-18）。
- 没有 `ContentService` DO（D-01/D-25），因此第 5/13 节的权威检查没有运行位置。
- 没有 Workers Cache / `cache.enabled` / Cache-Tag 实现（D-24/D-28）；当前响应统一 `private, no-store`（`app.ts:22-25`）。
- 没有 cron/jobs 目录（D-25 的批处理、J1/J2、清理任务）。
- 没有 `/client/*` R2 代理与版本记录（D-22）。
- Web UI 只有只读列表/详情（S:92 自认）；登录、上传、审核后台未接入。
- 真实 Discord client secret / callback 未配置（S:97），因此即使补端点也需要外部配置。

## 6. 命令（只读）与检查过的测试

只读命令：
- `git log --oneline -8`、`git status --short`、`git show --stat 2aa31fb`、`git ls-tree -r --name-only 2aa31fb^`
- `git show 2aa31fb^:cloudflare/src/utils/ejs-checker/{index,policy,capabilities,links,api-catalogue,report,audit,attestation,syntax,syntax-findings,source-units,scope,limits,policy-config,review-worker,upload-worker,browser,cache}.mjs`
- `git show 2aa31fb^:cloudflare/src/utils/external-links/policy.mjs`
- `git show 2aa31fb^:cloudflare/src/endpoints/{admin,projects/assets,auth,site-settings,recommendations,character-references}.ts`
- `git show 2aa31fb^:cloudflare/scripts/build-{review,upload,ejs-offline}*.mjs`
- `git show 2aa31fb^:cloudflare/src/index.ts`（路由表、checker 资源路由、`?v=` 缓存）
- `git show 2aa31fb^:cloudflare/tests/fixtures/ejs-checker-v1.mjs`（旧语料/规则快照，仅查看）
- `git show 2aa31fb^:cloudflare/src/generated/{review,upload}-checker-revision.json`
- `git show 2aa31fb^:cloudflare/src/generated/{review,upload}-checker.txt | base64 -d | sha256sum`（核对 revision）
- `sha256sum util/ejs-checker-v2.js`（核对离线 bundle）
- `grep`/`git grep`/`wc`/`ls`/`du`/`sed`：用于定位当前文件、规则字符串、行号与残留引用
- `find`/`ls`：目录结构；`data_backup/` 只做了文件名列举，未读取内容

检查过但没有运行的测试（静态阅读）：
- `apps/worker/test/app.test.ts`（健康检查、JSON 404、安全头、非 API 文本回退）
- `apps/worker/test/authoring.test.ts`（CAS、私有可见性、revision 不可变、上传哈希、提交 supersede/冻结、大小/MIME）
- `apps/worker/test/admin-review.test.ts`（队列、详情、批准切指针、拒绝/双击、角色与最后 owner）
- `apps/worker/test/read-path.test.ts`（列表、1–2 字搜索、详情/私有 404、下载幂等、release 登录门禁、home/recommendations/references/banner）
- `apps/worker/test/identity-interactions.test.ts`（会话、撤销、Origin/flow、幂等点赞/订阅、评分私有）
- `apps/worker/test/bindings.test.ts`（D1/R2 冒烟）
- `packages/domain/test/content-policy.test.ts`（策略函数单测）
- `tools/migrate/test.mjs`、`tools/migrate/test-from-sql.mjs`（未执行）

未运行任何测试/构建/E2E；本报告的“通过/失败”均不代表运行结果。

## 7. 审计限制

- 本审计不读取 `data_backup/` 内容（仅列目录），不接触真实 D1/R2/Cloudflare 资源。
- `state.md`、`p6-cleanup.md` 的陈述均按“声称”处理，结论以代码为准；已明确标注哪些旧文件只存在于 git 历史。
- 未对旧 `util/ejs-checker-v2.js` 做逐行解码核验（minified bundle）；规则清单以旧源码 + bundle 中可检索的规则字符串为准。

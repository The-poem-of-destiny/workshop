# Creative Workshop 重构方案（综合定稿）

日期：2026-10-20  
输入：两份独立方案（`model-deepseek.md` 记为 A，`model-gpt.md` 记为 B）+ 本次逐文件复核。  
性质：这是**决策文档**，不是三份方案的对照。冲突项在 §12 裁决，采纳来源逐条标注。

复核方式：A/B 的关键指控都回到代码验过；另外补查了三处会影响裁决的事实——`visibility` 的实际过滤位置、FTS 搜索的真实调用、排行相关表的引用范围（见 §1.3、§12）。

---

## 0. 决策摘要

1. **重写，不搬目录。** 保留产品语义与安全姿态，替换实现：一个 pnpm workspace、一个 Worker、一个 React Web、一个 Tavern Helper 桥接脚本。
2. **鉴权先修，再谈结构。** OAuth 登录当前可被任意站点劫持（已核实）；改成 Origin 白名单 + 一次性 flow + 可撤销 opaque session，角色每请求读库。
3. **发布改成不可变修订 + D1 指针切换。** 删除“复制草稿行 + 复制 R2 + 失败回滚”的补偿式发布。
4. **单一 Worker + Static Assets**，不用 Pages；默认删除 DO 与 KV（前提：付费 CPU 配额，实测通过）。
5. **数据从 `0001_initial.sql` 重建**，旧库只读保留；迁移保留公开项目 id，逐表映射 + 对账。
6. **一次性切换**：停写屏障必须覆盖旧文件 GET 计数与 OAuth 写路径；开放写入后不承诺无损回切旧库。
7. **缓存分两步走**：切换时所有动态 API `no-store`；验收后再对 viewer-neutral 的公开 GET 开 Workers Cache。
8. **保留中文 FTS 搜索、排行榜、互动计数与抽签行为**；只删除确认无生产调用的旧小时榜模块与表。
9. **删除源码正则测试**，重建为 domain 单测 + workerd 集成 + 契约测试 + 少量真实 E2E。
10. **产物不入库**（客户端 release 产物除外），用不可变 CI artifact + 精确 SHA 部署。

---

## 1. 诊断

### 1.1 P0：账号安全

**登录可被任意站点劫持（A 发现，已核实）**

- `endpoints/auth.ts:139`：`AuthLogin` 把请求头 `Origin` 直接当作回调白名单，没有允许列表。
- `index.ts:127`：全站 `Access-Control-Allow-Origin: *`，任意站点可读取 `/api/auth/login` 的返回值。
- `endpoints/auth.ts:364`：回调页用 `postMessage(payload, allowedOrigin)` 把 JWT 发给该 Origin。
- `endpoints/auth.ts:205`：`/api/auth/poll?key=<state>` 仅凭 state 返回 token；state 由调用方自己取得。
- 结论：恶意站点无需受害者安装任何东西即可取得其会话，管理员同样受影响。

**权限是签发快照，登出不撤销（B 发现，已核实）**

- `utils/jwt.ts:92`：默认 7 天，payload 内嵌 `isAdmin`/`isSuperAdmin`。
- `endpoints/auth.ts:448`：`AuthLogout` 是空实现；撤管理员后旧 token 保留旧权限。

### 1.2 P0：发布不是原子动作

- `projects` 同时是公开项目、草稿、审核快照与计数器（`schema.sql` 29 张表，项目表含 `published_project_id`/`draft_project_id`/`root_project_id`/`review_target`/`draft_revision`/`content_mutation_token`）。
- 编辑先 `createDraftFromPublished`（`utils/db.ts`，150 行、最多 3 次重试）；上传、封面、正则、删条目各自重复一遍。
- 审核通过：改发布行 → 复制 R2 → 失败逐项回滚 → 删草稿（`endpoints/admin.ts`、`utils/r2.ts:copyProjectFilesToPublished`）。D1 与 R2 没有共同事务。
- 草稿删除只删 D1 行，不删 R2 前缀 → 每次更新留下孤儿对象。

### 1.3 P1：结构性问题

| 问题 | 证据 |
|---|---|
| UI 是字符串，不是前端 | `pages/home/` 14,954 行，其中样式 4,527 行；`app.ts` 拼 18 段；唯一语法验证是 `check-home-js.mjs` 的 `new Function()` |
| 类型约束被关闭 | `cloudflare/tsconfig.json`：`noImplicitAny:false`、`strictNullChecks:false` |
| 路由与分发重复 | 50 条 OpenAPI + `index.ts:contentServiceKey()` 正则再进 DO，DO 内又调 `app.fetch` |
| 数据层无边界 | `utils/db.ts` 1,916 行；`install-info` 另写 SQL；客户端直接 import Worker 源码（`services/project-fetch.ts:2`） |
| 缓存多份且互相冲突 | `caches.default` ×3 + 头 ×5 + 客户端列表 15s/60s + 详情/diff/repair TTL；`s-maxage` 与 SWR 互斥；`forceRefresh` 永远为 false |
| 可见性语义含糊 | `visibility=1` 只过滤列表与搜索（`utils/db.ts`），`/api/files/*` 对 `approved` 项目一律放行，不检查 `visibility`/`is_published` |
| 测试信号弱 | 74 个 node 脚本，49 个读源码做正则断言；CI 只链 9 个 check；Playwright 默认打线上 staging |
| 发布不可复现 | 两套包管理、两份 lockfile；`dist/`、`test-dist/`、`test-bundles/`、`generated/*.txt` 入库；部署脚本硬编码 `upstream` |
| 死代码 | `wrangler.frontend.jsonc`、`test-bundles/` 无引用；`utils/auth.ts` 的 KV session 无生产调用；`project-ranking-snapshots.ts` 只被自己的测试引用 |

### 1.4 补充事实（本次复核，用于裁决）

- **搜索是活的**：`project_search`（FTS5）、`project_search_short`、`project_search_tags` 被 `utils/db.ts` 的分支实际使用（`MATCH` 与标签 join）。删掉换 `LIKE` 会退化 1–2 字中文搜索，且 `LIKE '%x%'` 用不上索引。
- **排行表一半是活的**：`project_daily_rankings` + `discovery_feature_history` 由 cron 写入；`project_ranking_builds` 被日榜使用；`project_rank_snapshots` 与 `project_ranking_days` 只被已死的 `project-ranking-snapshots.ts` 及其测试引用。
- **7d/30d 排序是活的**：`project_period_popularity` + `project_period_tracking_meta` 被 `utils/db.ts` 的周期排序路径使用。

---

## 2. 目标架构

综合 A/B 的树，采用 B 的分层（worker 内 `http → use case → storage`），不设独立 `db` 包（A 与 B 都不设；独立包会逼出通用仓储层）。

```text
workshop/
├ apps/
│  ├ worker/
│  │  ├ src/
│  │  │  ├ index.ts            # fetch/scheduled 装配，无业务分流 regex
│  │  │  ├ http/               # 路由、auth context、DTO、错误映射
│  │  │  ├ modules/            # identity / projects / catalog / interactions / administration
│  │  │  ├ storage/            # D1 查询、R2 读写、具体函数
│  │  │  └ jobs/               # 榜单、过期会话、孤儿对象回收
│  │  ├ migrations/            # 0001_initial.sql 起，唯一 schema 来源
│  │  └ wrangler.jsonc         # 显式 environment bindings
│  ├ web/                      # Vite + React + Tailwind + shadcn（后续专项）
│  └ tavern-client/            # TH 桥接、安装/更新/修复（单文件产物）
├ packages/
│  ├ contracts/                # zod HTTP/bridge schema、错误码、DTO
│  ├ content/                  # 解析/规范化/fingerprint/checker
│  └ domain/                   # taxonomy、内容策略、排行规则
├ config/workshop.json        # 发布通道/端点/配套脚本依赖
├ data/                        # 官方卡基线
├ tools/                       # 构建、发布、数据迁移
├ tests/                       # 集成、e2e、迁移样本
└ docs/
```

依赖规则（CI 用 dependency-cruiser 强制）：

- `contracts` / `content` / `domain` 不依赖 Hono、Cloudflare binding、DOM、TH 全局对象。
- `web`、`tavern-client` 只依赖上述三个包；禁止 import Worker 实现或 `../../../cloudflare/...`。
- Worker 内 `http` 不写 SQL；`storage` 不接收 `Context`、不返回 `Response`；多表事务由 use case 组织。
- 全包 strict TypeScript；第三方边界用 `unknown` + schema，不用 `Record<string, any>`。

---

## 3. 运行时

- **一个 Worker**：`/api/*` 由 Hono 处理；`/assets/*`、`/`、`/client/*` 交给 Static Assets；未匹配 `/api` 返回 JSON 404，不能被 SPA fallback 吞掉。
- **DO：默认删除。** 前提是 Workers Paid（30s CPU），用 10MB 世界书实测解析耗时；若超预算，只加回一个 `ContentService`，由 Hono 直接 `getByName(projectId)`，不再写正则分发器。
- **KV：新系统不用。** OAuth flow、session 全落 D1，可审计、可原子消费。
- **认证**：opaque session token（32 字节随机，库中只存 HMAC），30 天滑动过期；每请求查 `sessions → users.role`，撤销即时生效。
- **OAuth**：`POST /auth/flows` 返回 `authorizeUrl + state`（Origin 必须命中白名单）→ 回调校验 state/TTL/guild → 生成一次性 `login_code` → 前端 `POST /auth/flows/:id/redeem` 换 session。token 只出现在 JSON body，不进 URL/HTML。
- **CORS**：只回显允许的 origin，不开 `*`、不启用 credentials。
- **cron**：榜单生成、周期热度快照、过期会话/孤儿资产回收。

---

## 4. 数据模型

新库从 `0001_initial.sql` 建；`schema.sql` 与 migrations 不再并存两份。

| 表 | 关键约束 |
|---|---|
| `users` | Discord id；`role ∈ member/reviewer/owner`；不保留 is_admin/super_admins/admins 三套 |
| `sessions` | token hash、user_id、expires_at、revoked_at |
| `oauth_flows` | state hash、redeem secret hash、状态、过期、一次性消费 |
| `projects` | 稳定 id、author、`visibility ∈ public/unlisted/private`、`published_revision_id`、`working_revision_id`、`row_version`、`deleted_at` |
| `project_revisions` | 不可变；`UNIQUE(project_id, revision_no)`；metadata + asset 引用 + manifest_hash |
| `assets` | R2 key（UUID）、sha256、bytes、mime、kind |
| `submissions` | 一个项目最多一个 pending（partial unique index） |
| `reviews` | `submission_id UNIQUE`；decision、reason、manifest_hash、checker_version、report |
| `likes` / `subscriptions` / `ratings` | 复合唯一；评分仅本人可见 |
| `project_metrics_daily` | 下载/点赞日增量；保留历史基数 |
| `ranking_runs` / `ranking_entries` / `discovery_exposures` | 完整 run 才发布；读请求只查 |
| `recommendations` / `site_settings` / `reference_*` / `audit_events` | 审计与业务写入同一 batch |

**发布算法**（A 的 schema + B 的原子性）：

1. 编辑必须带 `If-Match`（row_version）；创建不可变 revision，条件更新 working 指针，返回 412。
2. 上传一次完成：限流读取 → 校验结构与大小 → 计算 sha256 → 写新 R2 对象 → 登记 asset；不覆盖旧对象。
3. 提交把 revision 封为 submission；重新提交在同一事务 supersede 旧 pending。
4. 审核写 `reviews`，绑定 submission、manifest_hash、checker 版本；不签发“创作者本机检查通过”的证明。
5. 批准：一个 D1 batch 内 CAS submission 状态、校验 base 指针、写 audit、切 `published_revision_id`；竞争者 409。
6. 下载从 published revision 的 manifest 取 asset；每次检查 session 与项目访问权。
7. 清理：非 published、非最新 draft、超过 90 天的 revision 与其 R2 前缀由 cron 回收；首次只出 dry-run 报告。

**可见性**：显式三态。`public` 列表/搜索可见；`unlisted` 仅凭链接可见、不进列表；`private` 仅作者/审核者。当前 `visibility=0 + approved` 的行为按 `unlisted` 迁移，避免静默改变产品语义。

---

## 5. API 契约（`/api/v1`）

| 组 | 端点 |
|---|---|
| 公开读 | `GET /projects`（cursor）、`GET /projects/:id`、`GET /home`、`GET /recommendations`、`GET /reference-sets`、`GET /site` |
| 身份 | `POST /auth/flows`、`GET /auth/flows/:id`、`POST /auth/flows/:id/redeem`、`GET /me`、`DELETE /sessions/current` |
| 作者 | `POST /projects`、`PATCH /projects/:id`、`POST /projects/:id/revisions`、`PUT /projects/:id/revisions/:rev/files/:kind`、`POST /projects/:id/revisions/:rev/submit`、`PATCH /projects/:id/visibility` |
| 审核 | `GET /admin/submissions`、`GET /admin/submissions/:id`、`POST /admin/submissions/:id/review` |
| 安装 | `GET /projects/:id/releases/:releaseId/manifest`、`GET /projects/:id/releases/:releaseId/files/:kind` |
| 个人 | `GET /me/state?ids=`、`PUT/DELETE /me/likes/:id`、`/me/subscriptions/:id`、`/me/ratings/:id` |
| 管理 | `GET /admin/projects`、`GET /admin/members`、`PUT /admin/members/:id/role`、`GET /admin/audit-events`、`PUT /site` |

规则：

- 资源名词优先；点赞/订阅/评分用幂等 `PUT/DELETE`，删除 toggle。
- 公开详情只返回摘要与条目索引；可安装内容走 `releases/*/files/*`，与权限检查同一函数。
- 集合返回 `{ items, nextCursor }`；错误统一 `{ error: { code, message, details? } }`。
- 事件副作用（点赞、下载计数）用幂等 key/日配额，不做“自动重试平台”。

---

## 6. 缓存

| 阶段 | 策略 |
|---|---|
| 切换时 | 静态资产内容哈希 + `immutable`；HTML/manifest `no-cache`；**所有动态 API `private, no-store`**；草稿、审核、`/me/*`、计数文件不缓存 |
| 验收后 | 只对 viewer-neutral 公开 GET 开 Workers Cache：`CDN-Cache-Control: max-age=30..60, stale-while-revalidate=...`，`Cache-Tag` 做发布/下架 purge |
| 永不 | 带 `Authorization` 的响应、计数下载、草稿/审核 |

理由：A 假设“边缘会尊重 `s-maxage`”，但没有启用 Workers Cache 时该头没有消费者；B 的首版全不缓存安全但不给开启路径。分两步既满足“现在需要缓存”，又避免在下架/隐藏语义未测试时引入缓存泄漏。

删除 `caches.default` 三处与客户端全部 TTL Map；客户端只保留请求期 in-flight 去重。

---

## 7. 迁移与一次性切换

| 阶段 | 内容 | 验收 | 回滚 |
|---|---|---|---|
| P0 基线 | 旧库导出、R2 清单、路由/权限/字段矩阵、公开 API 样本；旧 Worker 加维护/只读模式 | 快照可本地打开；维护模式停止写入（含 GET 计数与 OAuth） | 只读 |
| P1 骨架 | workspace、contracts、单 Worker + Static Assets、本地 D1/R2、统一错误/鉴权 | 冻结安装可 build/typecheck；`/api` 404 不被 SPA 吞；无字符串 UI、无第二路由表 | 仅新分支 |
| P2 读路径 | auth/session、home/list/detail、manifest/files | 与旧 API 对同一批项目结果等价；OAuth 不再向任意 Origin 发 token | 仅 staging |
| P3 写路径 | revision/upload/submit/review/publish、审计、计数 | 并发提交/审核 409；角色撤销即时生效；批准后无 R2 复制、无孤儿 | 仅 staging |
| P4 迁移彩排 | extract/transform/load/verify，全量两次 + delta | §7.2 对账全过；抽样安装可用 | 销毁新目标 |
| P5 切换 | 停写屏障 → 最终 delta → 部署 → 冒烟 → 开放写入 | 全流程通过；5xx < 0.5% | 开放写入前可回旧；之后只回滚代码 |
| P6 清理 | 删旧 UI/缓存/死表/死测试/生成物 | 旧路径零引用；CI 全绿 | 不需要 |

### 7.1 迁移映射（A 的逐表映射 + B 的异常清单）

- 逻辑项目分组：`published_project_id → root_project_id → id`；取组内 published 行作为项目身份，**保留公开 id**。
- published 行 → revision 1；当前 draft 行 → revision 2；其它 pending/rejected 只保留最新 rejected 供作者查看。
- 文件 key → `projects/{projectId}/revisions/{revId}/{worldbook|regex|cover}`；逐对象校验 sha256/size；不盲 fetch 外链封面。
- users 合并三套权限来源，冲突列阻塞项；JWT、KV OAuth、旧 session 不迁移（全部重新登录）。
- 互动、私人评分、精选、banner、基线、审计、当前抽签/曝光状态迁入；历史日指标只保留可解释部分。
- 不迁：`public_project_counts`、`admins`、`super_admins`、`project_rank_snapshots`、`project_ranking_days`、旧搜索派生表、旧缓存 revision、锁 token。

### 7.2 对账（必须全过）

项目数、published 指针数、每项目文件 sha256、互动数、私人评分、审计条数、FK 完整性、每个 approved 项目满足内容策略、迁移中途失败可恢复、重跑结果一致。

### 7.3 切换

1. 停写：维护入口关闭旧 cron 与所有写路径；**旧文件 GET 会计数，也要一并拦**。
2. 最终 delta → 对账 → 部署新版本（同一 Worker 名、新绑定）→ 受控账号冒烟 → 开放写入。
3. 旧 D1/R2 只读保留 7–90 天；开放写入后不再承诺无损回切旧库（要做就得提前建并演练反向迁移）。

---

## 8. 测试

- **删除**：所有源码正则断言；为死代码保留的测试。
- **保留**：EJS checker 的输入/输出语料、fingerprint、diff、安装安全行为；Playwright 压到 5–8 条真实旅程，跑本地 Worker。
- **新增**：domain 单测；D1 migration + 查询集成（workerd）；API 契约测试（P0 录制样本）；迁移对账；D1 rows read/write 预算。
- 统一 `pnpm test` / `pnpm test:e2e`，不再维护 85 个 script。

---

## 9. 构建与发布

- 单 pnpm workspace、单 lockfile、固定 Node LTS。
- Vite 构 Web；esbuild 构 TH 单文件；Wrangler 构 Worker。产物不提交（客户端 release 产物按发布流程单独处理）。
- 发布：PR 跑 typecheck/test/build/契约；`main` 对精确 SHA 构建一次，上传不可变 artifact；staging 部署同一 artifact，审批后提升生产；发布账本记录 SHA、artifact hash、Worker version、migrations。
- 部署只走 CI，不依赖机器本地 profile；删除全部 PowerShell 部署器。
- 客户端分发：版本化 URL + manifest；不再依赖 `@main`；`test-dist` shim 在下架窗口后删除。

---

## 10. 删除清单

`pages/home/**`、`pages/home.ts`、`/assets/home.js` 等动态资源路由、`contentServiceKey`、`CodeCheckService`（按 CPU 实测）、`caches.default` ×3、客户端 TTL 缓存与 `forceRefresh`、`public_project_counts` 及其 trigger、`admins`/`super_admins`、`project_rank_snapshots`、`project_ranking_days`、`project-ranking-snapshots.ts`、`test-bundles/`、`wrangler.frontend.jsonc`、`utils/auth.ts` KV session、committed `generated/*.txt`、`scripts/deployment/*.ps1`、`sync-staging-from-backup.py`、重复 lockfile、`test-dist` shim（窗口后）。

## 11. 保留清单

中文 FTS 搜索（`project_search`/`_short`/`_tags` 语义，重建索引）、日榜与发现历史、7d/30d 周期排序、互动计数与私人评分、抽签、编辑精选、内容策略与 taxonomy 规则、安装握手与最低版本、不信任客户端的校验姿态、下载计数口径。

---

## 12. 冲突裁决（A vs B）

| 争议 | A（DeepSeek） | B（GPT-6.1） | 定稿 | 理由 |
|---|---|---|---|---|
| 动态 API 缓存 | 边缘 `s-maxage` + 客户端 TanStack Query | 首版全不缓存 | **分两步**（§6） | A 没启用 Workers Cache，头无消费者；B 缺开启路径 |
| 中文搜索 | 删 FTS 改 `LIKE` | 保留并回归 | **保留 FTS** | `LIKE '%x%'` 不走索引，1–2 字搜索会退化 |
| 排行表 | 大量删除 | 保留行为、只删死表 | **保留活表，删死表** | 复核确认 `project_rank_snapshots`/`ranking_days` 只被死模块引用 |
| 发布回滚 | 写反向回放脚本 | 写后不回旧库 | **B**；反向回放列为可选前置 | 反向回放成本高，不能默认承诺 |
| 迁移映射 | 逐表映射 + 分组算法 | 流程/校验 + 异常清单 | **A 的映射 + B 的校验** | 互补 |
| 鉴权 | Origin 白名单 + flow | opaque session + 角色读库 | **合并** | A 的劫持链 + B 的撤销模型 |
| DO | 付费后可删，超时再加回 | 付费后可删 | **一致**，加实测门槛 | 不能凭名字判断 |
| 产物 | 客户端 dist 保留提交 | 全走 CI artifact | **B**，客户端 release 例外 | 分发通道需要稳定 URL |
| 仓库树 | `apps/{worker,web,client}` + 4 包 | `apps/{worker,web,tavern-client}` + 2 包 | **B 的骨架 + `domain` 包** | worker 内分层足够，独立 db 包会逼出通用仓储 |

---

## 13. 待确认

1. Workers 套餐：Free（10ms CPU）还是 Paid（30s）。决定 DO 去留与服务端 checker 是否能保留。
2. `visibility=0` 的产品含义：按迁移默认 `unlisted`，是否接受。
3. 公开详情是否允许匿名看到完整可安装内容；默认只给摘要 + 条目索引，完整文件要登录。
4. 订阅计数是否继续公开；默认保留。
5. 客户端导入 URL 是否允许变更；默认不变，`test-dist` 保留一个下架窗口。

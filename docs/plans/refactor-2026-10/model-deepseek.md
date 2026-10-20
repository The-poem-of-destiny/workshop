# 创意工坊重构计划（独立方案）

> 范围：`workshop` 仓库的客户端脚本、Cloudflare Worker、D1/R2 数据与测试/发布体系。
> 本文件只设计后端、仓库边界与迁移；React + Tailwind + shadcn/ui + Vite 的具体页面不在本文设计范围内，但它是切换的前置依赖。
> 证据路径均相对仓库根 `workshop/`。文中行号以当前工作区文件为准。

## 0. 结论

这不是一次“整理目录”。当前系统的核心问题是：

1. **OAuth 登录可被任意站点劫持**。`/api/auth/login` 直接信任请求头 `Origin`，回调页把 7 天有效的 JWT 通过 `postMessage` 发给这个 Origin；同时 CORS 是 `*`。任何站点都能发起登录并拿到受害者的 token，管理员账号同样受影响。
2. **“项目”同时是身份、发布版本、草稿、审核快照和统计计数器**。发布一次更新要复制一整组项目行、在 R2 里手工做“事务”、失败再回滚，最后删除草稿行。这是当前最大的数据一致性风险。
3. **浏览器 UI 是 15k 行塞在 TypeScript 字符串里的 JavaScript**。没有类型、没有组件边界，唯一的语法检查是 `new Function()`；它无法渐进重构，也是后续 React 化的最大障碍。
4. **测试数量很多，但信号很弱**。74 个 node 脚本中大量断言源码正则，CI 只跑其中 9 个；10 个 Playwright 用例默认打线上 staging。真正能防止回归的集成测试几乎没有。
5. **围绕一个不存在的规模问题做了过多缓存、排序、搜索和部署机械**。三套 `caches.default`、客户端手写缓存、两套 FTS、已死的 ranking 表、877 行 staging 同步脚本、688 行未启用的 PowerShell 部署器。

目标不是保留这些结构，而是用一套 boring 的设计替掉：**一个 Worker + 一套 Hono 路由 + 一个规范化 D1 schema + 不可变 revision + 单一 pnpm workspace + 真实集成测试**。

---

## 1. 诊断

### 1.1 数字核对（先纠正任务描述中的偏差）

| 项目 | 实测 | 证据 |
|---|---|---|
| OpenAPI 路由 | **50** 条 | `cloudflare/src/index.ts:221-336` |
| 手写 Hono 路由 | **7** 条（不是 3 条）：`/assets/home.js`、两个 checker、notices、`/`、`/api/files/*`、staging rebuild | `cloudflare/src/index.ts:188-217,269,339` |
| D1 migrations | **36** 个（`0001`–`0036`，不是 17） | `cloudflare/migrations/` |
| node 测试脚本 | **74** 个 | `cloudflare/tests/*.mjs` |
| Playwright spec | **10** 个 | `tests/e2e/*.spec.mjs` |
| 提交进仓库的 checker 产物 | 921.7 KB | `cloudflare/src/generated/upload-checker.txt` 461.9 KB + `review-checker.txt` 459.8 KB |
| 客户端产物 | 2 × 276.9 KB + source map | `dist/CreativeWorkshop/index.js`、`dist/CreativeWorkshop-staging/index.js` |
| 历史 bundle | 1.31 MB，无任何引用 | `test-bundles/`（全仓库无 `test-bundles` 引用） |

`schema.sql` 是 618 行的手工基线，`migrations/` 是另一套演进历史；两者没有一致性测试，已经出现只存在于 schema 的死表（`project_rank_snapshots`、`project_ranking_days`、`admins`）。

### 1.2 P0：必须先处理

#### P0-1 OAuth 登录劫持（安全，账户接管）

证据链：

- `cloudflare/src/endpoints/auth.ts:139`：`const origin = c.req.header('origin') || ...`，没有允许列表。
- `cloudflare/src/index.ts:127-130`：所有响应 `Access-Control-Allow-Origin: *`，攻击者可以跨站读取 `/api/auth/login` 返回的 `{url, state}`。
- `cloudflare/src/endpoints/auth.ts:338-364`：回调把 `token` 写进 KV，并渲染进成功页 HTML。
- `cloudflare/src/endpoints/auth.ts:73-74`：成功页把 token `postMessage(payload, allowedOrigin)`，`allowedOrigin` 就是攻击者传进来的 Origin。
- `cloudflare/src/endpoints/auth.ts:212-213`：`/api/auth/poll?key=<state>` 仅凭 state 返回 token；攻击者自己生成的 state 当然知道。
- `cloudflare/src/utils/jwt.ts:93`：token 默认 7 天；`isAdmin`/`isSuperAdmin` 是签发时的快照，撤销管理员后旧 token 仍然有效（`cloudflare/src/endpoints/admin.ts:865` 只改 D1）。

攻击路径：攻击者页面 `fetch('/api/auth/login')`（CORS 允许读响应）→ 拿到 state 与 Discord 授权 URL → 诱导受害者打开并授权 → 回调把 token 发给攻击者 Origin；或直接轮询 state。**无需受害者安装任何东西。**

同时存在登录 CSRF 与 token 泄漏面：token 出现在 HTML、`postMessage`、KV 三处；登出是空操作（`auth.ts:451-468`）。

#### P0-2 项目/草稿/审核快照共用一张表（数据一致性）

`projects` 同时承载 `published_project_id`、`draft_project_id`、`root_project_id`、`review_target`、`draft_revision`、`content_mutation_token`、`is_published`、`status`、统计计数和审核证据（`cloudflare/schema.sql:24-90`）。

由此产生的机械：

- 任何编辑都要先 `createDraftFromPublished`，函数 150 行，包含 30 多个 `updates.x !== undefined ? ...` 分支和最多 3 次重试（`cloudflare/src/utils/db.ts:1467-1617`）。
- 上传、封面上传、正则上传、删除条目、项目更新各自重复一遍“如果已发布就创建草稿”的分支（`cloudflare/src/endpoints/projects/write.ts:441`、`assets.ts:285,380,504,561`）。
- 审核通过时要更新 published 行、复制 R2、删除 draft 行（`cloudflare/src/endpoints/admin.ts:530-690`）。
- 审核队列用 `latestSubmittedReviewCondition` 这种相关子查询判断“哪条 draft 才是最新的”（`cloudflare/src/utils/db.ts:43-55`），还要两个清理操作（`db.ts:1154-1224`）。
- 删除一个已发布项目时，要级联查找并删除所有 draft 行（`write.ts:498-520`、`db.ts:762-787`）。

这套状态机没有数据库层面的唯一约束保证“一个项目最多一个已发布版本、一个草稿、一个待审快照”，只能靠应用代码和乐观锁拼出来。

#### P0-3 R2 发布“事务”不可靠且会泄漏

`copyProjectFilesToPublished` 把所有目标对象读入内存做备份，再逐个 `put`，失败时逐个回滚（`cloudflare/src/utils/r2.ts:127-283`，备份 `:216`，回滚 `:237`）。单个项目允许 10 MB worldbook + regex + 封面（`cloudflare/src/config/runtime-limits.ts:2`），一次发布可能同时持有两份几十 MB 的 `ArrayBuffer`；Workers 内存上限 128 MB。

更严重的是：审核通过后 `projectDb.delete(c, projectId)`（`admin.ts:690`）只删 D1 行（`db.ts:762-787`），没有删草稿的 R2 对象。每次更新都会留下 `projects/{draftId}/...` 的孤儿文件，且没有清理任务。

#### P0-4 测试无法作为重构安全网

- 74 个 node 脚本，`cloudflare/package.json:89` 的 `check:home` 只串了 9 个；`.github/workflows/cloudflare-checks.yaml:50` 只跑 `check:home`。其余 60 多个脚本在 CI 中从不执行。
- 大量测试直接读源码字符串：`cloudflare/tests/home-js-smoke.mjs` 76.2 KB，`assert.match(fragments.homeModalsScript, /宝宝们，记得按上面的步骤更新脚本～知道了吗？/)` 这种断言只能证明“文案还在源码里”，不能证明行为；`project-list-client-cache-smoke.mjs:6-22`、`public-project-list-cache-smoke.mjs:15-75`、`home-asset-cache-smoke.mjs:8-27` 都是同类。
- 部分“集成测试”依赖手工启动的本地服务（`cover-approval-isolation.mjs:7` 固定 `127.0.0.1:8791`），CI 不启动它。
- Playwright 默认 `baseURL` 是线上 staging（`playwright.config.mjs:10`），不是本地 Worker；用例依赖真实账号、真实 DLC、真实浏览器 profile（`scripts/setup-st-test-profile.mjs`），不可重复。
- 为死代码保留测试：`project-ranking-snapshot-smoke.mjs:13` 是唯一导入 `src/utils/project-ranking-snapshots.ts` 的地方。

#### P0-5 UI 以字符串形式存在，无法维护/无法 React 化

`cloudflare/src/pages/home/app.ts:30-70` 把 18 个 `String.raw` 片段拼成一个 IIFE；`cloudflare/src/pages/home.ts:39` 原样返回。片段内部的 `state`、`renderApp`、`apiFetch` 全靠全局作用域约定。

- 没有模块系统、没有类型检查；`check-home-js.mjs` 只是 `fetch('http://127.0.0.1:8790/assets/home.js')` 后 `new Function(code)`（`cloudflare/scripts/check-home-js.mjs:1-10`）。
- 样式 4,527 行（`styles.ts` 2,703 行 + `shell-styles.ts` 1,824 行），与 DOM 字符串强耦合。
- 浏览器端还维护 `projectDetailCache`、`projectDetailGeneration`、`projectDetailInFlight`、`projectListClientCache` 四套缓存（`cloudflare/src/pages/home/api.ts:217-300`），与 Worker 缓存叠加。

React 重建不能在这些字符串上做增量迁移；只能以 final contract 重写。

### 1.3 P1：结构性债务

#### P1-1 路由表被复制了一份到 Durable Object 分发器

`contentServiceKey` 用正则重新描述了 Hono 路由（`cloudflare/src/index.ts:358-368`），再把整个 `Request` 交给 DO，DO 内部又调用 `app.fetch(request, this.env)`（`index.ts:370-378`）。任何新增/改名路由都必须同步改两处；还会遇到 workerd 的请求体排空问题（`index.ts:375-377` 的注释）。这层存在的原因只是“网关 10 ms CPU 预算”（`index.ts:355-357`），不是业务需要。

#### P1-2 缓存有四层，且语义互相打架

- Worker 层 `caches.default`：公共列表（`endpoints/projects/read.ts:144-208`）、编辑精选（`endpoints/recommendations.ts:68-125`）、Banner（`utils/site-settings.ts:53-91`）。
- `Cache-Control` 中间件按 5 条路径正则分支（`index.ts:151-176`），其中列表又被设为 `private, no-store`，实际共享缓存只靠 `caches.default`。
- 公共列表先缓存 viewer-neutral 响应（`read.ts:185`），读出后再叠加 `userLiked`（`read.ts:156-173`）；编辑精选缓存后再按 50 个一批查 `userLiked`（`recommendations.ts:47-60`）。
- 客户端再维护 15 秒 fresh / 60 秒 stale 的列表缓存（`api.ts:217-218`），并在每个写操作后手工 `clearProjectListClientCache()`（`tests/project-list-client-cache-smoke.mjs:33-49` 在断言这些调用存在）。
- Banner 用 `site_settings` 的 revision 失效，但图片 key 是 `Date.now()`（`endpoints/site-settings.ts:85`），旧图读取有缓存窗口。

这不是“多层缓存”，是四种各自为政的失效策略。正确做法是：**公共 GET 用 HTTP 缓存头，viewer 状态不进公共缓存，客户端用 TanStack Query 管理请求缓存，删掉所有 `caches.default` 和手写 Map。**

#### P1-3 已死/半死的功能与字段

| 对象 | 现状 | 证据 |
|---|---|---|
| `project-ranking-snapshots.ts` + `project_rank_snapshots` + `project_ranking_days` | 生产代码零引用，仅测试导入 | `cloudflare/src/utils/project-ranking-snapshots.ts:1-149`；`tests/project-ranking-snapshot-smoke.mjs:13` |
| `rating` 排序 | 直接退化成 likes 排序；`rating_rank` 从来不写 | `utils/db.ts:966-969`、`project-daily-rankings.ts:279-286` |
| 订阅计数 | 列表永远返回 0 / false | `utils/db.ts:1763-1766,1877` |
| 评分 | 只写不读，明确“不向作者或公众显示” | `endpoints/projects/read.ts:413-420`、`endpoints/projects/social.ts:55-65` |
| `ADMIN_ROLE_IDS`、`ADMIN_LOG_KV` | 只声明，无读取 | `cloudflare/src/env.ts:17,21` |
| `session` 工具 | 无调用方 | `cloudflare/src/utils/auth.ts:263-360` |
| `getContentType` / `contentTypeMap` | 无调用方 | `cloudflare/src/utils/r2.ts:288-341` |
| `types.ts` 的 `ProjectCreateRequest` 等 | 无引用，与端点的 zod schema 重复 | `cloudflare/src/types.ts:180-272` |
| `admins` 旧表 | 注释自己承认已废弃 | `cloudflare/schema.sql:483-490` |
| `test-bundles/` | 无引用 | 全仓库检索无结果 |
| `styles` 重复 | `styles.ts` 与 `shell-styles.ts` 有重复覆盖 | `pages/home/styles.ts`、`shell-styles.ts` |

#### P1-4 搜索被做成了一台小型数据库引擎

`project_search`（trigram FTS）+ `project_search_short`（递归 CTE 逐字拆分的 FTS）+ `project_search_tags` + 4 个触发器（`schema.sql:494-618`）。查询侧再按 1–2 字/3+ 字/标签选择不同的 `FROM` 源、`INDEXED BY` 提示和 period 排序的 join（`utils/db.ts:897-1009`）。

对当前体量（一个社区工坊，公开项目数量以百/千计）这是负收益：触发器难迁移、短搜索索引膨胀、查询计划脆弱。

#### P1-5 `db.ts` 是 1,916 行的动态 SQL 拼接器

`utils/db.ts` 同时负责用户、项目、列表、排名、审核、互动、审计、下载计数；`list()` 一个函数 280 行，内部动态拼 `FROM`、`ORDER BY`、`INDEXED BY`、`json_each` 快照 join（`db.ts:835-1110`）。D1 的成本和锁行为被这类查询放大，也让任何 schema 改动都变成全局搜索。

#### P1-6 配置/环境边界重复且不可验证

- 私有/本地预览判断重复 4 次：`index.ts:106-127`、`endpoints/auth.ts:8-18`、`endpoints/site-settings.ts:11-19`、`utils/db.ts:1726-1738`。
- `wrangler.frontend.jsonc` 缺少 DO/R2 真实绑定（`cloudflare/wrangler.frontend.jsonc:14-28`），不能独立部署。
- 部署器 688 行 PowerShell（`scripts/deployment/deploy-worker.ps1`），依赖机器本地 `profiles/`（`:28`），硬编码 `upstream/main` 祖先校验（`:310,378-380`），README 自己标注“candidate implementation, not activated”（`scripts/deployment/README.md:3`）。
- Staging 数据同步是 877 行 Python + 权重预算（`cloudflare/scripts/sync-staging-from-backup.py`、`staging-sync.policy.json`），本质上是在手工模拟一个 staging 数据环境。

#### P1-7 构建产物与包管理器

- `dist/`（2 份 bundle + 2 份 map）、`test-bundles/`、`test-dist/`、`cloudflare/src/generated/*.txt` 全部提交。
- 根用 pnpm + webpack，`cloudflare/` 用 npm（两套 lockfile：`pnpm-lock.yaml`、`cloudflare/package-lock.json`）。
- 客户端跨包直接 import Worker 源码：`src/CreativeWorkshop/services/project-fetch.ts:2`、`regex.ts:19`、`worldbook.ts:11` 引用 `cloudflare/src/utils/*`。
- CI 的 bundle workflow 只构建不校验产物内容；`check:workshop-bundles` 靠正则匹配 bundle 里的版本字符串（`scripts/check-workshop-bundles.mjs:13-26`）。

### 1.4 P2：可接受但应顺手清理

- 手写 JWT/HMAC（`utils/jwt.ts:1-185`）没有 `iss`/`aud`/`jti`，应换 `jose` 或直接用不透明 session token。
- `project-daily-rankings.ts` 的构建令牌/状态机（`claimRankingBuild`、`build_token`、`published` 二次校验，`project-daily-rankings.ts:160-330`）对一个“每 6 小时选 10 个项目”的需求过重。
- `read.ts:320` 的 `compareProjectVersions(row.version, row.version) !== 0` 永远为 false，是一段死条件。
- `readProjectPreview` 在 `ProjectFetch` 里被展开两次（`read.ts:585-605`），同一份 preview 同时放在 `project` 内和顶层。
- `ProjectList` 的 `hasMore` 用 `page < 19` 硬编码（`read.ts:195`），与 `pageSize` 无关。
- `wrangler.jsonc` 开启 observability 但采样 0.1（`cloudflare/wrangler.jsonc:6-14`），错误日志也会被采样掉。

### 1.5 明确删除清单

| 路径/对象 | 处置 | 替代 |
|---|---|---|
| `cloudflare/src/pages/home/**`（约 15k 行 UI 字符串） | 删除 | `apps/web`（React，另立项） |
| `cloudflare/src/pages/home.ts`、`pages/home/{styles,shell-styles}.ts` | 删除 | Vite/Tailwind |
| `/assets/home.js`、`/assets/upload-checker.js`、`/assets/review-checker.js`、notices 路由 | 删除 | 静态资源 + 服务端校验 |
| `contentServiceKey`、`CodeCheckService`、DO 绑定/迁移 | 删除（见 2.3 条件） | Workers Paid 的 CPU 预算；必要时只保留一个显式的 `ContentService` |
| `utils/project-ranking-snapshots.ts` | 删除 | `featured_picks` + cron |
| 表 `project_rank_snapshots`、`project_ranking_days`、`project_ranking_builds`、`project_daily_rankings`、`discovery_feature_history` | 删除 | `featured_picks` |
| 表 `project_period_popularity`、`project_period_tracking_meta` | 删除 | `project_metric_daily` + `projects.*_7d/30d` 列 |
| `project_search`、`project_search_short`、`project_search_tags`、`project_search_short_source` 及 4 个触发器 | 删除 | `projects.search_text` + `LIKE`，标签走 `project_tags` |
| `admins`、`super_admins` | 删除 | `users.role` + `ADMIN_DISCORD_IDS` 引导 |
| `caches.default` 三处 | 删除 | HTTP `Cache-Control` + TanStack Query |
| 客户端 `projectListClientCache`/`projectDetailCache`/generation/in-flight | 删除 | TanStack Query |
| `test-bundles/` | 删除 | 无 |
| `test-dist/` 兼容 shim | 保留一个发布周期后删除 | 客户端路径迁移完成即可 |
| 74 个源码正则测试中的约 45 个 | 删除/改写 | 见第 4 节 |
| `cloudflare/scripts/check-d1-cost.mjs`（25 KB SQL 字符串分析） | 删除 | 集成测试里的查询次数断言 |
| `cloudflare/scripts/sync-staging-from-backup.py` + 测试 | 删除 | 脱敏 fixture + `db:seed` |
| `scripts/deployment/*.ps1` | 删除 | GitHub Actions + `wrangler deploy` |
| `ADMIN_ROLE_IDS`、`ADMIN_LOG_KV`、`session` 工具、`getContentType`、`types.ts` 请求 schema | 删除 | — |
| `dist/` 的常规提交 | 改为 release workflow 唯一产物 | 见第 5 节 |

---

## 2. 目标架构

### 2.1 仓库树

```text
workshop/
├─ pnpm-workspace.yaml
├─ package.json                    # 只放脚本与共享 devDeps
├─ config/
│  └─ workshop.json                # 构建期清单：版本、分发路径、端点、允许 Origin
├─ apps/
│  ├─ worker/
│  │  ├─ src/
│  │  │  ├─ index.ts               # 只做绑定与路由挂载
│  │  │  ├─ middleware/            # auth, origin, error, cache
│  │  │  ├─ routes/                # auth, home, projects, revisions, files, admin, references, me
│  │  │  ├─ services/              # 用例/状态机
│  │  │  ├─ repositories/          # SQL 只在这里
│  │  │  └─ lib/                   # ids, time, json, http
│  │  ├─ migrations/               # 唯一 schema 事实来源
│  │  ├─ test/                     # vitest-pool-workers 集成测试
│  │  ├─ wrangler.jsonc
│  │  └─ wrangler.staging.jsonc
│  ├─ web/                         # React + Vite（另立项，此处只定义边界）
│  │  ├─ src/api/                  # 由 contracts 生成的 typed client
│  │  ├─ src/features/
│  │  └─ vite.config.ts
│  └─ client/
│     └─ src/CreativeWorkshop/     # Tavern Helper 客户端（从根 src/ 迁入）
├─ packages/
│  ├─ contracts/                   # zod schema、错误码、路由元数据
│  ├─ content/                     # worldbook/regex 解析、preview、diff、版本比较
│  ├─ checker/                     # EJS/Regex 规则引擎（纯 ESM）
│  └─ config/                      # taxonomy、content policy、limits
├─ tests/
│  ├─ e2e/                         # 本地 Worker 的 Playwright
│  ├─ migration/                   # 旧库 fixture → 新库
│  └─ fixtures/
└─ scripts/
   ├─ release-client.mjs
   └─ migrate-data.ts
```

**不再有**：`cloudflare/` 顶层目录、根 `src/`、`util/`、`test-dist/`、`test-bundles/`、仓库内 `dist/`（客户端发布产物除外）。

### 2.2 包边界与依赖规则

| 包 | 可以依赖 | 禁止 |
|---|---|---|
| `packages/contracts` | `zod` | Worker、DOM、Node API |
| `packages/content` | 无 | Worker、DOM、D1/R2 |
| `packages/checker` | `acorn`、`parse5`、`entities` | Worker、DOM、D1/R2、`packages/content` 的运行时状态 |
| `packages/config` | 无 | Worker、DOM |
| `apps/worker` | 以上全部 | `apps/web`、`apps/client` |
| `apps/web` | `contracts`、UI 库 | Worker 源码、`content`/`checker` 的服务端实现 |
| `apps/client` | `content`、`config`、`contracts` | Worker、`apps/web` |

用 `dependency-cruiser` 在 CI 里强制这些规则；跨包 import 只能走包名，禁止 `../../../cloudflare/src/...`（当前存在，见 `src/CreativeWorkshop/services/project-fetch.ts:2`）。

### 2.3 运行时拓扑

```text
Browser (React)  ── fetch /api/v1/* ──┐
Tavern iframe    ── postMessage ──┐   │
                                  ▼   ▼
                         Worker "workshop"
                         ├─ Static Assets (apps/web/dist)
                         ├─ Hono API (/api/v1)
                         ├─ R2 files (/files/*)
                         └─ Cron (featured + stats)
                                  │
                         D1 "workshop"   R2 "workshop-files"
```

- **一个 Worker**。静态资源用 Workers Static Assets 绑定 `ASSETS`，`run_worker_first = ["/api/*", "/files/*"]`，其余交给 SPA fallback。这样 `/`、`/assets/*` 不再由 Worker 动态生成。
- **删除 Durable Object**，前提是账号在 Workers Paid（30 s CPU）。上传 preflight/审核时同步执行 checker；10 MB JSON 的解析在 30 s 内。若实测 p99 超过 20 s，再把 **一个** `ContentService` DO 加回来，路由前缀固定为 `/api/v1/content/*`，由 Hono 直接 `getByName(projectId)`，不再用正则分发器。
- **删除 KV**。OAuth attempt、session 全部落 D1；D1 的读写成本和额度对这个量级完全够用，且可审计。
- **Cron**：
  - `0 2,8,14,20 * * *`：生成 10 个 featured picks（写 `featured_picks`），保留 28 个 rotation。
  - `10 20 * * *`：重算 `downloads_7d/30d`、`likes_7d/30d`，清理旧 revision（R2+D1）。
- **环境**：`production` 与 `staging` 是两个 Wrangler environment（不同 Worker 名、不同 D1/R2 绑定），共用同一份代码；不再依赖机器本地 profile。

### 2.4 数据模型

原则：

1. **项目 = 身份**；**revision = 不可变内容快照**；**发布 = 指针切换**。
2. 文件 key 含 revision id，审核通过不复制文件。
3. 所有时间用整数 epoch ms，避免 ISO 字符串比较和时区问题。
4. 标签规范化，JSON 只用于展示字段。
5. 不再用触发器维护计数/搜索；状态变更在一个 `db.batch` 里完成。
6. `projects` 上只对“已发布元数据”做少量反规范化（`project_type`、`search_text`），让列表/筛选/搜索不必每次 join revision；revision 仍是唯一历史事实来源。

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  display_name  TEXT,
  avatar        TEXT,
  role          TEXT NOT NULL DEFAULT 'user'
                CHECK (role IN ('user','admin','superadmin')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,          -- HMAC-SHA256(SESSION_PEPPER, token)
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE auth_attempts (
  state         TEXT PRIMARY KEY,          -- 32B random, base64url
  origin        TEXT NOT NULL,
  status        TEXT NOT NULL,             -- pending | ready | error
  login_code    TEXT,                      -- 一次性换取 session 的短码
  error_message TEXT,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  used_at       INTEGER
);

CREATE TABLE projects (
  id                    TEXT PRIMARY KEY,  -- 保持旧 ID，安装记录不失效
  author_id             TEXT NOT NULL REFERENCES users(id),
  project_type          TEXT NOT NULL,     -- 反规范化：已发布 revision 的类型
  extension_type        TEXT,              -- 反规范化
  search_text           TEXT NOT NULL DEFAULT '',
  visibility            INTEGER NOT NULL DEFAULT 1,
  published_revision_id TEXT,
  likes_count           INTEGER NOT NULL DEFAULT 0,
  downloads_count       INTEGER NOT NULL DEFAULT 0,
  downloads_7d          INTEGER NOT NULL DEFAULT 0,
  downloads_30d         INTEGER NOT NULL DEFAULT 0,
  likes_7d              INTEGER NOT NULL DEFAULT 0,
  likes_30d             INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  published_at          INTEGER
);
CREATE INDEX idx_projects_public_created ON projects(published_at DESC, id DESC)
  WHERE published_revision_id IS NOT NULL AND visibility = 1;
CREATE INDEX idx_projects_public_likes ON projects(likes_count DESC, published_at DESC)
  WHERE published_revision_id IS NOT NULL AND visibility = 1;
CREATE INDEX idx_projects_public_downloads ON projects(downloads_count DESC, published_at DESC)
  WHERE published_revision_id IS NOT NULL AND visibility = 1;
CREATE INDEX idx_projects_public_7d ON projects(downloads_7d DESC, published_at DESC)
  WHERE published_revision_id IS NOT NULL AND visibility = 1;
CREATE INDEX idx_projects_public_30d ON projects(downloads_30d DESC, published_at DESC)
  WHERE published_revision_id IS NOT NULL AND visibility = 1;
CREATE INDEX idx_projects_public_type ON projects(project_type, published_at DESC)
  WHERE published_revision_id IS NOT NULL AND visibility = 1;

CREATE TABLE project_revisions (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_no     INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('draft','pending','approved','rejected')),
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  precautions     TEXT,
  discord_thread_url TEXT,
  project_type    TEXT NOT NULL,
  extension_type  TEXT,
  facets          TEXT NOT NULL DEFAULT '{}',
  custom_tags     TEXT NOT NULL DEFAULT '[]',
  display_tags    TEXT NOT NULL DEFAULT '[]',
  version         TEXT NOT NULL,
  version_label   TEXT,
  worldbook_key   TEXT,
  regex_key       TEXT,
  cover_key       TEXT,
  worldbook_sha256 TEXT,
  regex_sha256    TEXT,
  size_bytes      INTEGER,
  has_ejs         INTEGER NOT NULL DEFAULT 0,
  has_character_artwork INTEGER NOT NULL DEFAULT 0,
  check_report    TEXT,                    -- 服务端 checker 的 JSON 报告
  reject_reason   TEXT,
  submitted_at    INTEGER,
  reviewed_at     INTEGER,
  reviewer_id     TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (project_id, revision_no)
);
CREATE INDEX idx_revisions_project ON project_revisions(project_id, revision_no DESC);
CREATE INDEX idx_revisions_pending ON project_revisions(submitted_at ASC)
  WHERE status = 'pending';

CREATE TABLE project_tags (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('type','extension','facet','custom','display')),
  PRIMARY KEY (project_id, tag)
);
CREATE INDEX idx_project_tags_tag ON project_tags(tag, project_id);

CREATE TABLE project_likes (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_likes_user ON project_likes(user_id);

CREATE TABLE project_subscriptions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_subscriptions_user ON project_subscriptions(user_id);

CREATE TABLE private_ratings (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE project_metric_daily (
  day        TEXT NOT NULL,                -- YYYY-MM-DD (UTC)
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  downloads  INTEGER NOT NULL DEFAULT 0,
  likes_delta INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, project_id)
);
CREATE INDEX idx_metric_day ON project_metric_daily(day);

CREATE TABLE featured_picks (
  rotation_key TEXT NOT NULL,              -- YYYY-MM-DDTHH
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_type TEXT NOT NULL,
  rank         INTEGER NOT NULL,
  type_rank    INTEGER NOT NULL,
  PRIMARY KEY (rotation_key, project_id),
  UNIQUE (rotation_key, rank),
  UNIQUE (rotation_key, project_type, type_rank)
);

CREATE TABLE editor_picks (
  project_id   TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  curator_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment      TEXT NOT NULL DEFAULT '',
  reaction_label TEXT NOT NULL DEFAULT '',
  updated_at   INTEGER NOT NULL
);

CREATE TABLE character_references (...);        -- 结构基本沿用现有表
CREATE TABLE character_reference_versions (...);
CREATE TABLE character_reference_items (...);

CREATE TABLE project_compatibility (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  character_reference_id TEXT,
  built_for_version_id TEXT,
  tested_through_version_id TEXT,
  status TEXT,
  known_incompatible INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  grace_until INTEGER,
  updated_at INTEGER
);

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT,
  detail      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

CREATE TABLE rate_limits (
  bucket       TEXT PRIMARY KEY,           -- e.g. like:user:2026-10-20
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE daily_random_draw_state (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  draw_day          TEXT NOT NULL,
  daily_count       INTEGER NOT NULL DEFAULT 0,
  recent_project_ids TEXT NOT NULL DEFAULT '[]',
  updated_at        INTEGER NOT NULL
);
```

关键点：

- `project_revisions` 不参与点赞/统计；审核队列直接查 revision。`projects.published_revision_id` 指向唯一已发布快照，任何“项目列表”join 它即可。
- 审批通过 = 一条 `UPDATE projects SET published_revision_id = ?` + 一条 `UPDATE project_revisions SET status='approved'`，放在同一个 `db.batch`。没有文件复制。
- 作者编辑 = 创建/复用 `status='draft'` 的 revision；提交 = `status='pending'` + `submitted_at`。不再创建第二行 project。
- `project_tags` 在 revision 审批通过时重建；同一 tag 同时属于 facet/custom 时只保留一行，`kind` 取优先级 `type > extension > facet > custom > display`。`projects.search_text` 同步为 `lower(title || ' ' || 作者显示名 || ' ' || tags)`。
- 如果未来公开项目超过约 2 万，再加一个 FTS5 表；现在只用 `search_text LIKE '%' || ? || '%'`，覆盖 1 字、2 字和 3+ 字中文。

### 2.5 数据访问

- `repositories/*` 是唯一允许出现 SQL 的地方；路由 handler 只做参数校验、权限判断、调用 service。
- 禁止动态拼接表名/列名。排序列用 `const ORDER_BY = { published: 'published_at DESC, id DESC', ... }` 的显式映射，输入用 zod enum 限定。
- 多语句状态变更统一用 `db.batch()`；不写“先 SELECT 再 UPDATE 再 delete”的手工事务。
- 列表分页改 **cursor**：`?limit=20&cursor=<published_at>:<id>`，返回 `nextCursor`。删除 `page<19` 的硬编码和 OFFSET 翻页（`read.ts:195`、`db.ts:1086`）。
- D1 查询返回的字段在 repository 层映射为 camelCase 领域对象；不再让 `parseProjectRow` 对每行做 JSON.parse 容错（`db.ts:1782-1916`）。写入时 zod 已保证 JSON 合法，读时只解析一次。
- 查询上限：列表 24/页、审核队列 50/页、batch 50/次、version-check 500/次；全部在 contracts 中定义。

### 2.6 配置

保留 `config/workshop.json` 作为**构建期**清单，但补上并收紧：

```jsonc
{
  "client": {
    "stable": "2.3.1",
    "staging": "2.3.0-dev1",
    "stablePath": "dist/CreativeWorkshop/index.js",
    "stagingPath": "dist/CreativeWorkshop-staging/index.js"
  },
  "web": {
    "origins": [
      "https://poemofdestinycreativeworkshop.1528779666.workers.dev",
      "https://workshop-test.uika.cc.cd",
      "http://127.0.0.1:5173",
      "http://localhost:5173"
    ]
  },
  "endpoints": { "production": "...", "staging": "..." },
  "discord": { "guildIds": ["..."] },
  "scriptDependencies": [ ... ]
}
```

- `web.origins` 是 OAuth `Origin` 校验、CORS、postMessage `targetOrigin` 的唯一来源；删除四处手写的私有网段判断。本地开发只允许显式列出的 localhost 端口。
- 运行时 `Env` 只留绑定与 secret：`DB`、`R2_BUCKET`、`ASSETS`、`DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET`、`DISCORD_REDIRECT_URI`、`SESSION_PEPPER`、`ADMIN_DISCORD_IDS`（引导超级管理员）。删除 `ADMIN_ROLE_IDS`、`ADMIN_LOG_KV`、`LOCAL_PREVIEW_FILE_BASE`。
- 产品规则继续在 `packages/config`：taxonomy、content policy、limits。不要在 Worker 和 UI 各写一份；UI 通过 contracts/config 构建期注入只读 JSON，或由 `/api/v1/meta` 返回。

### 2.7 认证、权限、错误模型

**登录流程（目标）**

```text
Web/iframe → GET /api/v1/auth/oauth/start        (Origin 必须命中 web.origins)
           ← { authorizeUrl, state }
           → Discord 授权
           → GET /api/v1/auth/oauth/callback?code&state
              · 校验 state、Origin 绑定、TTL（5 分钟）
              · 校验 Discord guild
              · upsert users（role 保留）
              · 生成一次性 login_code，写 auth_attempts(state → ready)
              · 返回极简 HTML：只向允许的 opener 发 {type:'oauth-ready', state}
           → 前端 POST /api/v1/auth/exchange { state, loginCode }
           ← { token, user }        (token 只出现在 JSON body，不进 URL/HTML)
```

- `Origin` 不在允许列表 → 400；没有 `Origin` 的浏览器导航 → 只允许 `GET`，且必须带已存在的 state。
- `auth_attempts` 5 分钟过期；`login_code` 一次性使用，`exchange` 成功写 `used_at`，但允许同一 state 在 TTL 内重试返回同一个 session（幂等），避免网络失败丢登录。
- token 是 32 字节随机值，D1 只存 `HMAC-SHA256(SESSION_PEPPER, token)`；默认 30 天滑动过期。请求时查 `sessions` → `users.role`，**每次请求读一次 D1**，保证撤销管理员立即生效。若担心成本，可在 Worker 内做 60 秒内存缓存，但不能把 role 写进 token。
- 权限模型：`user` / `admin` / `superadmin`。`admin` 可审核、编辑精选、上传 Banner；`superadmin` 可改他人角色。`ADMIN_DISCORD_IDS` 只用于首次引导，之后以 D1 为准。
- 登出：`POST /api/v1/auth/logout` 删除 session 行。
- CORS：只对 `web.origins` 回显 `Access-Control-Allow-Origin`，不再 `*`；允许 `Authorization`，不启用 `credentials`。
- CSP：`default-src 'self'`；如果 React 需要内联样式，保留 `style-src 'self' 'unsafe-inline'`；去掉 cdnjs/jsdelivr 的字体/图标运行时依赖，改为打包字体或系统字体。图片只允许 Discord CDN、`wsrv.nl`、`self`、`data:`、`blob:`。

**错误模型**

```json
{
  "error": {
    "code": "conflict",
    "message": "草稿已被更新，请刷新后重试",
    "details": { "expectedRevision": 4, "actualRevision": 5 }
  }
}
```

- 所有错误由 `middleware/error.ts` 统一输出；业务抛 `HttpError(status, code, message, details)`。
- zod 校验失败 → 400 `validation`，`details` 为字段路径。
- 401/403/404/409/413/429/500 固定映射；前端只按 `code` 分支，不解析中文文案。
- OpenAPI 响应 schema 与运行时使用同一个 zod schema；不再出现 `AuthCallback` 有时返回 `Response`、有时返回对象的混合类型（`auth.ts:289,364`）。

### 2.8 API 合约

基础路径 `/api/v1`。用 `@hono/zod-openapi` 定义路由与 schema（或 `hono-openapi` + `@scalar/hono-api-reference` 提供 `/api/v1/docs`，生产关闭）。`packages/contracts` 导出所有请求/响应 schema；`apps/web` 用 `openapi-typescript` + `openapi-fetch` 生成 typed client。

**公开/读取**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/home` | Banner、featured picks、editor picks、四个 shelf（最新/更新/下载/点赞），一次返回；替代当前 5 个列表请求（`pages/home/api.ts:163-184`） |
| GET | `/projects` | `q,type,tags,sort,cursor,limit`；sort 仅 `published,updated,downloads,likes,downloads_7d,downloads_30d,likes_7d,likes_30d,discover`。公共响应 viewer-neutral |
| GET | `/projects/:id` | 详情；`?revision=` 仅作者/管理员可用；公共访问只返回 published revision |
| POST | `/projects/batch` | 最多 50 个摘要；保留，供已安装列表 |
| GET | `/projects/:id/release` | 返回 `revisionId, version, files:{worldbook,regex,cover}, sha256, size`；不再返回会过期的代理 URL |
| POST | `/projects/:id/downloads` | 计数 beacon；`{revisionId}`；服务端按用户/日限流，写 `project_metric_daily` |
| PUT/DELETE | `/projects/:id/like` | 幂等设置/取消；返回 `{liked,count}` |
| PUT/DELETE | `/projects/:id/subscription` | 幂等；替代当前 POST/PUT 两个语义不清的路由（`index.ts:253-254`） |
| POST | `/projects/version-check` | 已安装项目批量版本检查 |
| POST | `/projects/random` | 每日随机；返回项目摘要 |
| GET | `/projects/random/state` | 今日次数/最近项目 |
| GET | `/character-references` | 列表 |
| GET | `/character-references/versions/:id/items` | 条目 |
| GET | `/me` | 用户、role、rejected revisions 摘要 |
| GET | `/me/projects` | 作者自己的项目（含草稿/待审/拒绝），按项目聚合 |
| GET | `/me/subscriptions` | 订阅 project ids |
| PUT/DELETE | `/me/ratings/:projectId` | 私有评分；不进入任何公共响应 |

**作者/发布**

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/projects` | 创建项目 + 第一个 draft revision |
| GET | `/projects/:id/revisions/:revisionId` | 编辑器读取，含 preview、diff、check 状态 |
| PATCH | `/projects/:id` | 修改当前 draft 元数据；无 draft 时自动创建 |
| POST | `/projects/:id/revisions` | 从 published 复制生成新 draft（显式“开始更新”） |
| PUT | `/projects/:id/revisions/:revisionId/files/:kind` | `kind=worldbook|regex`，body 为 JSON；一个 handler |
| PUT | `/projects/:id/revisions/:revisionId/files/cover` | multipart 图片；一个 handler |
| DELETE | `/projects/:id/revisions/:revisionId/files/:kind` | 删除/置空 |
| POST | `/projects/:id/revisions/:revisionId/submit` | draft → pending，服务端跑 checker 并持久化报告 |
| POST | `/projects/:id/revisions/:revisionId/withdraw` | pending → draft |
| PATCH | `/projects/:id/visibility` | 公开/隐藏 |
| PATCH | `/projects/:id/compatibility` | 角色卡兼容元数据 |
| DELETE | `/projects/:id` | 删除项目、所有 revision 和 R2 前缀 |

**审核/管理**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/reviews?status=pending&cursor=&type=` | 审核队列；cursor 分页，不再 OFFSET |
| GET | `/admin/reviews/:revisionId` | 详情、diff、checker 输入/报告 |
| POST | `/admin/reviews/:revisionId/approve` | body `{expectedRevision: number}`；原子切换指针 |
| POST | `/admin/reviews/:revisionId/reject` | body `{reason}` |
| GET | `/admin/projects?status=&cursor=` | 全量项目 |
| GET | `/admin/users` | 用户/角色 |
| PATCH | `/admin/users/:id` | `{role}`；仅 superadmin |
| GET | `/admin/audit-log?cursor=` | 统一审计 |
| PUT/DELETE | `/admin/editor-picks/:projectId` | 编辑精选 |
| PUT | `/admin/site/banner` | 位置/缩放 |
| POST | `/admin/site/banner/image` | 图片上传 |
| POST | `/admin/references` | 角色卡引用 |
| POST | `/admin/references/:id/versions` | 版本 + 指纹 |

**明确删除的旧路由/语义**

- `/api/projects/preflight/:kind`：上传前检查并入 `PUT files/:kind` + `POST submit`；本地检查只用于 UX，不签发 attestation。
- `/api/projects/:id/upload`、`/upload-regex`、`/upload-cover`：合并为一个 files 端点。
- `/api/projects/:id/entries/remove`：管理员删除单条内容改为“基于当前 revision 生成一个管理员 revision”，走正常审核/发布，不再原地改写。
- `/api/admin/pending/cleanup`、`/api/admin/projects/recount`：新模型不需要；计数在事务内维护，审核队列按 revision 状态自然过滤。
- `/api/internal/staging/rankings/rebuild`：cron 已覆盖；需要手动重建时用受保护的运维 CLI，不走公网路由。
- `/api/files/*` 通配代理：改为 `/files/{projectId}/revisions/{revisionId}/{kind}`，路径即权限边界。
- `rating` 排序、`subscribes` 排序：删除；私有评分不参与排行。

**为什么不是把 50 条直接砍到 20 条**

项目创建/编辑/上传/审核是真实的多步状态机，硬塞进 2–3 个“万能端点”只会把状态判断塞回 handler。目标是每个资源/动作语义清晰、一个 handler 只做一件事；路由数量不是 KPI。

### 2.9 缓存

| 内容 | 策略 |
|---|---|
| Web 静态资源 | Vite 内容哈希文件名，`Cache-Control: public, max-age=31536000, immutable`；`index.html` `no-cache` |
| `/api/v1/home`、`/projects` 公共列表 | `Cache-Control: public, s-maxage=30, stale-while-revalidate=120`；URL 含全部筛选参数 |
| `/api/v1/projects/:id` 公共详情 | `public, s-maxage=60, stale-while-revalidate=300`；带 `Authorization` 时 `private, no-store` |
| 草稿/审核/`/me/*` | `private, no-store` |
| `/files/.../revisions/:rev/...` 已发布 | `public, max-age=31536000, immutable`（revision 不可变） |
| 草稿文件 | `private, no-store` |
| Banner | 图片 key 内容哈希；JSON `max-age=300, stale-while-revalidate=600` |
| 客户端 | TanStack Query：列表 `staleTime: 30s`，详情 `staleTime: 60s`；mutation 精确 invalidate；删除所有手写 Map |
| Tavern 客户端 | 世界书源缓存按 `projectId + version + downloadUrl` 命中，30 分钟；保留 |

删除 `caches.default` 的三个调用点。Cloudflare 的边缘缓存会尊重 `s-maxage`；如果需要在同一次 `fetch` 内共享，交给边缘，不写应用缓存。

### 2.10 文件与版本

- R2 key：
  - `projects/{projectId}/revisions/{revisionId}/worldbook.json`
  - `projects/{projectId}/revisions/{revisionId}/regex.json`
  - `projects/{projectId}/revisions/{revisionId}/cover.{png|jpg|webp}`
  - `site/banner/{sha256}.{ext}`
- 上传即写 revision 目录；对象不可变。修订新版本 = 新 revision 目录。
- 发布 = `projects.published_revision_id` 指针切换；文件不复制、不备份、不回滚。
- 旧 revision 清理：cron 删除非 published、非最新 draft、超过 90 天的 revision 及其 R2 前缀；保留最近一次 rejected 供作者查看原因。
- 下载计数用 beacon；文件响应可被 CDN 缓存。限制：每用户每天最多计数 N 次，匿名按 IP hash。
- `sha256` 在服务端计算并持久化；`release` 接口返回，客户端安装后可校验。
- 上传限制集中在 `packages/config/limits.ts`：10 MB JSON、8 MB banner、封面 10 MB；返回 413 + 明确文案。

### 2.11 React 边界（不设计 UI）

- `apps/web` 只依赖 `packages/contracts` 和 HTTP；不 import Worker、不读 D1/R2、不拼接服务端 HTML。
- API 客户端由 OpenAPI 生成；所有响应/错误类型来自 contracts。
- 认证：iframe 场景用 `Authorization: Bearer`（token 存 iframe 同源 `localStorage`）；顶层页面也可用同一 token。服务端同时接受 `Authorization`，不依赖第三方 cookie。
- SillyTavern 通信仍走 postMessage bridge；bridge 协议放 `packages/contracts/bridge.ts`，与 HTTP 合约分开版本化。
- 切换门槛：React 应用覆盖当前功能清单（发现/目录/筛选/搜索/排序/详情/安装/更新/修复/上传/编辑/审核/精选/Banner/管理员/我的项目/更新中心/随机/订阅/私有评分），并由本地 E2E 证明。页面设计不在本计划内。

---

## 3. 迁移计划

### 3.1 阶段、验收、回滚

| 阶段 | 工作 | 验收 | 回滚 |
|---|---|---|---|
| P0 基线（3 天） | 导出 prod D1 SQL、R2 对象清单与抽样 SHA；统计每表行数；旧 Worker 加 `READ_ONLY` 开关并只在切换窗口启用 | 导出可被本地 SQLite 打开；抽样文件 hash 可复算；`READ_ONLY` 对 POST/PUT/PATCH/DELETE 返回 503，GET 正常 | 重新部署旧版本；删除开关 |
| P1 骨架（1 周） | pnpm workspace；迁移纯模块到 packages；新 schema/migrations；contracts；依赖边界检查 | `pnpm i && pnpm build && pnpm test` 通过；`dependency-cruiser` 无越界；空库 `d1 migrations apply` 成功 | 新代码只在分支，旧系统不受影响 |
| P2 读路径（1–2 周） | 新 auth/session；home/list/detail/release/files；搜索/筛选/排序；数据迁移 v1 | 新 Worker 在 staging + 新 D1 上返回与旧 API 对同一批项目的等价结果（字段/排序/总数）；OAuth 不再向任意 Origin 发 token | 只影响 staging |
| P3 写路径（2 周） | revision 创建/编辑/上传/提交；审核 approve/reject；删除；审计；计数 beacon | 状态机集成测试全绿；10 MB 上传；并发提交/审核冲突返回 409；approve 后无 R2 复制、无孤儿对象 | 只影响 staging |
| P4 UI 对齐（外部并行） | React 应用按 contracts 实现；不设计视觉 | 功能清单逐项勾选；本地 E2E 覆盖主路径；移动/桌面 smoke | 旧 UI 仍在线 |
| P5 数据迁移 v2（1 周） | 全量迁移 + 两次演练；最终 delta；切换窗口 | 3.2 的对账全部通过；抽样 30 个项目内容 hash 一致；所有 approved 项目可下载 | 旧 D1/R2 未动；`wrangler rollback` |
| P6 切换（1 天） | 维护窗口；旧 Worker 只读；跑 delta；部署新版本；冒烟；观察 24h | 登录/列表/详情/安装/上传/审核/下载全通过；5xx < 0.5% | 回滚旧 Worker version；旧库仍在 |
| P7 清理（1–2 周） | 删除旧 UI/缓存/死表/死测试；删除 `test-bundles`；一个发布周期后删除 `test-dist` shim | `rg` 旧路径零引用；CI 全绿；仓库无生成物（客户端 dist 除外） | 不需要 |

### 3.2 数据迁移映射

迁移脚本 `scripts/migrate-data.ts`：输入旧 D1 导出 SQL（本地 `node:sqlite`）+ R2 对象清单；输出新 D1 SQL + R2 copy manifest + 对账报告。必须可重复执行（`--fresh` 重建，`--delta` 按 `updated_at` 水位增量）。

1. **逻辑项目分组**
   - 若行有 `published_project_id` → 组 key = `published_project_id`。
   - 否则若 `root_project_id` 非空 → 组 key = `root_project_id`。
   - 否则组 key = `id`。
2. **项目选择**
   - `published` = 组内 `is_published=1 AND status='approved'` 的行；正常情况下恰好一条。
   - 若不存在，退回组内任意 `status='approved'` 的行（兼容历史数据）；再不存在则取组内最新一条（`updated_at, id`），项目 `published_revision_id = NULL`，状态由该 revision 决定。
   - **新项目 ID 沿用 published 行 ID（或最新行 ID）**，保证客户端安装记录、书签、Discord 链接不失效。
3. **revision**
   - published 行 → `revision 1`, status `approved`，metadata/文件/`version`/`accepted_code_check` 全部迁入。
   - 当前 `draft_project_id` 行 → `revision 2`, status 由 `status` 映射：`drafting→draft`、`pending→pending`、`rejected→rejected`；若该行没有自己的 R2 文件，则继承 published revision 的 `worldbook_key/regex_key/cover_key` 与 hash。
   - 同组其它 pending/rejected 行：只保留最新一条 rejected（用于作者提示），其它丢弃；报告数量。
   - `review_target='project'` 且 approved 的行作为 published revision。
4. **文件**
   - 旧 key `projects/{oldId}/project-{oldId}.json` → `projects/{projectId}/revisions/{revId}/worldbook.json`
   - `projects/{oldId}/regex-{oldId}.json` → `.../regex.json`
   - `projects/{oldId}/cover.*` → `.../cover.*`
   - 用 R2 S3 `CopyObject`（一次性脚本，具备凭据）或 Worker 流式 copy；逐个校验 SHA-256 与 `file_size`。旧桶不动。
   - 没有文件但 policy 要求内容的项目列入“人工处理”报告，不自动通过。
5. **用户/角色**
   - `users.id/username/global_name/avatar` 迁入；`discriminator`、`guilds` 丢弃（登录时重新校验 guild）。
   - `super_admins` 与 `SUPER_ADMIN_USER_ID` → `role='superadmin'`；`users.is_admin=1` → `role='admin'`；其余 `user`。
   - 冲突（同一人既 super 又 admin）取 superadmin。
6. **互动**
   - `project_likes` → `project_likes`（按新项目 ID 映射）。
   - `project_subscribes` → `project_subscriptions`。
   - `project_ratings` → `private_ratings`。
   - `likes_count` 重新按 `COUNT(*)` 计算；`downloads_count` 保留旧值。
   - `project_metric_daily` 最近 60 天迁入；更早丢弃；迁移后重算 7d/30d。
7. **精选/设置/审计**
   - `devteam_recommendations` join `devteam_curators(enabled=1)` → `editor_picks`；`comment_text`/`reaction_label` 保留；重复 project 取最新 `updated_at`。
   - `site_settings.discover_banner` → Banner JSON；图片 key 按内容 hash 重命名到 `site/banner/`。
   - `admin_action_logs` + `project_metadata_audit_logs` → `audit_log`；`detail` 保留 JSON 原文。
   - `character_references*` 原样迁入（ID 不变）。
   - `daily_random_draw_state` 原样迁入。
   - `project_like_daily_usage`、`download_daily_usage`、`repair_resolve_daily_usage` 只保留当天计数，写入 `rate_limits`，历史丢弃。
8. **不再迁移**
   - `public_project_counts`、`admins`、`super_admins`、所有 `project_search*`、`project_rank_snapshots`、`project_ranking_days`、`project_ranking_builds`、`project_daily_rankings`、`discovery_feature_history`、`project_period_popularity`、`project_period_tracking_meta`。

**对账报告（必须全部为 0 或明确列出）**

- 旧逻辑项目数 = 新 `projects` 数。
- 旧 approved 且 published 的项目数 = 新 `published_revision_id IS NOT NULL` 的项目数。
- 每个新 published revision 的 worldbook/regex SHA-256 = 旧对象 SHA-256。
- 抽样 30 个项目：世界书条目数、正则条目数、标题、作者、类型一致。
- `likes_count` 与 `COUNT(project_likes)` 一致；`downloads_count` 总和一致。
- 每个作者至少能看到自己的所有项目；每个 rejected revision 有 reject_reason。
- 每个 approved 项目满足 content policy（系统核心/角色/事件有 worldbook；扩展有 worldbook 或 regex）。

### 3.3 一次性切换 runbook

1. **T-7 天**：冻结旧 schema；新系统 staging 用全量迁移数据跑通读/写/审核；记录旧 prod 行数与 R2 对象数。
2. **T-1 天**：第二次全量演练；记录耗时、R2 复制量、失败项；准备回滚命令与 on-call。
3. **T-0**：
   - 公告维护窗口（建议 30 分钟，低活跃时段）。
   - 旧 Worker 打开 `READ_ONLY=1`（只读，返回明确 503）；确认写入停止。
   - 运行 `migrate-data --delta`，生成最终对账报告；任何非零差异 → 停止并回滚。
   - 部署新 Worker 版本（同一 Worker 名、新 D1/R2 绑定）；执行迁移后的 D1 migrations（新库已是最新）。
   - 冒烟：OAuth 登录、`/home`、列表筛选/搜索、详情、release 下载、上传 10 MB、提交、审核通过、再次下载、登出。
   - 关闭维护公告，允许写入。
4. **T+24h**：检查 5xx、OAuth 失败率、D1 错误、R2 404、审核队列；确认无孤儿对象。
5. **T+7 天**：旧 Worker version 保留为回滚点；旧 D1/R2 只读保留 90 天，之后归档删除。

### 3.4 回滚

- **切换前**：新系统只在 staging，无风险。
- **切换窗口内**：旧库未被写入（旧 Worker 只读），新库可丢弃；`wrangler rollback` 回旧 version，旧绑定自动恢复。
- **切换后 24h 内**：如果必须回滚，先再次把新 Worker 设为只读，导出新库增量（登录/点赞/审核），用反向脚本回放旧库；然后 `wrangler rollback`。反向脚本只覆盖 `users`、`sessions`（丢弃）、`projects` 指针、`project_likes`、`project_subscriptions`、`private_ratings`、`project_metric_daily`；R2 只回放新上传的 revision 文件到旧草稿目录。**这部分必须在 P5 前写好并演练**，否则回滚只能接受丢失切换后的写入。

---

## 4. 测试策略

### 4.1 保留

| 测试 | 理由 |
|---|---|
| `ejs-*.mjs`（约 20 个：engine/policy/syntax/audit/differential/capabilities/content-binding） | 真正测试解析器和规则行为，是产品核心 |
| `character-reference-fingerprint.mjs`、`character-reference-registry-smoke.mjs` | 指纹/版本匹配是真实业务逻辑 |
| `project-review-diff.mjs` | diff 行为 |
| `project-taxonomy-migration-smoke.mjs`、`project-version-label-migration-smoke.mjs`、`project-inspection-summary-migration-smoke.mjs` | 迁移 SQL 行为（改成统一 migration test） |
| `public-project-counts.mjs` 的 SQL 断言部分 | 用 `node:sqlite` 测真实 SQL，可保留并改到新 schema |
| `external-link-policy-matrix.mjs`、`trusted-media-regression.mjs` | 安全策略矩阵 |
| `creative-workshop-install-safety-smoke.mjs` 中可执行的行为部分 | 安装安全逻辑 |

### 4.2 删除

- 所有 `assert.match(<源码>, /.../)` / `assert.doesNotMatch(<源码>, ...)` 类测试：
  - `home-js-smoke.mjs`（76 KB）、`home-asset-cache-smoke.mjs`、`project-list-client-cache-smoke.mjs`、`public-project-list-cache-smoke.mjs`、`discover-banner-cache-smoke.mjs`、`dlc-kitchen-cache-smoke.mjs`、`project-detail-r2-parallel-smoke.mjs`、`editor-picks-smoke.mjs`、`d1-interaction-guards-smoke.mjs`、`ejs-preflight-gate.mjs` 的源码断言部分、`check-d1-cost.mjs`。
- 死子系统测试：`project-ranking-snapshot-smoke.mjs`、`project-ranking.mjs`、`project-daily-ranking-smoke.mjs`、`project-period-popularity-smoke.mjs`、`project-search-index.mjs`（旧 FTS）。
- 依赖手工本地服务的 `cover-approval-isolation.mjs`、`content-validation-approval.mjs`、`review-snapshot-flow-smoke.mjs`、`admin-review-*`：改写为 vitest 集成测试，不能改写的删除。
- Playwright 中针对旧 DOM/CSS 的 `css-regression.spec.mjs`、`keyboard-regression.spec.mjs`、`issue-regression.spec.mjs` 的字符串断言；新 React UI 用组件测试 + 少量 E2E 替代。
- `check-workshop-config.mjs` 中“禁止某个字面量出现在某个文件”的 80 行源码扫描；保留 manifest 自身的 schema 校验。

### 4.3 新增

1. **合同测试**（`packages/contracts`）
   - 每个 zod schema 的合法/非法样例；错误码枚举；分页 cursor 编解码；bridge 消息版本。
2. **Worker 集成测试**（`@cloudflare/vitest-pool-workers`）
   - 每个测试用真实 D1/R2 binding + migrations + 最小 seed，`SELF.fetch()` 调 API。
   - 必测：OAuth Origin 拒绝/允许、state 过期、exchange 幂等、session 撤销后立即失效、角色变更后立即失效。
   - 项目：创建 → draft → 上传 worldbook → 提交 → 审核通过 → 公开可见 → release 下载；并发 expectedRevision 冲突；reject 后作者可见原因；删除后 R2 前缀为空。
   - 缓存：公共列表无 `Authorization` 时 `s-maxage`，有 `Authorization` 时 `private, no-store`；viewer 状态不进入公共响应。
   - 计数：beacon 只计一次/日/用户；下载计数与 `project_metric_daily` 一致。
   - 搜索：1 字、2 字、3+ 字、标签、类型、空格/`%`/`_` 注入。
3. **迁移测试**（`tests/migration`）
   - 把一份脱敏旧库 SQL fixture 放进仓库（或 CI artifact），跑 `migrate-data`，断言 3.2 的全部对账项。
   - 空库 `migrations apply` 后的 `sqlite_master` 与 `schema.sql`（如果保留）完全一致；目标是不再保留 `schema.sql`，只用 migrations。
4. **E2E（本地）**
   - Playwright `webServer` 启动 `wrangler dev` + `vite preview`；D1/R2 使用 `.wrangler` 临时目录；seed 固定 fixture。
   - 主路径：匿名浏览 → 搜索/筛选 → 登录（mock Discord callback）→ 安装（mock Tavern bridge）→ 创建/上传/提交 → 管理员审核通过 → 更新草稿 → 审核 → 下载。
   - 只在 `main`/发布前跑；PR 跑 1 个 smoke。
5. **可观测性断言**
   - 错误响应包含 `code`；5xx 日志有 request id；OAuth 失败有 reason 但不含 token。

---

## 5. 构建、发布、部署

### 5.1 构建

- **一个包管理器**：pnpm workspace，删除 `cloudflare/package-lock.json`。根脚本：
  - `pnpm dev`（worker + web 并行）
  - `pnpm build`（contracts → checker → client → web → worker dry-run）
  - `pnpm typecheck`、`pnpm lint`（Biome）、`pnpm test`（vitest）、`pnpm test:e2e`
  - `pnpm db:migrate:local`、`pnpm db:seed`
- 客户端用 esbuild（替代 webpack）打 IIFE，`platform: browser`，保留现有 `util/ejs-preflight.html` 作为静态资源；构建产物不再嵌入 Worker。
- Worker 由 Wrangler 打包；checker 作为 `packages/checker` 的纯 ESM 被 Worker 和（可选）浏览器 worker 共同引用。**只保留一份 checker 源码**，删除 `generated/*.txt` 和 `util/ejs-checker-v2.js`。如果仍需浏览器本地检查，由 `apps/web` 或 `apps/client` 构建期打包，不再 base64 塞进 Worker。
- Web 用 Vite；`apps/web/dist` 作为 `ASSETS` 目录，不提交。

### 5.2 发布物

- Worker：Wrangler 版本；不提交 bundle。
- D1：只提交 migrations；`schema.sql` 删除，空库由 migrations 生成。
- 客户端：保留 `dist/CreativeWorkshop/index.js` 和 staging 路径以兼容现有导入 URL。只允许 `release-client.yml` 写入 `dist/`；PR 不允许改 `dist/`。`test-dist` shim 保留到所有已知客户端版本 > 2.1.2，随后删除。
- `test-bundles/` 立即删除。

### 5.3 CI/CD

`.github/workflows/ci.yml`（PR + main）：

1. `pnpm install --frozen-lockfile`
2. `pnpm lint` / `pnpm typecheck`
3. `pnpm test`（contracts + checker + worker integration + migration）
4. `pnpm build`
5. `pnpm test:e2e --grep @smoke`（本地 Worker）
6. `pnpm check:boundaries`、`pnpm check:openapi`（生成的 OpenAPI 与 contracts 无漂移）

`.github/workflows/deploy.yml`（main / tag）：

1. 记录 `github.sha`。
2. `environment: staging`：`wrangler d1 migrations apply`（staging DB）+ `wrangler deploy --env staging` + staging smoke。
3. 手动审批 → `environment: production`：同样步骤，使用 production DB；**不支持从本机直接部署**。
4. job summary 输出 Worker version id、部署的 SHA、迁移列表；部署后用 `wrangler deployments list` 验证 live version。

`.github/workflows/release-client.yml`（tag `client-v*`）：

1. 校验 tag 与 `config/workshop.json` 的 stable 版本一致。
2. `pnpm build:client`，跑 bundle 内容校验（版本、端点、legacy shim）。
3. 提交 `dist/CreativeWorkshop/index.js` 与 map 到 `main`（仅该路径），打 tag。
4. 如果改成 jsDelivr `@tag` 路径，则不再提交 `dist`；但这会改变用户导入 URL，必须单独评估，不做默认。

删除 `scripts/deployment/` 全部 PowerShell、`cloudflare/scripts/sync-staging-from-backup.py`、`staging-sync.policy.json`、`check-d1-cost.mjs`。Staging 数据用 `db:seed` 的固定 fixture（脱敏），需要真实数据回归时用一次性只读导出，不进 CI。

---

## 6. 风险与开放问题

| 风险 | 影响 | 缓解 |
|---|---|---|
| React UI 未完成就切换 | 无可用界面 | 把 UI 功能清单作为切换硬门槛；旧系统保持在线直到 E2E 全绿 |
| 第三方 iframe 存储限制 | 登录态丢失 | 使用 iframe 同源 `localStorage` + Bearer；不依赖第三方 cookie；OAuth 外部浏览器走 D1 attempt 轮询 |
| R2 复制量大/耗时长 | 切换窗口延长 | 提前用 S3 `CopyObject` 在账号内复制；分批 + hash 校验；窗口内只跑 delta |
| 旧库 orphan draft 无法判定 | 丢失待审内容 | 迁移报告单列“无 published 的组”；人工确认后再映射为项目 + pending revision |
| 删除订阅计数/评分排序影响产品 | 用户可见变化 | 订阅保留为“更新提醒”，只是不再显示计数；评分保留为私有反馈；删排序前确认 |
| 1–2 字中文搜索退化 | 搜索体验 | 新方案用 `LIKE` 直接覆盖所有长度；用迁移后的真实标题做回归样本 |
| Workers Paid/CPU 预算 | 服务端 checker 超时 | 先测 10 MB 最坏样本；超过 20 s 再加回单个 ContentService DO |
| 同一 Worker 名切换 + 回滚 | 新旧 DB 绑定 | 用 Cloudflare version rollback；切换窗口内旧库只读；反向脚本只处理窗口后写入 |
| jsDelivr `@main` 缓存 | 客户端更新滞后 | 发布 tag + 版本化 URL；或改用 Worker 分发；不在本文强制改导入 URL |
| CSP 收紧导致字体/图标失效 | 视觉回归 | 字体打包进 Web；图标用 SVG 组件，去 cdnjs |
| 管理员审核流程变化 | 运营中断 | 审核 API 先与旧 UI 并行验证；给管理员一份 1 页操作对照 |
| D1 单库容量/连接 | 增长 | 当前体量足够；预留按 `project_metric_daily` 分区清理；不引入新数据库 |

**需要产品确认的开放问题**

1. 元数据（标题/标签/简介）修改是否必须走审核？当前实现是走草稿审核；新模型默认仍走，但可配置。
2. 订阅是否只保留“更新提醒”，还是需要公开订阅数？建议前者。
3. 私有评分是否保留？保留则只对评分者可见，不参与排序。
4. Discover 的 10 个 featured 是否仍是 6 小时轮换？是否允许管理员置顶覆盖？建议保留轮换 + 管理员 editor picks 独立。
5. 是否接受客户端导入 URL 变更？默认不改。
6. 旧 `rejected` 历史保留多久？建议每个项目保留最近 1 条 rejected，其余 90 天清理。

---

## 7. 我不会改的部分

- **Discord OAuth + 公会准入 + 人工审核**。这是产品边界，不是技术债；只修 Origin/state/token 的实现。
- **Cloudflare 全家桶**：Workers、D1、R2、Static Assets、Cron。不引入 Postgres、KV 替代品、第三方对象存储。
- **Tavern Helper 客户端 + postMessage bridge 的总体形态**。安装/更新/修复/差异/冲突处理都留在这层；只把协议抽到 contracts，修正跨包引用。
- **EJS/Regex 检查器的规则引擎与测试语料**。这是这个工坊最有价值的资产；重构只改“在哪里运行、结果如何持久化”，不改规则语义。
- **taxonomy / content policy 作为代码中的单一事实来源**。只搬家到 `packages/config`，不塞进数据库或 UI。
- **stable / staging 双通道客户端与版本门禁**。保留 manifest 驱动的版本策略；不引入“最低版本”第二套逻辑。
- **Cron 驱动的 featured 轮换概念**。实现从 5 张表 + build token 降为 1 张 `featured_picks`，但“每 6 小时换一批、近期不重复”的产品行为不变。
- **R2 私有 + Worker 代理文件**。不把 bucket 设为公开；权限判断集中在文件路由。
- **中文产品文案与编辑口径**（在 UI 重写时原样迁移，不在后端重构中改写）。

---

## 附录 A：切换前必须存在的自动化检查

```text
pnpm lint
pnpm typecheck
pnpm test                 # contracts + checker + worker integration + migration
pnpm build
pnpm test:e2e --grep @smoke
pnpm check:boundaries     # dependency-cruiser
pnpm check:openapi        # 生成物与 contracts 无漂移
pnpm check:no-generated   # git status 不含 dist/generated（客户端 release 除外）
```

## 附录 B：新 schema 的索引清单（按查询建，不按感觉建）

- 公共列表：`(published_revision_id IS NOT NULL, visibility)` + 各排序键。
- 详情：`projects.id` 主键；`project_revisions.id` 主键 + `(project_id, revision_no DESC)`。
- 审核队列：`project_revisions(status, submitted_at)` 部分索引。
- 作者项目：`projects(author_id, updated_at DESC)`。
- 点赞/订阅：`(user_id)` + 复合主键。
- 搜索：`projects.search_text` 不建索引（`LIKE '%x%'` 用不上）；标签 `project_tags(tag, project_id)`。
- 统计：`project_metric_daily(day)`；featured `(rotation_key, rank)`。
- 审计：`audit_log(created_at DESC)`。

## 附录 C：一次性删除后的预期规模（估算）

| 指标 | 当前 | 目标 |
|---|---|---|
| Worker TS 源码 | 约 29k 行（含 UI） | 约 8–12k 行（API + services + repos） |
| 浏览器 UI | 15k 行字符串 | 0（迁到 `apps/web`） |
| 路由 | 50 OpenAPI + 7 手写 | 约 45–50 个版本化 REST 路由 |
| D1 表 | 30+ | 约 20 |
| D1 migrations | 36 个增量 + 618 行基线 | 1 个基线 + 后续增量（无第二份 schema） |
| node 测试 | 74 个，CI 跑 9 个 | 约 25 个行为/集成测试，CI 全跑 |
| 提交的生成物 | 约 3.9 MB | 仅客户端 release 产物 |

# P0 基线（2026-10-21）

本文件是重构前的**事实快照**。产品语义以 [`decisions.md`](decisions.md) 为准；本文件只记录旧系统实际有什么、哪些行为不能当 oracle。

## 1. 已捕获的旧 API 样本

脚本：`tools/p0-capture.mjs`（匿名、只读，不含 token）。
输出：`tests/fixtures/legacy/`（16 个响应 + `manifest.json`）。

覆盖：

- 项目列表：默认、第 2 页、按下载、按更新、搜索、按类型。
- 项目详情与 `install-info`：列表前 3 个公开项目。
- 发现栏、开发组推荐、角色基准、基准条目。

用途：**只作为公开读路径的产品语义参考**。不覆盖：

- 登录/会话、私有项目、草稿、审核、上传、发布。
- 缓存头、CORS、错误码的旧实现（旧 auth/CORS 已知有缺陷）。

## 2. 旧路由矩阵

来源：`cloudflare/src/index.ts:188-351`。共 50 条 OpenAPI 路由 + 3 条手写 GET + 1 条 staging hook + DO 内转发。

### 2.1 公开读

| 方法 | 路径 | 鉴权 | 新契约 |
|---|---|---|---|
| GET | `/api/projects` | 匿名；登录时附加个人状态 | `GET /api/v1/projects` |
| POST | `/api/projects/batch` | 匿名 | `GET /api/v1/projects?ids=` 或 `POST /api/v1/projects/batch` |
| POST | `/api/projects/version-check` | 匿名 | `GET /api/v1/projects/:id/releases/:releaseId` 合并 |
| POST | `/api/projects/repair-resolve` | 匿名/登录 | `POST /api/v1/projects/:id/repair-resolve` |
| GET | `/api/projects/:id/install-info` | 登录 | `GET /api/v1/projects/:id/releases/:releaseId/manifest` |
| GET | `/api/projects/:id` | 匿名；作者/管理员看草稿 | `GET /api/v1/projects/:id` |
| GET | `/api/site/discover-banner` | 匿名 | `GET /api/v1/site` |
| GET | `/api/devteam-recommendations` | 匿名 | `GET /api/v1/recommendations` |
| GET | `/api/character-references` | 匿名 | `GET /api/v1/reference-sets` |
| GET | `/api/character-references/versions/:id/items` | 匿名 | `GET /api/v1/reference-sets/:id` |
| GET | `/api/files/*` | 公开/作者/管理员 | `GET /api/v1/projects/:id/releases/:releaseId/files/:kind` |
| GET | `/`、`/assets/*` | 匿名 | Static Assets |

### 2.2 身份

| 方法 | 路径 | 鉴权 | 新契约 |
|---|---|---|---|
| GET | `/api/auth/login` | 匿名 | `POST /api/v1/auth/flows`（Origin 白名单 + PKCE） |
| GET | `/api/auth/callback` | 匿名 | `GET /api/v1/auth/callback` |
| GET | `/api/auth/poll` | 匿名 | 删除；改为 flow 状态 + 一次性 redeem |
| GET | `/api/auth/me` | 可选 | `GET /api/v1/me` |
| POST | `/api/auth/logout` | 登录 | `DELETE /api/v1/sessions/current` |
| POST | `/api/auth/local-preview` | 本地预览 | 保留为本地 dev-only，不进生产契约 |

### 2.3 作者写路径

| 方法 | 路径 | 鉴权 | 新契约 |
|---|---|---|---|
| GET | `/api/my/projects` | 登录 | `GET /api/v1/me/projects` |
| GET | `/api/my/subscriptions` | 登录 | `GET /api/v1/me/subscriptions` |
| POST | `/api/projects` | 登录 | `POST /api/v1/projects` |
| PUT | `/api/projects/:id` | 作者/管理员 | `PATCH /api/v1/projects/:id` |
| PUT | `/api/projects/:id/compatibility` | 作者/管理员 | 合并进 revision metadata |
| PUT | `/api/projects/:id/visibility` | 作者/管理员 | `PATCH /api/v1/projects/:id/visibility` |
| DELETE | `/api/projects/:id` | 作者/管理员 | `DELETE /api/v1/projects/:id` |
| POST | `/api/projects/:id/entries/remove` | 作者/管理员 | 合并进 revision 编辑 |
| POST | `/api/projects/preflight/:kind` | 登录 | `POST /api/v1/projects/:id/revisions/:rev/preflight` |
| POST | `/api/projects/:id/upload` | 作者/管理员 | `PUT /api/v1/projects/:id/revisions/:rev/files/:kind` |
| POST | `/api/projects/:id/upload-cover` | 作者/管理员 | 同上，`kind=cover` |
| PUT | `/api/projects/:id/cover-presentation` | 作者/管理员 | revision metadata |
| POST | `/api/projects/:id/upload-regex` | 作者/管理员 | 同上，`kind=regex` |

新模型没有独立的 `draft_project` / `published_project` 行：`project_revisions` + `working_revision_id` / `published_revision_id`。

### 2.4 互动

| 方法 | 路径 | 鉴权 | 新契约 |
|---|---|---|---|
| POST | `/api/projects/:id/like` | 登录 | `PUT/DELETE /api/v1/me/likes/:id` |
| PUT | `/api/projects/:id/rating` | 登录 | `PUT/DELETE /api/v1/me/ratings/:id` |
| POST | `/api/projects/:id/subscribe` | 登录 | `PUT/DELETE /api/v1/me/subscriptions/:id` |
| PUT | `/api/projects/:id/subscribe` | 登录 | `PUT /api/v1/me/subscriptions/:id` |
| GET | `/api/projects/random-draw/state` | 登录 | Q-10 待定；入口已收起 |
| POST | `/api/projects/random-draw` | 登录 | Q-10 待定 |

### 2.5 管理员

| 方法 | 路径 | 鉴权 | 新契约 |
|---|---|---|---|
| GET | `/api/admin/logs` | 管理员 | `GET /api/v1/admin/audit-events` |
| GET | `/api/admin/pending` | 管理员 | `GET /api/v1/admin/submissions` |
| POST | `/api/admin/pending/cleanup` | 管理员 | cron 回收，删除手动入口 |
| POST | `/api/admin/projects/recount` | 管理员 | 删除（不再维护物化总数） |
| GET/POST | `/api/admin/review/:id` | 管理员 | `GET /api/v1/admin/submissions/:id`、`POST .../review` |
| GET | `/api/admin/projects` | 管理员 | `GET /api/v1/admin/projects` |
| GET | `/api/admin/list` | 管理员 | `GET /api/v1/admin/members` |
| POST | `/api/admin/set-admin` | 超级管理员 | `PUT /api/v1/admin/members/:id/role` |
| POST | `/api/admin/character-references` | 管理员 | `POST /api/v1/admin/reference-sets` |
| POST | `/api/admin/character-references/:id/versions` | 管理员 | `POST /api/v1/admin/reference-sets/:id/versions` |
| PUT | `/api/admin/discover-banner` | 管理员 | `PUT /api/v1/site` |
| POST | `/api/admin/discover-banner/upload` | 管理员 | revision asset upload |
| PUT/DELETE | `/api/admin/devteam-recommendations/:id` | 管理员 | `PUT/DELETE /api/v1/admin/recommendations/:id` |

### 2.6 内部/运维

| 方法 | 路径 | 鉴权 | 处置 |
|---|---|---|---|
| POST | `/api/internal/staging/rankings/rebuild` | staging host + header | 删除；用 `workflow_dispatch` 或本地脚本 |
| DO | `contentServiceKey` 匹配的 preflight/review/upload/detail | 由 Hono 处理器再校验 | 删除正则分发器；Hono 显式 `getByName()` |

## 3. 旧数据模型

`cloudflare/schema.sql` 共 29 张表（含 FTS 虚拟表）：

`users`、`projects`、`public_project_counts`、`devteam_curators`、`devteam_recommendations`、`character_references`、`character_reference_versions`、`character_reference_items`、`project_metadata_audit_logs`、`project_rank_snapshots`、`project_ranking_days`、`project_daily_rankings`、`project_ranking_builds`、`discovery_feature_history`、`daily_random_draw_state`、`project_likes`、`project_like_daily_usage`、`download_daily_usage`、`project_metric_daily`、`project_period_tracking_meta`、`project_period_popularity`、`project_ratings`、`project_subscribes`、`repair_resolve_daily_usage`、`site_settings`、`admin_action_logs`、`super_admins`、`admins`、`project_search` / `project_search_tags` / `project_search_short`（FTS）。

新库从 `apps/worker/migrations/0001_initial.sql` 重建。旧表映射与不迁移清单见 `main.md` §7.1。

## 4. 旧测试盘点

- `cloudflare/tests` 74 个 node 脚本。
- 其中约 62 个读取源码做正则/字符串断言（`readFileSync`/`toMatch`/`includes`）。
- 约 14 个实际执行 handler 或 fetch。
- 根 `tests/e2e` 10 个 Playwright spec，默认打线上 staging。

处置：删除源码文本断言；保留 EJS checker 语料、fingerprint、diff、安装安全行为；新增 domain 单测、workerd + D1 集成、API 契约、迁移对账、5–8 条真实旅程。

## 5. 已知缺陷（不能作为 oracle）

来自 `main.md` §1，已核实：

1. `/api/auth/login` 把请求 `Origin` 直接当白名单；全站 CORS `*`；`postMessage(token, allowedOrigin)`；`/api/auth/poll` 仅凭 state 返回 token → 任意站点可劫持登录。
2. JWT 默认 7 天，payload 内嵌 `isAdmin`；logout 空实现；撤管理员不生效。
3. `projects` 同时承担公开项目、草稿、审核快照、计数器；发布跨 D1/R2 无事务；失败逐项补偿；草稿删除留 R2 孤儿。
4. `visibility=1` 只过滤列表/搜索；`/api/files/*` 对 approved 项目一律放行，不检查 visibility。
5. UI 是 ~15k 行 `String.raw` 字符串，唯一语法验证是 `new Function()`。
6. `cloudflare/tsconfig.json` 关闭 `strict` / `strictNullChecks` / `noImplicitAny`。
7. 三套缓存 + 客户端 TTL + `forceRefresh` 永远 false。
8. 50 条 OpenAPI + 正则分发器 + DO 内再调 `app.fetch`，路由表重复。
9. 两套包管理器、两份 lockfile、产物入库、部署脚本硬编码 `upstream`。

## 6. 新系统边界

按 `decisions.md`：

- 一个 Worker + Static Assets；`/api/v1/*` 由 Hono；未匹配 `/api` 返回 JSON 404。
- 一个 `ContentService` DO，只承接大 JSON 解析/checker；显式路由，无正则分发器。
- D1 新库 + R2 不可变对象；KV 不用；session 落 D1。
- 两态可见性：`public` / `private`；private 对非作者/审核者一律 404。
- 不可变 revision + 单指针发布；无跨 D1/R2 补偿。
- 动态 API 首版 `private, no-store`；验收后按 D-28 开 Workers Cache。

## 7. 删除清单（P6 执行）

`pages/home/**`、`pages/home.ts`、`/assets/home.js`、`contentServiceKey`、`caches.default` ×3、客户端 TTL/`forceRefresh`、`public_project_counts` 及 trigger、`admins`/`super_admins`、`project_rank_snapshots`、`project_ranking_days`、`project-ranking-snapshots.ts`、`test-bundles/`、`wrangler.frontend.jsonc`、`utils/auth.ts` KV session、committed `generated/*.txt`、`scripts/deployment/*.ps1`、`sync-staging-from-backup.py`、重复 lockfile、`test-dist` shim（窗口后）。

## 8. 切换前检查

- [ ] 旧 D1/R2 快照可本地打开；R2 清单含 key/size/hash。
- [ ] 停写屏障覆盖所有写路径 + 旧文件 GET 计数 + OAuth 写。
- [ ] 新库 extract/transform/load/verify 全量两次 + delta；对账全过。
- [ ] 公开读差分样本通过；私有/草稿/审核样本不泄露。
- [ ] 新 Worker staging 冒烟；5xx < 0.5%。
- [ ] 回滚：开放写入前可回旧库；开放写入后只回滚代码。
- [ ] 生产只走 tag + environment 审批。

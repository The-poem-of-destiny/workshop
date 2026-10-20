# Creative Workshop 重构方案（主方案 v2）

日期：2026-10-20（v2 吸收了独立审阅发现的安全与发布一致性问题）  
范围：`The-poem-of-destiny/workshop` 全仓  
前提：允许重写；一次性切换；旧系统在线到切换完成；新库 + 数据迁移；UI 之后用 React + Tailwind + shadcn + Vite 重做。

## 0. 核心判断

当前系统不是一个应用，而是三个产物被粘在同一个 Worker 里：

1. **Bridge 脚本**：装在 SillyTavern 里，负责开 iframe、传 host 能力（`src/CreativeWorkshop`）。
2. **Web 应用**：iframe 里的界面，现在是 15k 行字符串拼出来的单个 `home.js`。
3. **API + 存储**：50 条路由、D1/R2/KV/DO，外加一个手写的正则分发器。

重构第一原则：**把三件事的边界显式化**。第二原则：**凡是"为了绕开某个限制"而存在的结构，先证明限制仍在，再决定保留**。第三原则（v2 新增）：**先修不变量，再减结构**——鉴权、发布原子性、计费口径这三件事如果只是被搬进新目录，等于没重构。

## 1. 诊断（按严重度）

### P0-A 登录可被任意站点劫持（已核实代码路径）

- `endpoints/auth.ts:139`：`AuthLogin` 直接取请求头 `Origin` 作为回调白名单，无允许列表。
- `index.ts:127-130`：全站 `Access-Control-Allow-Origin: *`，任意站点可读 `/api/auth/login` 返回的 `{url, state}`。
- `endpoints/auth.ts:364`：回调页用 `postMessage(payload, allowedOrigin)` 把 7 天有效的 JWT 发给这个 Origin。
- `endpoints/auth.ts:205-218`：`/api/auth/poll?key=<state>` 只要知道 state 就返回 token；state 正是调用方自己拿到的。
- 攻击路径：恶意页面取 state → 诱导受害者完成 Discord 授权 → 回调把 token 交给恶意 Origin，或直接轮询取 token。管理员同样受影响。

### P0-B 发布不是原子动作，补偿代码替代了数据模型

- `projects` 同时承担公开项目、草稿、审核快照、统计计数（`schema.sql:24-90`），靠 `published_project_id` / `draft_project_id` / `root_project_id` 自引用。
- 每次编辑先 `createDraftFromPublished`（`utils/db.ts:1467-1617`，150 行、3 次重试），上传/封面/正则/删条目各自重复一遍。
- 审核通过时改发布行 → 复制 R2 → 失败逐项回滚 → 删草稿（`admin.ts:530-690`、`utils/r2.ts:127-283`）。D1 与 R2 没有共同事务；失败路径只能记日志。
- 草稿删除只删 D1 行，不删 R2 前缀（`db.ts:762-787`），每次更新都会留下孤儿对象。

### P0-C 权限是签发时的快照，登出不撤销

- JWT 默认 7 天，payload 内含 `isAdmin` / `isSuperAdmin`（`utils/jwt.ts:92-114`）。
- `AuthLogout` 是空实现（`auth.ts:448-468`）；撤销管理员后旧 token 仍带旧权限。

### P0-D 测试不能作为安全网

- 74 个 node 脚本中 49 个读源码做正则断言，CI 只跑其中 9 个（`.github/workflows/cloudflare-checks.yaml`）。
- Playwright 默认打线上 staging，依赖真实账号与 profile，不可重复。

### P1 结构

| 问题 | 证据 |
|---|---|
| 前端不是代码，是字符串 | `pages/home/` 14,954 行；`app.ts` 拼 18 段；唯一语法检查是 `new Function()` |
| 路由按按钮设计 | `batch`、`version-check`、`install-info`、`preflight/:kind`、`entries/remove`；like 是 POST，subscribe 有 POST toggle 和 PUT set 两套 |
| 请求分发写了两遍 | Hono 50 条 + `contentServiceKey()` 正则（`index.ts:358-368`）再进 DO，DO 内又调用 `app.fetch` |
| 数据层没有边界 | `utils/db.ts` 1,916 行；`install-info` 又自写 SQL（`read.ts:509`） |
| 缓存四层互相打架 | `caches.default` ×3 + 头 ×5 + 浏览器列表 15s/60s + 详情/差分/修复 TTL；`s-maxage` 与 SWR 互斥；`forceRefresh` 永远为 false |
| 发布不可复现 | 两套包管理；`dist/`、`test-dist/`、`test-bundles/`、`generated/` 入库；部署脚本硬编码 `upstream` |
| 死物 | `wrangler.frontend.jsonc` 无引用；`test-bundles/` 无引用；85 个 npm script；`utils/auth.ts` 的 KV session 无生产调用 |

## 2. 目标架构

```text
workshop/
├ apps/
│  ├ api/                  Worker：只提供 API 与静态资源绑定，不含 HTML/JS 字符串
│  └ web/                  Vite + React + Tailwind + shadcn（后续专项）
├ packages/
│  ├ bridge/               Tavern Helper 脚本（esbuild 单文件）
│  ├ contracts/            zod schema、DTO、错误码、bridge 协议
│  ├ domain/               纯规则：taxonomy、内容策略、版本语义、排行
│  ├ content/              世界书/正则解析、preview、diff、fingerprint
│  └ db/                   schema、migrations、按用例的参数化查询
├ infra/                   wrangler 配置、部署脚本
└ tooling/                lint、tsconfig、测试工具
```

依赖单向：`apps → packages`；`contracts ← domain ← db`；禁止跨包相对路径。用 `dependency-cruiser` 在 CI 强制。

### 运行拓扑

- **一个 Worker**：`/api/*` 走 Hono；其余交给 Static Assets（`apps/web/dist`），SPA fallback；`/api` 未匹配返回 JSON 404，不能被回退成 index.html。
- **DO**：默认删除。前提是账号在 Workers Paid（30s CPU），按实测 CPU 预算验证；若实测超限，只保留一个显式 `ContentService`，由 Hono 直接 `getByName(projectId)` 调用，不做正则分发。
- **KV**：新系统不用。OAuth flow 与 session 全部落 D1，可审计、可原子消费。
- **认证**：opaque session token（库中只存 hash），每请求读当前角色；不再把角色写进 token。OAuth flow 用 `state + 独立 redeem secret`，一次性消费。
- **CORS**：只允许工坊自身 origin；iframe 同源请求，host 通过 bridge 拿结构化结果，不把 bearer token 存在酒馆变量里。

### API 契约（`/api/v1`，一次性切换但仍保留前缀）

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

- 资源名词优先，只有状态机（审核）用动作；删除 toggle，点赞/订阅/评分改为幂等 `PUT/DELETE`。
- 一个视图一个读模型，不再保留 `batch` / `version-check` / `install-info` 三件套。
- 完整内容不塞进公开详情；公开详情只给摘要与条目索引，可安装 JSON 走 `releases/*/files/*`，与权限检查同一函数。
- 统一 `{ error: { code, message, details? } }`；集合返回 `{ items, nextCursor }`，避免 `page/hasMore/total` 语义漂移。
- 写操作统一 `If-Match`（row version）或幂等 key；冲突 412/409，不做最后写入者覆盖。

## 3. 数据

新库从 `0001_initial.sql` 建，不再堆 36 个迁移。核心表：

- `users` / `sessions` / `oauth_flows` / `audit_events`
- `projects`（稳定 id、author、visibility、published_revision_id、working_revision_id、row_version）
- `project_revisions`（不可变；`UNIQUE(project_id, revision_no)`）
- `assets`（R2 key = UUID，sha256、bytes、mime、kind）
- `submissions`（一个项目最多一个 pending，partial unique index）
- `reviews`（submission_id UNIQUE，绑定 manifest_hash + checker_version + report）
- `likes` / `subscriptions` / `ratings` / `project_metrics_daily`
- `ranking_runs` / `ranking_entries` / `recommendations` / `site_settings` / `reference_*`

发布算法：上传写新 asset → 创建不可变 revision → 提交生成 submission → 审核写 review → **一个 D1 batch 内 CAS 切 `published_revision_id`**。R2 不复制、不回滚；对象不可变，孤儿由 cron 按引用比对回收。

`If-Match` 与条件更新必须在真实 workerd + D1 上验证，不能拿 mock 的 `.changes` 当原子性证据。

## 4. 缓存（v2 调整：先正确，再性能）

| 阶段 | 策略 |
|---|---|
| 切换时 | 静态资产内容哈希 + `immutable`；`index.html` 与 manifest `no-cache`；**所有 `/api/*` 一律 `private, no-store`**；计数文件、草稿、审核一律不缓存 |
| 切换后（验证通过再开） | 只对 viewer-neutral 的公开 GET 开 Workers Cache：`Cache-Control: public, max-age=0, must-revalidate` + `CDN-Cache-Control: max-age=30..60, stale-while-revalidate=...`；用 `Cache-Tag` 做发布/下架 purge |
| 永不缓存 | 带 `Authorization` 的响应（Workers Cache 自动 bypass，但也不能靠它兜底）、`/me/*`、计数下载、草稿与审核 |

先不开共享缓存的原因：下架、隐藏、审核状态的失效语义没有测试前，边缘缓存是最容易制造"看不到新内容/看到不该看的内容"的地方。等 API 契约与权限测试稳定后再开，且用 `Cf-Cache-Status` 统计命中率。

删除 `caches.default` 三处与客户端 TTL Map；客户端只保留请求期 in-flight 去重。

## 5. 分阶段迁移

| 阶段 | 内容 | 验收 | 回滚 |
|---|---|---|---|
| P0 基线 | 旧库导出、R2 清单、路由/权限/字段矩阵、公开 API 样本录制；旧 Worker 加维护/只读模式（包含 GET 计数与 OAuth 写路径） | 快照可本地打开；样本覆盖所有公开读；维护模式确实停止写 | 只读 |
| P1 骨架 | workspace、contracts、docs、单 Worker + Static Assets、本地 D1/R2、统一错误/鉴权 | 冻结安装可 build/typecheck；真实 workerd 中 404 不被 SPA 吞；无字符串 UI、无第二份路由表 | 仅新分支 |
| P2 读路径 | 新 auth/session、home/list/detail、release/manifest、files | 新 Worker 在 staging + 迁移库返回与旧 API 等价结果（字段/排序/总数）；OAuth 不再向任意 Origin 发 token | 仅 staging |
| P3 写路径 | revision/upload/submit/review/publish、审计、计数 beacon | 并发提交/审核 409；审批中角色撤销即时生效；approve 后无 R2 复制、无孤儿 | 仅 staging |
| P4 数据彩排 | 迁移工具 extract/transform/load/verify；全量两次演练 + delta | 行数/文件 hash/互动/私人评分/审计全部对账；抽样安装可用 | 销毁新目标 |
| P5 切换 | 停写屏障 → 最终 delta → 部署 → 冒烟 → 开放写入 | 登录/列表/详情/安装/上传/审核/下载全通过；5xx < 0.5% | 开放写入前可回旧；之后只回滚代码，不回滚数据 |
| P6 清理 | 删旧 UI/缓存/死表/死测试/生成物；一个发布周期后删 `test-dist` shim | 旧路径零引用；CI 全绿；仓库无生成物 | 不需要 |

迁移要求：

- **保留公开项目 id**，让既有安装记录、书签、Discord 链接继续可用。
- 迁移工具幂等，参数含 source/target 资源 id；同资源直接失败；只读旧资源、只写新资源。
- 停写屏障不能只拦写方法：旧文件 GET 会计数，OAuth callback 也会写库。
- 回滚边界要诚实：开放用户写入后不再承诺无损回切旧库；要么提前演练反向回放，要么明确只回滚代码。

## 6. 测试

- **删除**：所有源码正则断言；为死代码保留的测试。
- **保留**：EJS checker 的真实输入/输出语料、fingerprint、diff、安装安全行为；Playwright 只保留 5–8 条真实旅程。
- **新增**：domain 单测；D1 migration + 查询集成测试（workerd）；API 契约测试（P0 录制样本）；迁移对账测试；发布前 D1 rows read/write 预算。
- 统一 `pnpm test` / `pnpm test:e2e`，不再维护 85 个 script。

## 7. 明确删除清单

`pages/home/**`、`pages/home.ts`、`contentServiceKey`、`CodeCheckService`（按 CPU 实测）、`caches.default` 三处、客户端四套 TTL 缓存、`forceRefresh`、`public_project_counts.revision` 与相关 trigger、`admins`/`super_admins`、`test-bundles/`、`wrangler.frontend.jsonc`、`utils/auth.ts` KV session、`utils/project-ranking-snapshots.ts` 及其表、committed `generated/*.txt`、PowerShell 部署器、`sync-staging-from-backup.py`（改为受控迁移工具）、重复 lockfile。

**不删**：中文短搜索（trigram/短字索引）与排行行为——先写行为测试，再决定是否用更简单查询替代；删除功能不是重构的默认动作。

## 8. 不动的部分

D1/R2 选型；内容策略与 taxonomy 的规则语义；安装握手与最低版本机制；不信任客户端校验的姿态；下载计数口径（成功提供的项目 JSON 请求次数）。

## 9. 主要风险

1. **鉴权迁移**：OAuth 改为 flow + redeem，会同时影响 WebView/外部浏览器两条登录路径，必须在真实设备验证。
2. **数据迁移**：草稿/正式混合的历史数据（一个项目多行）必须按 root/published/draft 重建聚合，冲突行要人工清单。
3. **CPU 预算**：DO 现在承担解析负载；删之前用真实 10MB 世界书测 workerd CPU。
4. **缓存**：开启 Workers Cache 后，无 `Cache-Control` 的 200 会被启发式缓存 2 小时——所以 v2 要求先全量 `no-store` 再逐条开放。
5. **Bridge 版本漂移**：用户本地旧脚本会请求旧地址；旧 Worker 至少保留一个下架窗口。

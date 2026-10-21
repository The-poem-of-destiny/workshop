# Creative Workshop 重构完成度合并审计

- 日期：2026-10-21
- 分支：`refactor/2026-10`，HEAD `e103ee4` 时的代码
- 输入：`features-audit-a.md`（features §1–6、§13、checker 规则）、`features-audit-b.md`（features §7–12、decisions、API/schema/cache/ops）
- 性质：只读审计，不修改源码；合并报告消除了两份报告的重叠，并保留原始报告作为证据索引。

## 1. 结论

此前的“P1–P6 已完成”不成立。当前实现是一个**可运行的最小读路径 + 项目创建/上传/人工审核骨架**，不是 decisions 定义的完整工坊。

- features §1–6/§13：只有角色/会话撤销、项目创建、两态可见性等少数项闭环。
- features §7–12：8 done / 12 partial / 14 missing。
- decisions：6 done / 18 partial / 9 missing。
- 最严重缺口：checker 规则内容与权威复核、OAuth 登录闭环、客户端分发/旧客户端兼容、内容校验、cron/榜单、Workers Cache、管理端写接口、项目版本字段。

## 2. 已验证实现（可保留）

| 能力 | 证据 |
|---|---|
| pnpm workspace、contracts/domain、单 Worker + Static Assets、D1 schema | `pnpm check`；`apps/worker/wrangler.jsonc`；`packages/contracts`；`packages/domain` |
| 公开读：list/detail/home/recommendations/reference-sets/site、封面 | `apps/worker/src/http/routes/projects.ts`、`home.ts`、`references.ts` |
| 登录后 release manifest/files | `apps/worker/src/storage/releases.ts`；`routes/projects.ts` |
| 角色存库、每请求校验、会话撤销 | `storage/sessions.ts`、`routes/auth.ts` |
| 项目创建、两态可见性、CAS、不可变 revision、上传冻结、人工审核/publish 指针切换 | `storage/authoring.ts`、`storage/admin.ts`；26 个 worker 测试 |
| 点赞/订阅/评分/下载计数（幂等） | `routes/me.ts`、`storage/interactions.ts`、`storage/downloads.ts` |
| 迁移工具、真实备份全量两次 + delta + 本地 D1 load | `tools/migrate/*`；审计记录见 `state.md` |
| 本地 E2E 10 条、staging 部署/回滚/5xx 冒烟 | `tools/e2e-local.mjs`；`p5-cutover.md` |
| 旧源码文本断言测试删除 | `tests/` 仅保留 fixtures |

## 3. 阻断级缺口（按修复顺序）

### B0. Checker 规则内容与权威复核

当前 `apps/`/`packages/` **没有 checker 实现**。旧规则内容在 `2aa31fb^:cloudflare/src/utils/ejs-checker/`，需要移植，而不是重新发明：

- L1–L7：顶层 var/let/const/function/class、共享全局/裸赋值、通用名、跨条目符号冲突、decorator/`@@private`
- M1–M5：eval、Function、cookie/storage、fetch/XHR/WebSocket、无界循环
- U2–U5：外链、HTTP/IP、动态 URL、可信媒体主机/官方 URL/CharInfo 豁免
- API1–API2：ST-Prompt-Template API await/最小实参
- AH1–AH4：atob/btoa、动态调用、运行时改写 EJS 标记、动态 `<script>`
- EJS-PARSE/JS-PARSE/FILE/CHECKER-INTERNAL/CHECKER-LIMIT；2000 条目、500 单元、20 万字符、4 万/10 万 AST、120s
- gate/audit/certification 与 uploader 投影（SCRIPT-RISK/SCRIPT-REVIEW）

新设计按 D-34 不再做 attestation/二次上传，但必须有：提交时记录客户端 gate；DO/审核端用同一 checker revision 对冻结内容跑权威检查；人工审批绑定 `revision + manifest hash + checker revision`；pass/warn 自动发布，block/missing/超时进人工。

当前 `submitRevision` 直接信任调用方 `gate`，`reviewAdminSubmission` 直接信任调用方 `checkerVersion/report`；`util/ejs-checker-v2.js` 只是无法重建的死 bundle。

### B1. 认证闭环

- 没有 `POST /auth/flows/:id/redeem`、`GET /auth/callback`、设备码。
- 没有生产 `INSERT INTO sessions` 路径；即使补 callback 也无法登录。
- 服务端生成的 PKCE verifier 只存 hash、不返回客户端；未传 `codeChallenge` 的 flow 永远不可兑换。
- 无 guild 准入、CORS 允许列表、CSP。
- D-10 说“不存请求 Origin”，实现却写入 `oauth_flows.origin`。

需要 Discord client secret 才能做真实验证；代码可以先补，但必须标明未验证。

### B2. 客户端分发与旧客户端兼容

- `/client/*` 在 `run_worker_first` 中，但没有 handler；无 R2 代理、stable/staging 指针、版本门禁、Workers Cache、迁移提示。
- 旧客户端仍请求 `/api/projects/:id`、`/api/files/*`，新 Worker 只有 `/api/v1/*`；切流后旧客户端不可安装/更新。
- `test-dist` shim 只保留文件，新 Worker 不服务它。

必须先决定：为旧客户端提供兼容路由，还是明确下架并返回迁移提示。

### B3. 内容与元数据校验

- `validateProjectContentText`、`validateProjectContentPolicy` 在 Worker 中零调用；空世界书/非法 JSON 可提交并批准。
- 上传只校验 MIME/大小；无结构识别、类型/标签策略、封面尺寸/解码。
- `discordThreadUrl` 接受任意 URL，无 Discord host/guild/path 白名单；无控制字符/版本格式/频率限制；无 metadata findings/审计。

## 4. 高优先级缺口

| 领域 | 缺口 |
|---|---|
| 搜索 | 1–2 字仍走 `LIKE`，`project_search_short` 是死索引 |
| 审核 | 无审核详情文件内容/diff；拒绝原因可空；无 audit-events 读取；`checkerVersion` 可覆盖 |
| 管理端 | 无 `PUT /admin/site`、banner 上传、reference set/version 写入、recommendation 写、audit-events 读取 |
| 定时任务 | 无 `scheduled`；榜单、7d/30d 热度、过期 session、孤儿清理、自动审核全部不运行 |
| 缓存 | 无 D-24/D-28；静态资源无 immutable；无 Cache-Tag/purge |
| 项目模型 | 无版本标签、metadata checker 字段、built/tested/incompatible、precautions、原版冲突 |
| 分发 | 无 client version 记录 / 精确门禁 |
| 下载 | POST 只返回 204，无一次性地址/重定向；计数与取文件脱钩 |
| 参考集 | 只返回计数，不返回 item/hash；基线指纹/冲突不可用 |
| 删除/我的项目 | 无 `DELETE /projects/:id`、单条目删除、`/me/projects`、`/me/subscriptions` |
| 配套脚本 | D-08 未执行：config/bridge 仍保留 |
| Web UI | 排序 tab 默认页无效；无发现栏/分页/作者筛选/我的项目/Toast/警告/Discord 按钮；Banner 忽略位置缩放；无作者/审核后台 |
| 测试 | T2 checker 语料、T3 fingerprint/diff/安装安全、T6 legacy 契约测试缺失；无 Playwright |

## 5. 有意延期（不是本轮遗漏）

| 项 | 原因 |
|---|---|
| 真实 Discord OAuth 验证 | 缺 client secret |
| 真实 SillyTavern 验证 | 本机无运行实例 |
| R2 批量复制 / staging 真实数据导入 | 需明确目标与审批；本地 D1 load 已完成 |
| 生产切换 | 人工审批 |
| Q-10 每日抽签 | 产品未决定 |
| `test-dist` shim / 旧客户端删除 | 下架窗口 |

## 6. 任务清单（建议执行顺序）

### P0：先修正确性，低风险

1. 上传/提交接入 `validateProjectContentText` + `validateProjectContentPolicy`；空/无效内容拒绝；findings 入库。
2. 1–2 字搜索改回 `project_search_short MATCH`，转义控制字符/引号。
3. 修 Web 默认排序：无搜索时也渲染 `projects`，`home.latest` 只作初始占位。
4. 私有大纲/封面：作者 `GET /:id/draft` 的 cover 应可读；审核详情允许 cover。
5. 拒绝必须填原因；作者可读取最近一次拒绝原因。
6. `checkerVersion` 不得覆盖 submission 记录；不一致返回 409。
7. Discord URL 白名单（host/guild/path），metadata 长度/控制字符/版本格式校验。
8. `POST /downloads` 返回一次性地址或 302，文件路由消费 token。

### P1：checker 规则移植（最大单块）

9. 从 `2aa31fb^` 恢复 `ejs-checker` 源码到 `packages/content`（parser/policy/capabilities/links/api/report/audit/limits）。
10. 恢复/重建 upload/review 两个 bundle，改为 Static Assets 构建产物；保留 `?v=` 和 revision。
11. 接回提交路由：记录 client gate/warning count/ack/time；服务端结构+策略校验。
12. 建 `ContentService` DO 与 cron：领取 submitted、按项目串行跑 review checker、写报告、pass/warn 自动发布、block/missing/超时进人工。
13. 审核绑定：checker revision、manifest hash、report findings、人工覆盖理由、审计。

### P2：分发/认证

14. `/client/*` R2 代理 + stable/staging 指针 + 版本记录 + 精确门禁 + Workers Cache/Cache-Tag。
15. 旧客户端兼容：`/api/projects/:id`、`/api/files/*` 映射到 release，或明确停用并返回迁移提示。
16. OAuth callback/redeem/device + session 创建/滑动过期 + guild 准入 + CORS/CSP；需要 secret。

### P3：管理/读路径/UI

17. 管理端：audit-events、site、banner、recommendation、reference set/version 写入。
18. cron：榜单/7d/30d、清理、过期 session。
19. 项目模型：版本标签、metadata checker、built/tested/incompatible、precautions、原版冲突。
20. Web UI：作者后台、审核后台、我的项目/订阅、分页、作者筛选、发现栏、Toast、警告、Discord、Banner 位置缩放。

### P4：测试与发布

21. T2 checker 语料、T3 fingerprint/diff/安装安全、T6 legacy fixture 契约测试。
22. Playwright 5–8 条本地旅程。
23. CI 精确 SHA 构建一次 + artifact 提升；部署前跑 migration；cache/rows-read 预算测试。
24. R2 批量复制适配器（本地/staging 目标）。

## 7. 验收口径

- 每批只按对应 docs 的验收项算完成；不以“有表/有路由”代替端到端。
- checker 必须能用旧语料复现 gate/report；不得只 mock。
- 旧客户端兼容必须有真实旧 bundle 的安装/更新冒烟，或明确停用公告。
- P0/P1 完成前不声称 P3/P5/P6 可生产切换。

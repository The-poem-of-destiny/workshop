# 上线前加固：双桶 CDN 客户端分发、跨站分区 OAuth、TavernHelper 桥接与威胁门禁

- Status: implemented
- 确认日期：2026-11-23（源码已合入 `main`：PR #104 `3935615`、PR #107 `4682345`、PR #109 `d7deb9d`，并已在 `staging` 跑通全链自动发版；`production` D1/R2 预装载已完成，待 `v*` tag 正式切流）
- 决策负责人：项目所有者；实现与维护负责人：Worker、Web、Tavern Client、Content Checker 与离线迁移工具维护者。
- 关联与局部取代：
  - 局部替代 [决策记录 D-22／S-05、D-51／D-52](../../../docs/plans/refactor-2026-10/decisions.md#d-53-上线前架构收敛与条款替代汇总)：在保留 Worker `/client/*` 路由回退的前提下，将公开资源桶统一为 `workshop-img-staging`／`workshop-img-prod`，同时承载公开图片副本与客户端版本化／频道产物，并以单条 `json_set` 原子更新 `site_settings.client_channels`。
  - 演进 [决策记录 D-10](../../../docs/plans/refactor-2026-10/decisions.md#d-10-认证与跨域) 与 [社区准入与体验精修记录](community-access-collections-and-ux-refinement.md)：补齐 CHIPS 第三方存储分区下的跨站弹窗 `launch/bind` 第一方绑定协议，并放宽宿主桥接源校验以兼容 TavernHelper 同源子 iframe。
  - 细化 [决策记录 D-09／D-31／D-43](../../../docs/plans/refactor-2026-10/decisions.md#d-09-审核路由) 与 [分类离线切换基础记录](six-category-taxonomy-and-reviewed-cutover.md)：明确 checker 自动发布与人工复核的安全威胁分界，收口 98 对象启动基线与 FTS `char(0)` 净化，并建立两阶段 `preload` + `delta`／`withdraw` 切换门禁。

---

## 背景与问题

在上线前的全仓代码审查、边缘发版联调与酒馆内嵌实测准备中，暴露出四类影响真实运行可靠性与 Cloudflare Free 套餐安全余量的结构性问题：

1. **客户端全走 Worker 代理消耗请求配额且频道更新存在竞态**：任意随机域名的 SillyTavern 页面每次加载客户端都会命中 Worker，挤占 Free 套餐每日 100k 请求上限；同时若先更新 D1 兼容版本记录再上传频道脚本，或直接整行覆盖 `client_channels` JSON，会导致客户端被要求升级到尚不可取的版本或冲掉相邻发布频道。
2. **现代浏览器 CHIPS 存储分区阻断跨站内嵌 OAuth 回调校验**：工坊运行在跨站酒馆（如云酒馆）iframe 内时，iframe 发起 `POST /api/v1/auth/flows` 设置的绑定 cookie 处于「顶层酒馆站点 × 工坊」分区，而顶层弹窗完成 Discord 授权跳回 `/api/v1/auth/callback` 时处于「工坊顶层第一方」上下文，无法读取 iframe 分区 cookie，导致 `embed`／`device` 回调绑定校验失败。
3. **TavernHelper 运行在同源子 iframe 导致严格 `window.parent` 桥接失联**：SillyTavern 的 TavernHelper 扩展将用户脚本运行在宿主窗口的同源子 iframe 内，而非直接在顶层 `window` 执行；工坊内嵌页若只接受 `event.source === window.parent`，会静默丢弃所有 `cw:context` 与安装操作响应。
4. **内容检查阻断粒度与迁移边界隐患**：若把可通过卸载恢复的普通语法／死循环／外链警告一律阻断进人工队列，会造成人工审核积压，反之若放行超限未检完文件（`CHECKER-LIMIT`）则形成漏检；此外，允许合法标签／文本含 `U+0000` 在 SQLite FTS5 中会触发 C 字符串截断导致线上与离线搜索索引不一致，预装载与最终停写之间的增量变更及公开图下架亦需要确定性的顺序保障。

---

## 决策

### 1. 双桶 R2 CDN 客户端分发与 `client_channels` 原子推进

- **统一公开桶镜像**：复用公开资源桶 `workshop-img-staging`（`assets-staging.poem-of-destiny.3378469.xyz`）与 `workshop-img-prod`（`assets.poem-of-destiny.3378469.xyz`）同时分发公开图片副本与酒馆客户端 bundle；早期独立封面试点桶 `workshop-covers-*` 退役删除。私有桶 `workshop-client-*` 继续保留相同键以支撑 Worker `/client/*` 路由回退。
- **严格发布顺序与缓存头**（[`publish.mjs`](../../../apps/tavern-client/scripts/publish.mjs)）：
  1. 通过 R2 S3 SigV4 上传版本化对象 `client/v/<sha>/index.js` 至私有桶与公开桶（公开桶 `Cache-Control: public, max-age=31536000, immutable`）；
  2. 上传频道入口 `client/<channel>/index.js` 至私有桶与公开桶（公开桶 `Cache-Control: public, max-age=300`）；
  3. 最后在 D1 对 `site_settings` 的 `client_channels` 行执行单条 `INSERT ... ON CONFLICT(key) DO UPDATE SET value = json_set(...)` 原子写入，既保留兄弟频道（`stable`／`staging`），又确保 `/api/v1/client/compatibility` 要求某版本时对应脚本必定已可拉取。

### 2. 跨站内嵌 OAuth 弹窗 `launch/bind` 与 `Partitioned` 双层绑定

- **双层绑定签发**（[`auth.ts`](../../../apps/worker/src/http/routes/auth.ts)）：`POST /api/v1/auth/flows` 在 HTTPS 下同时写入顶层第一方 `__Host-cw_oauth_binding`（`SameSite=Lax; Secure`）与跨站分区 `cw_oauth_binding_p`（`Path=/api/v1/auth; HttpOnly; Max-Age=600; SameSite=None; Secure; Partitioned`），并通过响应头 `x-oauth-binding` 将绑定令牌返回给同源工坊前端（严禁加入 `Access-Control-Expose-Headers`）。
- **同源弹窗第一方植种**（[`useWorkshopSession.ts`](../../../apps/worker/web/src/shell/useWorkshopSession.ts)）：内嵌页不让弹窗直接打开 Discord，而是先打开工坊自身顶层页 `GET /api/v1/auth/flows/:id/launch`；弹窗校验 `window.opener` 并在精确 `location.origin` 上完成 `cw:oauth-launch-ready` → `cw:oauth-launch-bind` 握手后，在第一方上下文调用 `POST /api/v1/auth/flows/:id/bind` 核验 `browser_binding_hash`、植种顶层 `__Host-cw_oauth_binding` cookie，再 `location.replace` 跳转 Discord 授权页。
- **回调与兑换闭环**：Discord 跳回顶层 `/api/v1/auth/callback` 时校验顶层绑定 cookie；随后内嵌 iframe 轮询 `GET /api/v1/auth/flows/:id` 或调用 `POST /api/v1/auth/flows/:id/redeem` 时携带分区 cookie `cw_oauth_binding_p` 完成同一浏览器身份闭环。

### 3. 兼容 TavernHelper 同源子 iframe 的宿主桥接校验

- **受控放宽消息源**（[`install-bridge.ts`](../../../apps/worker/web/src/lib/install-bridge.ts)、[`useHostMessages.ts`](../../../apps/worker/web/src/features/installed/useHostMessages.ts)）：`isTrustedHostSource(event.source, expectedHost)` 在 `event.source === expectedHost`（`window.parent`）之外，允许 `event.source` 为父窗口的同源子 frame（`(event.source as Window).parent === expectedHost`）。跨域非同源子 frame 访问 `.parent` 抛出的 `SecurityError` 由 `try/catch` 捕获并拒绝（fail closed）。
- **多层防御不变**：仍强制要求精确 `event.origin === hostOrigin`（拒绝 `*` 或 `null`）、随机 `requestId` 关联匹配以及 `isValidBridgeResult`／`isInstallScan` 运行时载荷结构校验。现行协议规范见 [宿主协议](../../../docs/reference/host-protocol.md#连接与信任边界)。

### 4. Checker 威胁门禁、98 对象 FTS 净化与两阶段切换守卫

- **Checker 自动发布威胁边界**（[`report.mjs`](../../../packages/content/src/ejs-checker/report.mjs)、[`content-checker.ts`](../../../apps/worker/src/content-checker.ts)）：只有具备数据外带／动态代码执行能力的高危规则（`M1–M4`）、破坏工坊作用域隔离公约的规则（`L1–L7`）以及检查未完整执行的规则（`FILE`、`CHECKER-LIMIT`、`CHECKER-INTERNAL`）路由为 `block` 转交人工审核；玩家可通过卸载模组自行恢复的语法错误、潜在死循环、外链与 API 提示（`M5`、`EJS-PARSE`、`JS-PARSE`、`U2–U5`、`API1–API2`、`AH1–AH4`）统一保持 `warn`，允许自动发布并在详情页透明披露警告。
- **98 对象基线与 FTS `char(0)` 净化**（[`0001_initial.sql`](../../../apps/worker/migrations/0001_initial.sql)、[`verify-release-schema.py`](../../../.github/scripts/verify-release-schema.py)）：将三张公开图片副本表收口并入上线前唯一空库基线 `0001_initial.sql`（共 98 个 schema 对象），由发版工作流动态只读比对远端 D1；在不篡改业务表原始文本的前提下，所有 FTS 写入触发器与离线重建统一执行 `replace(..., char(0), ' ')`，彻底消除 SQLite FTS5 的 NUL 截断差异。
- **两阶段 `preload`／`delta` 与备份安全**（[`bound_preload.py`](../../../tools/migrate/bound_preload.py)、[`d1_delta.py`](../../../tools/migrate/d1_delta.py)、[`verify-production-backup.yml`](../../../.github/workflows/verify-production-backup.yml)）：支持上线前对绑定目标库执行带 Time Travel 书签与写配额记账的 `preload`，正式停写后由 `d1_delta.py` 生成按批在内存 SQLite 预演校核外键、行摘要与 FTS 一致性的增量 SQL（超 30 KB 大文本按 BLOB 分片组装），并输出 `delta-withdrawals.json` 确保被撤回公开图片先删 R2 源对象再推进 D1 且永不复用旧键；生产备份校验在 Python `sqlite3` 中禁用 `SQLITE_ATTACH`／`SQLITE_DETACH` 并强制校验核心业务表存在。

---

## 考虑过的替代方案

1. **移除回调端浏览器绑定 cookie 校验以迁就跨站 iframe**：拒绝。去掉绑定校验会重新敞开跨浏览器登录 CSRF／会话固定攻击面；通过同源顶层 `launch/bind` 显式桥接绑定令牌，无需削弱安全模型即可兼容 CHIPS 分区。
2. **接受同 `hostOrigin` 下任意 `event.source` 的 `postMessage`**：拒绝。同一来源若有无关弹窗或其他嵌入窗口不应自动获得宿主桥接响应权；限定 `window.parent` 或其直接子 frame 最小化了信任面。
3. **将 `M5`、`EJS-PARSE`、`JS-PARSE` 等全部设为 `block` 强制人工审核**：拒绝。二创作者调试中的普通模板语法问题或局部循环不会跨出客户端形成凭据外泄，玩家卸载即可恢复，全量转人工会拖慢正常发布并稀释审核员对真实高危脚本（`M1–M4`）的注意力。
4. **在 API 入口全局禁止 `U+0000` 或静默改写业务 JSON**：拒绝。既有标签与文本契约允许任意 Unicode code point 且要求原样保存；仅在派生搜索索引投影层把 `char(0)` 映射为空格即可保持存储无损与索引一致。

---

## 后果与风险

- **R2 与 D1 跨服务非原子性**：客户端双桶上传先于 D1 `json_set`，若中途网络中断可能留下未被频道引用的 R2 对象，但不会破坏线上正在运行的客户端兼容性门禁；重试幂等安全。
- **跨站弹窗依赖 `window.opener`**：若用户浏览器插件强制剥离同源弹窗的 `opener`，`launch` 页会明确提示连接失败并可回退设备码／手动流程，不会静默卡死。
- **真实宿主最终确认**：虽然 workerd、Chromium E2E 与 `staging` 自动发版均已通过，跨站 CHIPS 分区与 TavernHelper 子 iframe 仍须在真实 SillyTavern 宿主与真实 Discord 账号下做上线前人工确认（见 [`user-actions.md`](../../../docs/plans/refactor-2026-10/user-actions.md)）。

---

## 验证要求

1. `pnpm check` 全链路通过（含严格 Knip unused/cycles、架构与数据边界检查、Biome 零警告、全包 TypeScript 类型检查、Worker／Domain／Content／Tavern Client 单测与集成测试、98 对象 schema 校验、含 `test-cutover-delta.py` 在内的 **7 套 Python 迁移与增量测试**、含非 ASCII 路径的备份校验测试、Wrangler dry-run 与 bundle 预算）。
2. Worker 认证测试（[`auth-oauth.test.ts`](../../../apps/worker/test/auth-oauth.test.ts)）覆盖 `x-oauth-binding` 不暴露给跨源、`cw_oauth_binding_p` 分区属性、`/flows/:id/launch` 与 `/flows/:id/bind` 正常绑定及错配／过期拒绝；宿主桥接与客户端测试覆盖 `isTrustedHostSource` 同源子 frame 放行、跨源异常拒绝及非法载荷拦截；Checker 测试（[`rules.test.mjs`](../../../packages/content/test/rules.test.mjs)）覆盖 `M1–M4`、`L1–L7` 与 `FILE`／`CHECKER-LIMIT`／`CHECKER-INTERNAL` 门禁阻断及 `warn` 分流。
3. GitHub Actions `deploy-staging` 在 `d7deb9d` 跑通线上 98/98 schema 校验、Worker 部署、双桶客户端发布与 smoke 验收；`workshop-staging-migrate-977ebb415bf6` 与 `workshop-prod` 均完成五分类 + 98/98 对象预装载对账。

---

## 影响范围

- 客户端分发与配置：`apps/tavern-client/scripts/publish.mjs`、`apps/worker/wrangler.jsonc`、`.github/workflows/deploy-staging.yml`、`.github/workflows/deploy-production.yml`、`.github/scripts/verify-release-schema.py`。
- 跨站 OAuth 与宿主桥接：`apps/worker/src/http/routes/auth.ts`、`apps/worker/web/src/api.ts`、`apps/worker/web/src/shell/useWorkshopSession.ts`、`apps/worker/web/src/lib/install-bridge.ts`、`apps/worker/web/src/features/installed/useHostMessages.ts`。
- 内容检查与迁移／备份门禁：`packages/content/src/ejs-checker/report.mjs`、`apps/worker/src/content-checker.ts`、`apps/worker/migrations/0001_initial.sql`、`tools/migrate/bound_preload.py`、`tools/migrate/d1_delta.py`、`tools/migrate/test-cutover-delta.py`、`.github/workflows/verify-production-backup.yml`。
- 权威参考与运维文档：[`docs/reference/worker-api.md`](../../../docs/reference/worker-api.md)、[`docs/reference/host-protocol.md`](../../../docs/reference/host-protocol.md)、[`docs/operations/deployment-safety.md`](../../../docs/operations/deployment-safety.md)、[`docs/operations/legacy-data-migration.md`](../../../docs/operations/legacy-data-migration.md)。

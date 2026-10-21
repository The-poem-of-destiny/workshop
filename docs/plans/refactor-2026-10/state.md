# 当前状态（2026-10-21）

会话交接记录，不是决策源。决策以 [`decisions.md`](decisions.md) 为准，架构与迁移以 [`main.md`](main.md) 为准。

## 当前分支

`refactor/2026-10`（本地，未 push）。最新 checkpoint `92e2f0b`。

## 2026-10-21 续作

- W12 客户端、W13/W14 分发、W16 元数据、W18 cron、W19 生命周期/索引、W20 Web 作者/审核/管理、W17 管理写接口已提交。
- `pnpm check` 绿；worker 64、domain 17、content 7、tavern-client 4。
- `pnpm e2e:local` 16/16，含 5 条真实 Chromium 旅程：匿名搜索/排序/作者筛选/详情、作者工作台+订阅、owner 管理、审核通过、审核拒绝理由。
- staging D1 已应用 0002–0008；Worker 版本 `95b88ae4-7311-402c-a41f-1a2bc5879ba3`，commit `17d97cb`。
- staging 远程 smoke 已通过：health/list/discovery/root/reference-sets/site/home 200，Origin 拒绝 403，client compatibility 200；`client/stable/index.js` 已发布 `0.1.1`（`3eb417a1…`）并可下载。
- W21/W24 仍被 Q-05/Q-06/Q-10 阻塞；W23 R2 适配器已完成，真实数据导入与生产 cutover 未做。

## 已有实现（不等于验收完成）

### P0 基线

- 旧路由/权限/数据/测试盘点：`archive/p0-baseline.md`。
- 匿名公开 API 样本与抓取脚本已从当前树删除；需要时从 git 历史或 `workshop-legacy` worktree 恢复。

### P3 写路径

- identity：`POST /api/v1/auth/flows`（Origin 白名单、D1 flow、无 token 返回）、`GET /api/v1/auth/flows/:id`、`GET /api/v1/me`、`DELETE /api/v1/sessions/current`。
- interactions：`GET /api/v1/me/state`，`PUT/DELETE /api/v1/me/likes/:id`、`subscriptions/:id`、`ratings/:id`；幂等，评分仅本人可见。
- authoring：创建项目、CAS 更新、不可变 revision、R2 上传（sha256/大小）、提交；`If-Match` 412、非作者 403/404。
- admin：提交队列/详情、审批（单 batch 切 published 指针，无 R2 复制）、拒绝、项目/成员列表、角色变更（bump session version、最后 owner 保护）。
- 作者私有详情：`GET /api/v1/projects/:id/draft`，仅作者/owner 可读 working revision 摘要；非作者 404。
- 新增 `@workshop/domain`：taxonomy、内容策略、上传上限。
- 新增公开读/写测试通过；P3 路由已接入 `app.ts`。

### Web UI / 下载计数

- React + Vite 最小可用页面：`apps/worker/web`，消费 `/api/v1/home` 与 `/api/v1/projects`；卡片 16:9、4/3/2/1 响应式、搜索/排序/详情侧栏。
- 构建产物 `web/dist` 不提交；`check:wrangler` 先构建。
- `POST /api/v1/projects/:id/downloads`：登录后原子增加 `downloads_count` + 日指标；文件 GET 仍 `private, no-store`。

### 独立复审修复

- P1：已提交/已发布 revision 冻结，上传要求 working + unpublished + 无 submission；R2 key 内容寻址。
- P2：全局安全头中间件提前注册；`/auth/flows` 改用 `Origin` 头并要求非空；审核者可直接读取 pending submission 文件；下载计数改为 per-user/day 幂等 + DB trigger；短搜索保留 FTS 短索引；上传要求 Content-Length + MIME 白名单；封面按项目可见性授权；manifest hash 在 submit 时计算并绑定；作者可提交 schemaVersion/Discord URL；角色变更写审计并带 actor；最后 owner 检查改为条件更新。
- P1/P2：迁移 CLI 入口判断修复（CJK 路径）；`--since` 保留完整项目组与 published 指针；verify 期望值改为源数据推导；迁移测试接入 `pnpm check`。
- 第二轮复审：审核审计绑定本批次 `reviewId`，失败请求不再写假审计；资产写入改为条件 INSERT，堵住 submit 后的 check-then-act 替换；迁移任务的 working 指针取最新 draft，只保留一条 rejected；迁移保留 `submitted_by`/`reviewer_id`/`curator_id`，审计事件不再按事件 id 造幽灵用户；补充对应回归测试。

### P4 迁移工具

- `tools/migrate/`：extract/transform/load/verify/reconcile/all，支持 `--source`、`--target`、`--dry-run`、`--since`。
- 稳定排序/固定 id 保证幂等；对账检查数量、指针、sha256、FK、重复 id、pending 唯一。
- `load-local.mjs` 已把 target 导入隔离本地 D1；`r2-copy.mjs` 提供 manifest、本地演练、SHA/bytes 校验、幂等重跑、损坏修复与 remote `--apply`。
- 文档：`archive/p4-migration.md`。

### P5/P6

- 本地 P5 演练：本地 D1 migration 59 条命令成功；`pnpm e2e:local` 10/10；实际 Chromium 首页读到 E2E 项目；health/list/root/auth-Origin 冒烟通过。
- 真实备份 P4：`from_d1_sql.py` 导出 7 表 + 935 资产；全量两次字节一致；verify/reconcile 全过；`--since 2026-09-01` delta 通过（20 项目 / 32 revision / 69 资产 / 134 用户）。`load-local.mjs` 导入隔离本地 D1 后，列表/详情/搜索/首页正常；104 条 worldbook 与 10 likes/9 subscriptions 计数正确。
- Staging：`workshop-staging` D1 远程 migration 成功；Worker `cba07328-3c24-4c70-9cd6-10a162e3ac2d` 部署成功；health/list/root/Origin 冒烟通过。未导入真实备份；200 次 health/list 冒烟 0 个 5xx；回滚/恢复演练已通过。
- P6 已删除 `cloudflare/`、`tests/e2e/`、`playwright.config.mjs`、`scripts/deployment/`、旧配置检查脚本、`test-bundles/` 与提交的 `dist/`；客户端需要的版本/内容工具移入 `packages/domain`。
- `archive/p5-cutover.md`：本地/staging 演练 + 生产 runbook + 回滚 + stop conditions。
- `archive/p6-cleanup.md`：旧代码/表/产物/测试删除顺序与零引用验证；保留项已记录。

### P2 读路径

- 公开读：`GET /api/v1/projects`（limit/cursor/sort/type/search）、`GET /api/v1/projects/:id`、`GET /api/v1/home`、`GET /api/v1/recommendations`、`GET /api/v1/reference-sets`、`GET /api/v1/site`。
- 中文搜索：trigram + 1–2 字短索引，走 D1 FTS。
- 登录后安装：`GET /api/v1/projects/:id/releases/:releaseId/manifest`、`.../files/:kind`；session 查库、过期/撤销校验。
- 公开封面：`GET /api/v1/assets/*`，只允许 `covers/`、`banners/`。
- 集成测试：workerd + D1/R2，覆盖列表、搜索、详情、私有 404、manifest/files、home/recommendations/references/banner。

### P1 基础

- pnpm workspace：`apps/*`、`packages/*`。
- `@workshop/contracts`：zod 错误、health、identity、project 契约。
- `apps/worker`：
  - Hono 骨架、`/api/v1/health`、`/api/*` JSON 404、非 API 文本 404。
  - 统一错误响应、安全头、`private, no-store`。
  - strict TypeScript、`@cloudflare/vitest-plugin`、workerd D1/R2 冒烟测试。
  - `wrangler.jsonc`：Static Assets（`web/dist`）、D1/R2、staging/production 环境。
- `packages/contracts` 严格类型检查。
- 初始 D1 schema：`apps/worker/migrations/0001_initial.sql`，含 FTS trigram + 1–2 字短索引、外键、pending 唯一约束。
- 单入口 `pnpm check`：workspace、typecheck、test、schema、wrangler dry-run。
- CI：`.github/workflows/refactor-ci.yml`。
- 压缩配置：`.omp/config.yml`，50% 阈值，`handoff/shake/soft` 文本路径，关闭 snapcompact 视觉。

## 独立完成度审计（2026-10-21）

两份只读审计报告：

- `docs/audits/features-audit-a.md`：features §1–6、§13 与 checker 规则内容。
- `docs/audits/features-audit-b.md`：features §7–12、decisions、API/schema/cache/ops。
- `docs/audits/features-audit-merged.md`：去重后的完成度结论与 P0–P4 任务清单。

结论：此前的“已完成 P1–P6”表述过强，不能作为交付依据。审计发现：

- features §1–6/§13 只有账号角色/会话撤销、项目创建、两态可见性等少数项真正闭环；checker 规则、DO 权威复核、自动发布、审核绑定整体缺失。
- features §7–12 为 8 done / 12 partial / 14 missing；decisions 为 6 done / 18 partial / 9 missing。
- 高优先级缺口：`/client/*` 无处理器与版本门禁；无 cron/榜单；无 Workers Cache；无管理端 site/audit/reference/recommendation 写接口；项目版本标签字段缺失；1–2 字搜索仍走 LIKE；内容策略未接入上传/提交；Web 排序 tab 默认页无效；旧客户端仍指向已删除的 `/api/projects`、`/api/files`。
- Checker 旧规则内容（L1–L7、M1–M5、U2–U5、API1–API2、AH1–AH4、EJS/JS-PARSE、预算）在当前 `apps/`/`packages/` 中不存在；`util/ejs-checker-v2.js` 只是无法重建的死产物。

在这些缺口关闭前，不应把 P3/P5/P6 视为可生产切换。

## 当前线上

- staging：`https://workshop-staging.poem-of-destiny.workers.dev`，active Worker `95b88ae4-7311-402c-a41f-1a2bc5879ba3`（commit `17d97cb`），D1 0001–0008 已应用；上一版 `a456be5e-f62a-4c15-9d52-5239e2dc4c20` 可回滚。
- production：`https://workshop.poem-of-destiny.workers.dev`，未部署；真实生产切换留人工审批。
- 本轮未 push。

## 待办

- 独立完成度审计：`docs/audits/features-audit-merged.md`；结论非 CLEAN，按 `checklist.md` 继续。
- P3：OAuth callback/redeem/device/公会校验已实现；真实 Discord 握手仍缺 client secret。
- P4：真实备份全量/两次/delta/对账与隔离本地 D1 load 已完成；R2 复制适配器已实现，真实导入未执行。
- P5：本地与 staging 部署已完成；staging 回滚/恢复演练与 5xx 冒烟已完成；真实生产切换仍留人工审批。
- P6：`cloudflare/`、旧客户端 `src/`、`util/`、`config/`、`test-dist/` 与旧 webpack 构建链已移出当前工作树；旧版本保存在本地 worktree `../workshop-legacy`（`4fdf71a`）仅作对照。客户端需按 checklist 重写，不再从当前树构建。
- Web UI：公开列表/详情、Discord 登录、作者工作台、审核台、owner 管理已接入；分页/作者筛选/订阅列表仍缺。
- 真实 SillyTavern / Tavern client 验证未做（本机无运行中的 SillyTavern，按 stop condition 记录）。
- W23：R2 批量复制适配器已实现并有本地演练；真实数据导入与独立 reconcile 仍需授权目标。

## 停止条件 / 阻塞

- 真实 Discord OAuth 握手：callback/redeem/device 代码与本地负例已完成，缺 client secret 与真实公会数据；不伪造登录。
- Checker：`ContentService` 与移植规则已完成；真实语料扩充仍可继续，但不是当前阻塞。
- 真实 SillyTavern 验证：本机无运行中的 SillyTavern；已按 stop condition 停止该项，不用 mock 冒充。
- R2 真实导入：适配器已完成本地演练；未把真实备份导入 staging，需授权目标桶与源桶。
- 旧客户端 / `test-dist` shim：已从当前工作树移出，旧快照在 `../workshop-legacy`；新客户端 `apps/tavern-client` 已实现，真实 ST 旅程未验证。

## 已知约束

- `data_backup/` 已加入 `.gitignore`；P4 前不读取。
- 不 push、不部署生产、不操作真实生产 D1/R2/Cloudflare 资源。
- 每个切片本地 commit；commit 使用 aoo / lxxxaoo@users.noreply.github.com。
- Q-05、Q-06、Q-10 未定，不自行发明。

## 新会话先读

1. `AGENTS.md`
2. `.agents/skills/autonomous-refactor/SKILL.md`
3. `checklist.md`
4. `decisions.md`
5. `main.md`
6. `archive/p0-baseline.md`
7. 本文件

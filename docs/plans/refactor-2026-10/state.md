# 当前状态（2026-10-21）

会话交接记录，不是决策源。决策以 [`decisions.md`](decisions.md) 为准，架构与迁移以 [`main.md`](main.md) 为准。

## 当前分支

`refactor/2026-10`（本地，未 push）。

## 已完成

### P0 基线

- 旧路由/权限/数据/测试盘点：`p0-baseline.md`。
- 匿名公开 API 样本：`tests/fixtures/legacy/`（16 个响应 + manifest）。
- 抓取脚本：`tools/p0-capture.mjs`。

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
- 当前 `load` 只写本地 JSON；真实 D1/R2 适配器等 `data_backup` 与审批。
- 文档：`p4-migration.md`。

### P5/P6

- 本地 P5 演练：本地 D1 migration 59 条命令成功；`pnpm e2e:local` 10/10；实际 Chromium 首页读到 E2E 项目；health/list/root/auth-Origin 冒烟通过。
- 真实备份 P4：`from_d1_sql.py` 导出 7 表 + 935 资产；全量两次字节一致；verify/reconcile 全过；`--since 2026-09-01` delta 通过（20 项目 / 32 revision / 69 资产 / 134 用户）。`load-local.mjs` 导入隔离本地 D1 后，列表/详情/搜索/首页正常；104 条 worldbook 与 10 likes/9 subscriptions 计数正确。
- Staging：`workshop-staging` D1 远程 migration 成功；Worker `cba07328-3c24-4c70-9cd6-10a162e3ac2d` 部署成功；health/list/root/Origin 冒烟通过。未导入真实备份；200 次 health/list 冒烟 0 个 5xx；回滚/恢复演练已通过。
- P6 已删除 `cloudflare/`、`tests/e2e/`、`playwright.config.mjs`、`scripts/deployment/`、旧配置检查脚本、`test-bundles/` 与提交的 `dist/`；客户端需要的版本/内容工具移入 `packages/domain`。
- `p5-cutover.md`：本地/staging 演练 + 生产 runbook + 回滚 + stop conditions。
- `p6-cleanup.md`：旧代码/表/产物/测试删除顺序与零引用验证；保留项已记录。

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

## 当前线上

- staging：`https://workshop-staging.poem-of-destiny.workers.dev`，已部署新 Worker `cba07328-3c24-4c70-9cd6-10a162e3ac2d`，D1 `0001_initial.sql` 已应用；已演练回滚到 `4ab78a2`（version `bbd12fac-6dc3-483a-a03f-c74b77bb7714`）并恢复。
- production：`https://workshop.poem-of-destiny.workers.dev`，未部署；真实生产切换留人工审批。
- 本轮未 push。

## 待办

- 独立 evaluator：Worker 与迁移/E2E 工具链最终复审均 CLEAN；无未解决发现。
- P3 缺口：真实 Discord OAuth callback/redeem（当前只有 flow 创建/状态，PKCE challenge 可选）；内容 checker DO。
- P4：真实备份全量/两次/delta/对账与隔离本地 D1 load 已完成；R2 对象复制适配器仍未实现。
- P5：本地与 staging 部署已完成；staging 回滚/恢复演练与 5xx 冒烟已完成；真实生产切换仍留人工审批。
- P6：`cloudflare/` 已删除；`test-dist` shim 与旧客户端保留到客户端迁移/下架窗口。
- Web UI：已有最小列表/详情页；登录、上传、审核后台未接入。
- 真实 SillyTavern / Tavern client 验证未做（本机无运行中的 SillyTavern，按 stop condition 记录）。

## 停止条件 / 阻塞

- 真实 Discord OAuth callback/redeem：缺 Discord client secret，当前只有 flow 创建/状态；不伪造登录。
- `ContentService` DO + 权威 checker：仓库没有 review checker 实现与 revision 语料，无法在不发明规则的情况下补齐 D-31。
- 真实 SillyTavern 验证：本机无运行中的 SillyTavern；已按 stop condition 停止该项，不用 mock 冒充。
- R2 对象复制适配器：本地 D1 已完成 load；未实现批量 R2 复制，也未把真实备份导入 staging。
- `test-dist` shim / 旧客户端：按计划保留下架窗口，不在本轮删除。

## 已知约束

- `data_backup/` 已加入 `.gitignore`；P4 前不读取。
- 不 push、不部署生产、不操作真实生产 D1/R2/Cloudflare 资源。
- 每个切片本地 commit；commit 使用 aoo / lxxxaoo@users.noreply.github.com。
- Q-05、Q-06、Q-10 未定，不自行发明。

## 新会话先读

1. `AGENTS.md`
2. `.agents/skills/autonomous-refactor/SKILL.md`
3. `decisions.md`
4. `main.md`
5. `p0-baseline.md`
6. 本文件

# 当前状态（2026-10-21）

会话交接记录，不是决策源。决策以 [`decisions.md`](decisions.md) 为准，架构与迁移以 [`main.md`](main.md) 为准。

## 当前分支

`refactor/2026-10`（本地，未 push）。

## 已完成

### P0 基线

- 旧路由/权限/数据/测试盘点：`p0-baseline.md`。
- 匿名公开 API 样本：`tests/fixtures/legacy/`（16 个响应 + manifest）。
- 抓取脚本：`tools/p0-capture.mjs`。

### P1 基础

- pnpm workspace：`apps/*`、`packages/*`。
- `@workshop/contracts`：zod 错误、health、identity、project 契约。
- `apps/worker`：
  - Hono 骨架、`/api/v1/health`、`/api/*` JSON 404、非 API 文本 404。
  - 统一错误响应、安全头、`private, no-store`。
  - strict TypeScript、`@cloudflare/vitest-plugin`、workerd D1/R2 冒烟测试。
  - `wrangler.jsonc`：Static Assets（`web/public`）、D1/R2、staging/production 环境。
- `packages/contracts` 严格类型检查。
- 初始 D1 schema：`apps/worker/migrations/0001_initial.sql`，含 FTS trigram + 1–2 字短索引、外键、pending 唯一约束。
- 单入口 `pnpm check`：workspace、typecheck、test、schema、wrangler dry-run。
- CI：`.github/workflows/refactor-ci.yml`。
- 压缩配置：`.omp/config.yml`，50% 阈值，`handoff/shake/soft` 文本路径，关闭 snapcompact 视觉。

## 当前线上

- staging：`https://workshop-staging.poem-of-destiny.workers.dev`
- production：`https://workshop.poem-of-destiny.workers.dev`
- 线上仍是旧系统；本轮未 push、未部署。

## 待办

- P2 读路径：projects list/detail/home/recommendations/reference sets、install manifest/files。
- P3 写路径：identity/session、revision、upload、submit/review/publish、interactions、admin。
- P4 迁移：`data_backup` 的 extract/transform/load/verify + 对账（P4 前不读取）。
- P5 切换：本地/staging 演练 + 生产 runbook；真实生产切换留人工审批。
- P6 清理：删除清单执行、旧路径零引用。
- 独立 evaluator：每个切片连续两轮零发现。

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

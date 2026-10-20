# 当前状态（2026-10-21）

会话交接记录，不是决策源。决策以 [`decisions.md`](decisions.md) 为准，架构与迁移以 [`main.md`](main.md) 为准。

## 已完成

- 旧仓镜像、路径裁剪、新仓 `The-poem-of-destiny/workshop` 推送完成；旧仓未改。
- 方案文档：`main.md`、`features.md`、`patch-audit.md`、`decisions.md`、`brief.md`。
- Cloudflare 资源：
  - D1 `workshop-staging`、`workshop-prod`
  - R2 `workshop-client-staging`、`workshop-client-prod`
- GitHub：
  - `staging` / `production` environments
  - `CLOUDFLARE_API_TOKEN` secrets 已填
  - `STAGING_URL` / `PRODUCTION_URL` 已填
  - `main` 分支保护、`v*` tag 保护
- Worker 骨架：
  - `workshop-staging`
  - `workshop`（production，已去掉 `-prod` 后缀）
  - 旧 `workshop-prod` / `workshop-production` 已删除
- 部署 workflow：
  - `deploy-staging.yml`：push `main` 自动部署 + smoke
  - `deploy-production.yml`：tag `v*` + environment 审批
- staging 首次自动部署已通过（run `39466481870`）。
- workshop 技能：
  - `.agents/skills/project-basics/SKILL.md`
  - `AGENTS.md` 已记录技能路径
  - omp 通过内置 `agents` provider 发现，无需 `.omp/config.yml`

## 当前线上

- staging：`https://workshop-staging.poem-of-destiny.workers.dev`
- production：`https://workshop.poem-of-destiny.workers.dev`
- 当前 Worker 只有 `/api/v1/health` 与 JSON 404 骨架。

## 待办

- P1：Hono、`packages/contracts`、`0001_initial.sql`、D1/R2 读写、CI 检查。用户要求之后一起做。
- 数据迁移：旧 D1/R2 导出、转换、对账、一次性切换。
- 生产首次发布：打 `v*` tag，走 environment 审批。
- D1/R2 名称仍是 `workshop-prod` / `workshop-client-prod`；是否去后缀待定。

## 新会话先读

1. `AGENTS.md`
2. `docs/plans/refactor-2026-10/decisions.md`
3. `docs/plans/refactor-2026-10/main.md`
4. `docs/plans/refactor-2026-10/features.md`
5. 本文件

## 注意

- `.env` 含 Cloudflare token，已 gitignore；不要打印或提交。
- 生产只走 tag + environment 审批，不用本地 token 直接发。
- 当前会话结束后，新会话不会继承对话上下文；以上文件是交接依据。

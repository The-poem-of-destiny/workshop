# 命定创意工坊

这是「命定之诗与黄昏之歌」的**创意工坊**独立仓库。

当前工作树只保留新后端与新 Web：

- **Cloudflare Worker 后端**：项目读取、作者写路径、人工审核、发布、互动与文件分发；
- **Web 站点**：React + Vite 的公开列表/详情页。

酒馆客户端（`src/CreativeWorkshop`）、旧首页、旧 checker bundle、`test-dist` shim 和旧构建链已从本工作树移除。旧实现完整保存在 git 历史与本地 legacy worktree `../workshop-legacy`（基于 `4fdf71a`），仅用于对照，不参与构建。客户端迁移状态见 `docs/plans/refactor-2026-10/checklist.md`。

## 仓库结构

```text
workshop/
├─ apps/worker/              # 唯一后端：Hono + D1 + R2 + Static Assets
│  ├─ migrations/            # D1 结构演进（唯一迁移序列）
│  ├─ src/                   # API 与存储层
│  └─ web/                   # 公开站点（React + Vite）
├─ packages/contracts/       # 共享 Zod 契约与类型
├─ packages/domain/          # 分类、内容策略、限额、版本等纯函数
├─ data/                     # 官方角色卡基线数据
├─ tools/                    # workspace/schema 校验、迁移与本地 E2E
├─ docs/plans/refactor-2026-10/  # 决策、功能清单、checklist、状态、归档
└─ tests/fixtures/legacy/    # 旧公开接口匿名响应样本
```

`cloudflare/`、`src/`、`util/`、`config/`、`test-dist/` 和旧 webpack 构建链已删除；不要在当前工作树重新引入旧实现。

## 后端

唯一 Worker 位于 [`apps/worker/src/index.ts`](apps/worker/src/index.ts)，技术栈为 Cloudflare Workers + Hono，数据存储为 D1，文件存储为 R2，静态站点通过 Static Assets 提供。

- 公开读取：首页、项目列表/详情、推荐、参考集、站点信息；
- 登录后读取：发布清单、文件下载；
- 作者：创建、编辑、上传、提交审核；
- 审核：待审队列、发布指针切换、成员角色、审计；
- 互动：点赞、订阅、评分、按用户/项目/日幂等的下载计数。

接口以 `/api/v1` 为前缀。契约在 `packages/contracts`，领域规则在 `packages/domain`。

当前完成度不是“可上线”：checker、OAuth 登录闭环、客户端分发、管理端写接口、cron/cache 等仍未完成，见 `docs/plans/refactor-2026-10/checklist.md` 与 `docs/audits/features-audit-merged.md`。

## 本地开发

根目录使用 pnpm：

```text
pnpm install
pnpm build                 # 构建 apps/worker/web 静态资源
pnpm dev                   # 本地 Worker
pnpm check                 # workspace、类型、测试、schema、迁移测试、wrangler dry-run
pnpm e2e:local             # 真实 workerd + 本地 D1/R2，10 条 HTTP E2E
```

本地 D1：

```text
cd apps/worker
pnpm exec wrangler d1 migrations apply workshop-staging --local --config wrangler.jsonc
```

## 部署

Git 仓库与 Cloudflare 运行时是两套独立状态。部署前必须记录被部署的确切提交 SHA，并在部署后单独验证 Worker 版本；推送代码不等于部署。

- 配置与绑定：`apps/worker/wrangler.jsonc`
- 部署前：`pnpm check`，并先执行 `pnpm build`
- 迁移：`wrangler d1 migrations apply <database> --remote --config apps/worker/wrangler.jsonc`
- 旧备份：`python3 tools/migrate/from_d1_sql.py <dump.sql> <r2-dir> <临时输出目录>`，再用 `tools/migrate/cli.mjs` 执行/校验/对账
- 密钥只通过 `wrangler secret put` 写入，不进入仓库

## 许可证

本仓库原创内容采用 [`CC BY-NC-SA 4.0`](LICENSE) 授权。第三方接口、平台服务及其素材不因本仓库授权而改变原有许可，使用者需自行遵守对应条款。

# 命定创意工坊

这是「命定之诗与黄昏之歌」的**创意工坊**独立仓库。

当前工作树包含一个 Cloudflare Worker（API + Web 静态托管）和酒馆客户端 bundle：

- **Cloudflare Worker 后端**：项目读取、作者写路径、人工审核、发布、互动与文件分发；同时通过 Static Assets 托管 Web 构建产物。
- **Web 站点**：React + Vite 的公开列表、详情与作者/审核界面。它不是独立服务，构建产物由上面的 Worker 同源提供，页面里的 `/api/v1` 请求也回到这个 Worker。
- **酒馆客户端**：安装、更新、卸载和内容基线桥接。

## 仓库结构

```text
workshop/
├─ apps/worker/              # 唯一后端：Hono + D1 + R2 + Static Assets
│  ├─ migrations/            # D1 结构演进（唯一迁移序列）
│  ├─ src/                   # API 与存储层
│  └─ web/                   # 公开站点与作者/审核界面（React + Vite）
├─ apps/tavern-client/       # 酒馆客户端 bundle 与官方角色卡基线
├─ packages/contracts/       # 共享 Zod 契约与类型
├─ packages/domain/          # 分类、内容策略、限额、版本等纯函数
├─ packages/content/         # EJS checker、内容审计与 bundle 产物
├─ tools/                    # workspace/schema 校验、迁移、备份校验与本地 E2E
├─ docs/                     # 当前知识、refactor 计划与审计
│  ├─ AGENTS.md              # 文档权威归属与写作规则
│  ├─ plans/refactor-2026-10/
│  └─ audits/
└─ .agents/                  # 项目级 Agent 规则、notes、skills 与共享规范
```

## 后端与客户端

唯一 Worker 位于 [`apps/worker/src/index.ts`](apps/worker/src/index.ts)，技术栈为 Cloudflare Workers + Hono，数据存储为 D1，文件存储为 R2，静态站点通过 Static Assets 提供。

- 公开读取：首页、项目列表/详情、推荐、参考集、站点信息；
- 登录后读取：发布清单、文件下载；
- 作者：创建、编辑、上传、提交审核；
- 审核：待审队列、发布指针切换、成员角色、审计；
- 互动：点赞、订阅、评分、按用户/项目/日幂等的下载计数；
- 客户端：版本化分发、安装/更新/卸载与基线校验；
- 缓存：项目列表/详情、发现、榜单使用 Workers Cache API，30 秒 TTL + `cache_epoch`；首页、推荐、参考集、站点当前直读 D1；作者、审核、下载等动态接口保持 `private, no-store`。详见 `docs/plans/refactor-2026-10/api-design.md`。

接口以 `/api/v1` 为前缀。契约在 `packages/contracts`，领域规则在 `packages/domain`，checker 与内容审计在 `packages/content`。

## 文档与 Agent

- 当前行为、契约、教程和参考：`docs/`
- refactor 计划、checklist、状态和决策：`docs/plans/refactor-2026-10/`
- 审计证据和报告：`docs/audits/`
- Agent Note、决策理由和讨论记录：`.agents/notes/`
- 可复用 Agent 流程：`.agents/skills/`
- 机器本地设置（Git 身份、机器路径）：`AGENTS.local.md`，不提交

文档归属和写作规则见 [`docs/AGENTS.md`](docs/AGENTS.md)；仓库级 Agent 规则见 [`AGENTS.md`](AGENTS.md)。

## 本地开发

根目录使用 pnpm，Node 版本见 `.nvmrc`（22）：

```text
pnpm install
pnpm exec playwright install chromium   # 本地 E2E 浏览器
pnpm build                 # 构建 apps/worker/web 静态资源
pnpm dev                   # 本地 Worker
pnpm format                # 写入格式化结果
pnpm check                 # format/lint、workspace、类型、测试、schema、迁移/备份测试、wrangler dry-run
pnpm e2e:local             # 真实 workerd + 本地 D1/R2 + Chromium E2E
```

本地 D1：

```text
cd apps/worker
pnpm exec wrangler d1 migrations apply workshop-staging --local --config wrangler.jsonc
```

客户端构建与发布脚本在 `apps/tavern-client/package.json`；checker 构建与发布脚本在 `packages/content/package.json`。

数据库结构以完整编号 migration 链为准，不以旧导出数据要求保留无用字段。当前导入工具只转换已选公开发布内容与必要 member 作者，重建 manifest 和完整条目索引；不会恢复旧管理员权限、会话、草稿、审核或互动历史，见 [`tools/migrate/README.md`](tools/migrate/README.md)。

`0021_remove_obsolete_state.sql` 会删除旧镜像字段、撤下未完成索引的历史发布并清理无用资产关联（保留 revision 和 R2 原文件）。远程执行前必须备份、确认影响与获得授权；本地通过不代表已经应用到 staging／production。

## 部署

部署由 GitHub Actions 执行；本地 `wrangler deploy` 只用于验证或故障处理，不作为发布依据。

- **CI**：`.github/workflows/ci.yml` 在相关路径 push/PR 时运行 `pnpm check` 和 `pnpm e2e:local`。
- **Staging**：`ci` 在 `main` 成功后，`.github/workflows/deploy-staging.yml` 自动触发；staging environment 只允许 `main`，没有额外 reviewer gate。流水线构建 Web artifact 并记录 SHA-256，然后执行 D1 migration、Worker 部署、记录 Worker version 和 health smoke。
- **Production**：推送 `v*` tag 触发 `.github/workflows/deploy-production.yml`；production environment 要求 1 名 reviewer，并只允许 `v*` tag。流水线查找该 commit 的 staging 成功记录，下载同一 Web artifact，审批后校验 SHA 与 artifact hash，再执行 migration、部署、记录 Worker version 和 health smoke。
- 生产发布必须使用 staging 已验证的同一 commit，不接受本地或其他分支的构建。staging artifact 现在包含 Web 静态资源、Worker bundle 与 Tavern client；production 下载并校验同一 artifact，再发布 stable client。
- Git 仓库与 Cloudflare 运行时是两套独立状态：推送不等于部署，部署后必须单独核对 Worker version。
- 密钥通过 GitHub Actions secrets 或 `wrangler secret put` 写入，不进入仓库。
- 生产 D1 不手工修改；schema 变更只通过 migration，并先在本地和 staging 验证。
- production migration 前自动导出 D1、记录 Time Travel bookmark，并上传到私有 R2 backup bucket；恢复步骤见 [`docs/operations/deployment-safety.md`](docs/operations/deployment-safety.md)。
- 备份完整性用 `.github/workflows/verify-production-backup.yml` 手动验证；它不修改生产数据库。

本地验证仍按上面的 `pnpm check` 和 `pnpm e2e:local` 执行。需要手工排查 migration 时使用：

```text
pnpm --filter @workshop/worker exec wrangler d1 migrations apply <database> --remote --config wrangler.jsonc --env <staging|production>
```

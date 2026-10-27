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

源码导航：[`apps/README.md`](apps/README.md)、[`packages/README.md`](packages/README.md)、[`tools/README.md`](tools/README.md)。按目录定位职责、边界与权威入口；编写及维护规则见 [`AGENTS.md`](AGENTS.md#directory-readmes)。

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

根目录使用 pnpm，Node 版本见 `.nvmrc`（22，最低 22.12.0）：

```text
pnpm install
pnpm exec playwright install chromium   # 本地 E2E 浏览器
pnpm build                 # 构建 apps/worker/web 静态资源
pnpm dev                   # 本地 Worker
pnpm format                # 写入格式化结果
pnpm check                 # 零警告 lint、检查覆盖、类型、测试、schema、迁移/备份、构建/dry-run、产物预算
pnpm e2e:local             # 真实 workerd + 本地 D1/R2 + Chromium E2E
```

### 程序性质量门禁

- `pnpm check:workspace` 从 workspace 声明发现包，要求每包有 typecheck/test 或在单一策略表中有明确豁免。新增包未分类、缺脚本及过期豁免均失败；`--if-present` 不再意味着可静默漏检。content 是 JavaScript；contracts 的 schema 由消费者测试覆盖，不保留空测试命令。
- `pnpm check:unused` 使用固定 Knip 6.43.0 检查全部 workspace 的依赖；入口覆盖 package exports、Worker、嵌套 Vite/CSS、自定义 esbuild、tools 与测试。`knip.jsonc` 仅为宿主 Cloudflare 模块和跨 workspace 命令保留有据例外；未用、未声明依赖均阻断。文件／导出维度只作人工审计，未作为持续门禁。
- `pnpm check:cycles` 复用同一个 Knip，静态运行时循环以 error 阻断；实际入口可达的 TS／TSX、workspace runtime exports 在范围内。纯类型边和动态导入不参与，未达入口的孤立循环不在保障范围；不使用会漏掉当前 Worker 入口的 `--production`，不新增依赖图工具或第二套 TypeScript。
- pnpm 显式设置 `minimumReleaseAge: 1440`，保留安装脚本白名单 `esbuild`／`workerd`；不保留已过期的 Cloudflare 冷静期例外。CI 冻结 lockfile；安全更新若确需例外，应限定具体版本并重新审查，不全局关闭策略。
- `pnpm check` 使用 Biome `--error-on-warnings`；警告也阻断。Web 不得导入 Worker 实现，domain 不得反向依赖应用／contracts／content；规则在 `biome.json`，这是导入路径限制而非完整依赖图／循环分析。客户端生产 TS 与 Vite 配置纳入类型检查。
- Biome 2.6 的 Markdown／YAML formatter 显式关闭，维持升级前的格式门禁范围；不批量重写文档、工作流或 pnpm 生成的 lockfile。对应 linter 与既有 JS／TS／JSON formatter 保持启用。新增语言格式规范如需采用，应单独评估并迁移。
- 构建之后 `pnpm check:bundle` 汇总 dist 中全部 JS/CSS 各自 gzip 的大小，包括动态非首屏 chunk；不是精确首屏指标。上限 JS 320 KiB、CSS 32 KiB、合计 352 KiB，保留功能余量；不能通过拆 chunk、改 Vite 提示阈值或自动更新预算绕过。预算变动须说明用户收益与增量，缺失产物失败。
- CI `secrets` job 使用固定版本及 SHA-256 校验的 Gitleaks 二进制，扫描可达 Git 历史且输出脱敏，不需要付费 Action 或读取个人 `.env`。本地可用同版本执行 `gitleaks git --redact --no-banner --log-opts="--all" .`；提交前另用 `gitleaks git --redact --no-banner --pre-commit --staged .` 检查暂存内容。`.gitleaksignore` 只允许经核实的精确历史误报指纹，不能整类排除。它不能代替服务端 push protection，也不证明历史从未泄露。
- 手写生产非 JSX 与非测试 tools 的 Biome 上限为认知复杂度 40、函数 120 行、文件 600 行；TSX 为 60／300／700，行数跳过空行。测试（含 E2E）不按生产函数阈值约束；CSS 不设文件行数门禁，以现有全产物预算约束体积，避免只为行数拆分样式并引入级联风险。阈值是重构触发器，不替代职责与行为审查，不允许用薄包装、批量 suppress 或排除生产目录过关。测试准入和维护取舍见 [test-maintenance](.agents/skills/test-maintenance/SKILL.md)。

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

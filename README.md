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
- 作者：创建、编辑、上传；资料、封面和正文统一冻结送审，撤回保留历史，不直接改动公开版本；
- 审核：独立任务层、云检查与人工审核、发布指针切换、成员角色、审计；
- 互动：点赞、订阅、评分、按用户/项目/日幂等的下载计数；评分与留言仅本人可通过个人状态接口读取。重新打开详情回填留言；评分接口省略 `comment` 保留已有留言，空字符串清空；
- 客户端：版本化分发、按安装位置扫描多实例，安装／更新／卸载先预览差异再确认；登记配套脚本的精确版本与下载地址，不代管脚本数据；
- 缓存：匿名公开投影按分类 TTL 使用 Cache API；私有资格与计数始终实时，获准后的不可变文件字节可在内部复用。环境配置、陈旧与撤回限制见[运行配置与缓存](docs/reference/runtime-configuration.md)。

接口以 `/api/v1` 为前缀，调用方式见 [Worker API 参考](docs/reference/worker-api.md)。共享契约在 `packages/contracts`，领域规则在 `packages/domain`，checker 与内容审计在 `packages/content`。

## 文档与 Agent

- 当前行为、契约、教程和参考：`docs/`
- [Worker API 参考](docs/reference/worker-api.md)、[API 缓存设计](docs/reference/cache-design.md)、[运行配置](docs/reference/runtime-configuration.md)、[宿主协议](docs/reference/host-protocol.md)
- [玩家、作者与审核操作](docs/guides/using-workshop.md)、[部署与恢复](docs/operations/deployment-safety.md)
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

本地角色预览使用 `pnpm preview:debug`；预览前端必须显式提供 Worker 来源 `PREVIEW_API_ORIGIN`，缺失时启动会报错并退出，不会静默连接默认后端。预览账号缺失、请求失败或响应格式无效时，页面会显示账号未就绪提示，仍可匿名浏览；依赖不可用账号的角色选项保持禁用。

### 程序性质量门禁

- `pnpm check:workspace` 从 workspace 声明发现包，要求每包有 typecheck/test 或在单一策略表中有明确豁免。新增包未分类、缺脚本及过期豁免均失败；`--if-present` 不再意味着可静默漏检。content 是 JavaScript；contracts 的 schema 由消费者测试覆盖，不保留空测试命令。
- `pnpm check:architecture` 检查 workspace 清单的全部依赖类别及生产源码中的包依赖方向、Web 到 Worker 实现的反向依赖、storage 到 data 的运行时反向依赖；包含相对路径、TypeScript 路径别名、类型、重导出和动态导入。规则仅覆盖已分类 workspace 的源码，不覆盖工具脚本和测试；动态模块名在覆盖范围内不允许。
- `pnpm --filter @workshop/worker check:data-boundary` 检查运行时网关和 Durable Object 不直接导入或访问 D1/R2 数据实现；`pnpm check` 已包含该门禁。同 Worker bindings 不是平台级隔离。
- `pnpm check:unused` 使用固定 Knip 6.43.0 检查全部 workspace 的依赖；入口覆盖 package exports、Worker、嵌套 Vite/CSS、自定义 esbuild、tools 与测试。`knip.jsonc` 仅为宿主 Cloudflare 模块和跨 workspace 命令保留有据例外；未用、未声明依赖均阻断。文件／导出维度只作人工审计，未作为持续门禁。
- `pnpm check:cycles` 复用同一个 Knip，静态运行时循环以 error 阻断；实际入口可达的 TS／TSX、workspace runtime exports 在范围内。纯类型边和动态导入不参与，未达入口的孤立循环不在保障范围；不使用会漏掉当前 Worker 入口的 `--production`，不新增依赖图工具或第二套 TypeScript。
- pnpm 显式设置 `minimumReleaseAge: 1440`，保留安装脚本白名单 `esbuild`／`workerd`；不保留已过期的 Cloudflare 冷静期例外。CI 冻结 lockfile；安全更新若确需例外，应限定具体版本并重新审查，不全局关闭策略。
- `pnpm check` 使用 Biome `--error-on-warnings`；警告也阻断。Web 不得导入 Worker 实现，domain 不得反向依赖应用／contracts／content；规则在 `biome.json`，这是导入路径限制而非完整依赖图／循环分析。客户端生产 TS 与 Vite 配置纳入类型检查。
- Biome 2.6 的 Markdown／YAML formatter 显式关闭，维持升级前的格式门禁范围；不批量重写文档、工作流或 pnpm 生成的 lockfile。对应 linter 与既有 JS／TS／JSON formatter 保持启用。新增语言格式规范如需采用，应单独评估并迁移。
- 构建之后 `pnpm check:bundle` 汇总 dist 中全部 JS/CSS 各自 gzip 的大小，包括动态非首屏 chunk；不是精确首屏指标。上限 JS 320 KiB、CSS 32 KiB、合计 352 KiB，保留功能余量；不能通过拆 chunk、改 Vite 提示阈值或自动更新预算绕过。预算变动须说明用户收益与增量，缺失产物失败。
- CI `secrets` job 使用固定版本及 SHA-256 校验的 Gitleaks 二进制，扫描可达 Git 历史且输出脱敏，不需要付费 Action 或读取个人 `.env`。本地可用同版本执行 `gitleaks git --redact --no-banner --log-opts="--all" .`；提交前另用 `gitleaks git --redact --no-banner --pre-commit --staged .` 检查暂存内容。`.gitleaksignore` 只允许经核实的精确历史误报指纹，不能整类排除。它不能代替服务端 push protection，也不证明历史从未泄露。
- 手写生产非 JSX 与非测试 tools 的 Biome 上限为认知复杂度 40、函数 120 行、文件 600 行；TSX 为 60／300／700，行数跳过空行。测试（含 E2E）不按生产函数阈值约束；CSS 不设文件行数门禁，以现有全产物预算约束体积，避免只为行数拆分样式并引入级联风险。阈值是重构触发器，不替代职责与行为审查，不允许用薄包装、批量 suppress 或排除生产目录过关。测试准入和维护取舍见 [test-maintenance](.agents/skills/test-maintenance/SKILL.md)。

仅初始化可丢弃的空本地 D1（不用于升级既有数据库）：

```text
cd apps/worker
pnpm exec wrangler d1 migrations apply DB --local --config wrangler.jsonc
```

客户端构建与发布脚本在 `apps/tavern-client/package.json`；checker 构建与发布脚本在 `packages/content/package.json`。

当前数据库结构以 `apps/worker/migrations/0001_initial.sql` 的上线前空库基线为准，不能对既有数据库套用该初始 schema。存量数据切换需从完整当前快照重建隔离候选并独立对账，再另行授权绑定切换；挑选旧站公开项目导入本地预览不等于完整当前库迁移。工具入口见 [`tools/migrate/README.md`](tools/migrate/README.md)，范围和操作边界见[迁移手册](docs/operations/legacy-data-migration.md)。

生产上线时冻结已接受基线，之后保留已应用文件并追加有序增量 migration；不是永久禁止增量迁移。schema、备份、恢复和授权要求以[部署安全规则](docs/operations/deployment-safety.md#schema-evolution-and-production-cutover)为准，旧编号链及历史验收不再是当前切换依据。

## 部署

部署由 GitHub Actions 执行；本地使用检查与 dry-run 验证，不把 `wrangler deploy` 当作无副作用的验证命令。以下描述仓库中的流程与门禁，不代表远端已经执行。

- **CI**：`.github/workflows/ci.yml` 在相关路径 push/PR 时运行 `pnpm check` 和 `pnpm e2e:local`。
- **Staging**：`ci` 在 `main` 成功后，`.github/workflows/deploy-staging.yml` 仅在来源新鲜且存在应用变更时构建、部署；纯文档等变更跳过。自动 staging **从不执行 D1 migration**；相对最近成功部署与已接受 schema checkpoint 中较新者存在 schema 变更时暂停构建和部署。当前 checkpoint 为 `f2491599cfb97a6405b5f73ead73227387786478`，不得只为让流水线变绿而推进。
- **Production**：`v*` tag 触发 `.github/workflows/deploy-production.yml`，production environment 要求审批。流程查找该 commit 的成功 staging 记录并校验同一 artifact，但当前在 **Require separately verified production schema** 无条件停止，尚不会到达后续备份或部署步骤；恢复须另行明确授权并独立核验 schema、数据和绑定。
- 获授权恢复 production 后，仍须使用 staging 已验证的同一 commit 和 artifact，不接受本地或其他分支重建产物；artifact 包含 Web 静态资源、Worker bundle 与 Tavern client，后续 stable client 发布也受该门禁约束。
- Release artifact 包含构建目录中的隐藏文件（包括 Vite manifest），确保上传内容与 SHA-256 清单一致。
- Git 仓库与 Cloudflare 运行时是两套独立状态：推送不等于部署，部署后必须单独核对 Worker version。
- 密钥通过 GitHub Actions secrets 或 `wrangler secret put` 写入，不进入仓库。
- 不手工随意修改生产 D1；上线前空库基线、既有库切换及上线后有序增量迁移分别遵循上述安全规则，并核验兼容性、备份和实际数据。
- production 中保留的 D1 导出、Time Travel bookmark 和私有 R2 备份步骤目前在停止门禁之后，不是已运行的自动备份或已验证恢复能力；恢复要求见 [`docs/operations/deployment-safety.md`](docs/operations/deployment-safety.md)。
- 备份完整性用 `.github/workflows/verify-production-backup.yml` 手动验证；它不修改生产数据库。

本地验证仍按上面的 `pnpm check` 和 `pnpm e2e:local` 执行。需要排查真实数据库或 schema 切换时先遵循[部署安全规则](docs/operations/deployment-safety.md)，获得对应环境和具体操作的授权；本 README 不提供可绕过当前暂停门禁的远程 DDL 命令。

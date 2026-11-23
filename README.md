# 命定创意工坊

这是「命定之诗与黄昏之歌」的**创意工坊**独立仓库。

当前工作树包含一个 Cloudflare Worker（API + Web 静态托管）和酒馆客户端 bundle：

- **Cloudflare Worker 后端**：项目读取、作者写路径、人工审核、发布、互动与文件分发；同时通过 Static Assets 托管 Web 构建产物。
- **Web 站点**：React + Vite 的公开列表、详情与作者/审核界面。它不是独立服务，构建产物由上面的 Worker 同源提供，页面里的 `/api/v1` 请求也回到这个 Worker。
- **酒馆客户端**：SillyTavern 内的宿主连接桥接、多实例扫描、预览确认式安装／更新／迁移／卸载及旧归属格式转换。

## 仓库结构

```text
workshop/
├─ apps/worker/              # 唯一后端：Hono + D1 + R2 + Static Assets
│  ├─ migrations/            # D1 结构演进（唯一迁移序列）
│  ├─ src/                   # API 与存储层
│  └─ web/                   # 公开站点与作者/审核界面（React + Vite）
├─ apps/tavern-client/       # 酒馆客户端 bundle 与宿主安装桥接
├─ packages/contracts/       # 共享 Zod 契约与类型
├─ packages/domain/          # 分类、内容策略、限额、版本等纯函数
├─ packages/content/         # EJS checker、内容审计与 bundle 产物
├─ tools/                    # workspace/schema 校验、迁移、备份校验与本地 E2E
├─ docs/                     # 当前知识、操作手册、参考文档、计划与历史归档
│  ├─ AGENTS.md              # 文档权威归属与写作规则
│  ├─ guides/                # 玩家、作者与审核操作教程
│  ├─ operations/            # 部署安全与数据迁移手册
│  ├─ reference/             # Worker API、缓存、运行配置与宿主协议参考
│  ├─ plans/refactor-2026-10/
│  └─ archived/              # 历史归档（含已归档审计记录 archived/refactor-2026-10/）
└─ .agents/                  # 项目级 Agent 规则、notes、skills 与共享规范
```

源码导航：[`apps/README.md`](apps/README.md)、[`packages/README.md`](packages/README.md)、[`tools/README.md`](tools/README.md)。按目录定位职责、边界与权威入口；编写及维护规则见 [`AGENTS.md`](AGENTS.md#directory-readmes)。

## 后端与客户端

唯一 Worker 位于 [`apps/worker/src/index.ts`](apps/worker/src/index.ts)，技术栈为 Cloudflare Workers + Hono，数据存储为 D1，文件存储为 R2，静态站点通过 Static Assets 提供。

- 公开读取：首页、项目列表/详情、合集与作者主页、推荐、站点信息；
- 登录后读取：发布清单、文件下载；
- 作者：创建、编辑、上传；资料、封面和正文统一冻结送审，撤回保留历史，不直接改动公开版本；
- 审核：独立任务层、云检查与人工审核、发布指针切换、成员角色、审计；
- 互动：点赞、订阅、当前订阅用户的版本公开推荐、按用户/项目/日幂等的下载计数，以及仅本人可见的个人版本体验备忘（`/api/v1/me/state` 仅返回点赞、订阅与推荐状态，个人评分与体验备忘独立由 `/api/v1/me/experience-notes/:id` 管理，接口细节见 [Worker API 参考](docs/reference/worker-api.md#当前用户与互动)）；
- 客户端：版本化分发、按安装位置扫描多实例，安装／更新／迁移／卸载先预览差异再确认；登记配套脚本的精确版本与下载地址，不代管脚本数据；
- 缓存：匿名公开投影按分类 TTL 使用 Cache API；私有资格与计数始终实时，获准后的不可变文件字节可在内部复用。环境配置、陈旧与撤回限制见[运行配置](docs/reference/runtime-configuration.md)。

接口以 `/api/v1` 为前缀，调用方式见 [Worker API 参考](docs/reference/worker-api.md)。共享契约在 `packages/contracts`，领域规则在 `packages/domain`，checker 与内容审计在 `packages/content`。

## 文档与 Agent

- 当前行为、契约、教程和参考：`docs/`
- [Worker API 参考](docs/reference/worker-api.md)、[API 缓存设计](docs/reference/cache-design.md)、[运行配置](docs/reference/runtime-configuration.md)、[宿主协议](docs/reference/host-protocol.md)
- [玩家、作者与审核操作](docs/guides/using-workshop.md)、[部署与恢复](docs/operations/deployment-safety.md)、[存量与旧站数据迁移](docs/operations/legacy-data-migration.md)
- refactor 计划、checklist、状态和决策：`docs/plans/refactor-2026-10/`（早期点对点审计报告已归档至 `docs/archived/refactor-2026-10/`）
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

本地角色预览使用 `pnpm preview:debug`；预览脚本必须显式读取机器本地地址 `PREVIEW_HOST`（可在未跟踪的根目录 `.env` 或环境变量中设置，参见 `.env.example`），缺失时启动会报错并退出，不会静默绑定默认地址。预览账号缺失、请求失败或响应格式无效时，页面会显示账号未就绪提示，仍可匿名浏览；依赖不可用账号的角色选项保持禁用。

### 程序性质量门禁

门禁脚本串联与精确参数以 [`package.json`](package.json) 为准：

- **Workspace 覆盖与链接校验**（[`tools/check-workspace.mjs`](tools/check-workspace.mjs)）：从 [`pnpm-workspace.yaml`](pnpm-workspace.yaml) 发现全部包，要求每包声明真实 `typecheck`/`test` 或有据豁免，同时校验 `tools/` 下全部测试已接入 `pnpm check` 且文档相对链接有效。
- **架构与数据访问边界**（[`apps/worker/tools/check-architecture.mjs`](apps/worker/tools/check-architecture.mjs) 与 `@workshop/worker` `check:data-boundary`）：校验已分类 workspace 的依赖方向、Web 与 Worker 实现隔离、storage 与 data 边界，以及网关／Durable Object 不直接导入或访问 D1/R2 数据实现（同 Worker bindings 不是平台级权限隔离）。
- **死代码、依赖与循环检测**（[`knip.jsonc`](knip.jsonc)）：`pnpm check:unused`（启用 `includeEntryExports: true` 与 `--treat-config-hints-as-errors`）持续阻断未用文件、导出、类型、未用或未声明依赖及过期配置提示，仅在 `knip.jsonc` 保留有据入口例外；`pnpm check:cycles` 对可达运行时 TS/TSX 与 workspace 导出阻断静态运行时循环（不含纯类型边与动态导入）。
- **静态检查、格式化与复杂度**（[`biome.json`](biome.json)）：`pnpm check` 以 `--error-on-warnings` 运行 Biome，阻断警告、受限跨层导入路径以及手写生产源码的认知复杂度、函数行数和文件行数上限（Markdown／YAML 格式化在 `biome.json` 中关闭；测试准入与维护取舍见 [test-maintenance](.agents/skills/test-maintenance/SKILL.md)）。
- **前端构建产物预算**（[`tools/check-bundle-size.mjs`](tools/check-bundle-size.mjs)）：汇总 `apps/worker/web/dist/` 中全部 JS/CSS（含动态非首屏 chunk）各自 gzip 体积并校验显式上限，缺失产物失败；不允许通过拆 chunk 或调高构建器提示阈值绕过。
- **供应链与密钥扫描**（[`pnpm-workspace.yaml`](pnpm-workspace.yaml)、[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）：pnpm 配置依赖发布冷静期 `minimumReleaseAge` 与最小构建白名单，CI 冻结 lockfile；CI `secrets` job 使用固定版本及 SHA-256 校验的 Gitleaks 扫描可达 Git 历史（本地可用 `gitleaks git --redact --no-banner --log-opts="--all" .` 或 `--pre-commit --staged`，`.gitleaksignore` 仅允许经核实的精确历史误报指纹）。

仅初始化可丢弃的空本地 D1（不用于升级既有数据库）：

```text
cd apps/worker
pnpm exec wrangler d1 migrations apply DB --local --config wrangler.jsonc
```

客户端构建与发布脚本在 `apps/tavern-client/package.json`；checker 构建与发布脚本在 `packages/content/package.json`。

当前数据库结构以 `apps/worker/migrations/0001_initial.sql` 的上线前空库基线为准，不能对既有数据库套用该初始 schema。存量数据切换需从完整当前快照重建隔离候选并独立对账，再另行授权绑定切换；挑选旧站公开项目导入本地预览不等于完整当前库迁移。工具入口见 [`tools/migrate/README.md`](tools/migrate/README.md)，范围和操作边界见[迁移手册](docs/operations/legacy-data-migration.md)。

生产上线时冻结已接受基线，之后保留已应用文件并追加有序增量 migration；不是永久禁止增量迁移。schema、备份、恢复和授权要求以[部署安全规则](docs/operations/deployment-safety.md#schema-evolution-and-production-cutover)为准。

## 部署

部署由 GitHub Actions 执行；本地使用检查与 dry-run 验证，不把 `wrangler deploy` 当作无副作用的验证命令。以下描述仓库中的流程与门禁，不代表远端已经执行。

- **CI**：`.github/workflows/ci.yml` 在相关路径 push/PR 时运行 `pnpm check`、`pnpm e2e:local` 与 `secrets`。
- **Staging**：`ci` 在 `main` 成功后，`.github/workflows/deploy-staging.yml` 仅在该修订仍为当前 `main` 且相对最近成功验收的 staging 部署存在应用变更（或通过手动 `workflow_dispatch` 触发 `ci`）时构建、部署；纯文档等变更跳过。自动 staging **从不执行 D1 migration**；部署前运行 `.github/scripts/verify-release-schema.py staging` 比对远端目标 D1 的表、索引、视图与触发器是否与当前代码迁移链完全一致，不一致则失败退出。
- **Production**：`v*` tag 触发 `.github/workflows/deploy-production.yml`，production environment 要求审批。流程先验证该 tag 属于 `main`、下载并校验已在 staging 通过验收的同一份构建与客户端 artifact、核对生产配置与必需的运行时 secret 名称，再运行 `verify-release-schema.py production` 只读校验线上 D1 schema。
- 校验通过后，工作流在变更前记录当前生产 D1 Time Travel `bookmark`、Worker 流量版本与 `client_channels` 到保留 90 天的 `production-recovery-<attempt>` artifact，随后直接部署该已验收 Worker 产物、发布 `stable` 客户端、执行冒烟测试并校验新版本 100% 承接流量，不接受本地或其他分支重建产物。
- Release artifact 包含构建目录中的隐藏文件（包括 Vite manifest），确保上传内容与 SHA-256 清单一致。
- Git 仓库与 Cloudflare 运行时是两套独立状态：推送不等于部署，部署后必须单独核对 Worker version。
- 密钥通过 GitHub Actions secrets 或 `wrangler secret put` 写入，不进入仓库。
- 不手工随意修改生产 D1；上线前空库基线、既有库切换及上线后有序增量迁移分别遵循上述安全规则，并核验兼容性、备份和实际数据。
- `production-recovery-<attempt>` 记录的是 D1 Time Travel 恢复书签与版本状态（受 D1 自身保留窗口限制），不等同于长期 R2 SQL 导出备份；恢复边界与操作要求见 [`docs/operations/deployment-safety.md`](docs/operations/deployment-safety.md)。
- 长期 SQL 备份的哈希、外键与核心表完整性用 `.github/workflows/verify-production-backup.yml` 手动验证；它不修改生产数据库。

本地验证仍按上面的 `pnpm check` 和 `pnpm e2e:local` 执行。需要执行真实数据库迁移或绑定切换时先遵循[部署安全规则](docs/operations/deployment-safety.md)，获得对应环境和具体操作的明确授权。

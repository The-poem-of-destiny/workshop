# CI/CD 问题清单与预期路线

更新：2026-10-21

范围：`.github/workflows/`、`package.json` 检查入口、Cloudflare staging/production 部署、生产迁移与回滚。本文是待审查的路线清单，不是已完成状态记录。

## 现状基线

- `main` 已包含重构，旧状态保留在 `archive/pre-refactor-2026-10`。
- `refactor-ci` 在 `main` push 和面向 `main` 的 PR 上运行 `check` / `e2e`。
- staging 由 `refactor-ci` 成功后的 `workflow_run` 部署；纯 docs/CI 变更跳过部署。
- production 由 `v*` tag push 触发，查找同 commit 的 staging 成功记录并下载 Web artifact。
- 当前没有 `v*` tag，production workflow 尚未实际执行。
- production D1 当前为空（0 表），staging 约 463 kB；Free 套餐额度足够当前规模。
- 当前没有 lint、format、Node 版本固定、生产迁移备份和恢复演练。

优先级：

- **P0**：下一次 production 发布前必须完成，否则不能宣称可回滚/可审计。
- **P1**：应在稳定发布前完成，影响日常质量和成本。
- **P2**：增强项，不阻塞发布。

## P0

### CD-01 生产迁移没有备份

**问题**：`deploy-production.yml` 在 migration 前没有 D1 导出、Time Travel bookmark 或 R2 备份。`tools/backup/verify.mjs` 只校验已有导出，不创建备份。

**预期路线**：
1. 在 production migration 前执行 `wrangler d1 export workshop-prod --remote`，生成完整 SQL。
2. 记录 `d1 time-travel info` 返回的 bookmark。
3. 计算 SQL 的 SHA-256，连同 bookmark、timestamp、migration 列表、tag、commit 一起写入 manifest。
4. 上传到独立私有 R2 backup bucket；使用生命周期策略控制保留期。
5. 恢复只允许人工 workflow；优先回滚 Worker，数据损坏才使用 Time Travel restore 或 SQL 恢复。
6. 备份步骤失败时阻止 migration 和 deploy。

**验收**：production workflow 在没有成功备份时不能进入 migration；能从 R2 取回备份并在临时 D1 验证。

### CD-02 artifact 不是完整 build-once

**问题**：staging build 只上传 `apps/worker/web/dist`；Worker 在 deploy job 重新打包。production 也只提升 Web artifact。

**预期路线**：
1. 在 CI/build job 同时产出 Web 和 Worker bundle。
2. 对完整 artifact 计算 hash，上传并记录 commit、tag、migration 版本。
3. staging 和 production 部署同一个 artifact，不在 deploy job 重新打包。
4. 先在 staging 验证 `wrangler` 的 bundle/no-bundle 路线，再切换 production。
5. 在完整路线落地前，文档继续明确“只保证同一 commit + Web artifact”，不宣称完整 build-once。

**验收**：production 部署的 Worker bundle 与 staging 验证的 artifact 字节一致；hash 可复核。

### CD-03 production 发布路径未实跑（拆成 P0 演练 + 发布后证据）

**问题**：没有 `v*` tag，production workflow 从未运行；首个 release 的 tag、artifact 查找、审批、migration、smoke 都没有证据。

**预期路线**：
1. 先在 staging 完成一次完整验收。
2. 在已验收 commit 上创建 `v*` tag。
3. 由 production environment reviewer 批准。
4. 执行一次非生产演练或 dry-run，确认 artifact 查找和 hash 校验。
5. 首个 production 发布前准备回滚版本、备份和停写窗口。

**验收**：至少一次 production workflow 的完整 run 记录，包含 tag、commit、artifact、Worker version、smoke 和回滚目标。

### CD-04 migration 与代码兼容性（P0）

**问题**：workflow 先 apply migration 再 deploy Worker，但没有强制 expand/contract 或迁移窗口策略。

**预期路线**：
1. 迁移只做 expand（新增表/列/索引），旧 Worker 仍可运行。
2. deploy 新 Worker 并观察。
3. 稳定后再做 contract（删除旧结构）。
4. production migration 前记录备份和滚动窗口；大表更新分批。

**验收**：migration 后旧 Worker 仍能服务；回滚 Worker 不需要立即回滚 schema。

### CD-05 回滚 runbook 未固化（P0）

**问题**：没有记录“如何回滚 Worker、如何恢复 D1、如何确认恢复成功”的固定步骤。

**预期路线**：
1. 每次 production 部署记录当前和上一版 Worker version。
2. 失败时先回滚 Worker；只有数据/结构损坏才走 D1 恢复。
3. 记录 Time Travel bookmark、备份对象 key、恢复命令和验证查询。
4. 每季度做一次恢复到临时 D1 的演练。

**验收**：任意一次 production 发布都能指出上一版 Worker、备份 key、恢复步骤和验证结果。

## P1

### CI-01 没有 lint / format（P1）

**问题**：仓库没有 ESLint、Biome、Prettier 或 markdownlint；`pnpm check` 有类型、测试、schema、迁移、备份和 Wrangler 检查，但没有 lint/format。

**预期路线**：
1. 选 Biome 作为 TS/JSON/CSS 的 format + lint 单一入口。
2. 配置排除生成物、vendor、`dist`、`.wrangler`、`data_backup`。
3. 加 `format`（写）、`format:check`（只检查）、`lint`、`biome ci`。
4. 先把 `biome ci` 加入根 `pnpm check`，再用 ignore/ratchet 处理旧问题；不要一次性改全仓。
5. CI 只检查，不自动提交格式化结果。

**验收**：CI 在格式或 lint 错误时失败；本地 `pnpm format` 能修复。

### CI-02 没有 Node 版本固定（P1）

**问题**：CI 固定 Node 22，本地没有 `.nvmrc`、`engines.node` 或版本文件。

**预期路线**：
1. 加 `.nvmrc` 和 `package.json` 的 `engines.node`。
2. CI 使用 `node-version-file` 读取同一版本。
3. 文档写明本地 Node 版本和 Playwright Chromium 安装命令。

**验收**：本地与 CI 使用同一 Node major；版本不一致时安装/检查能明确失败。

### CI-03 重复的 check/e2e（已修，保留为回归项）

**问题**：`refactor-ci` 同时监听任意 `push` 和 `pull_request`，开 PR 后同一分支产生两套 run。

**预期路线**：`push` 只监听 `main`，`pull_request` 只面向 `main`；特性分支只跑 PR run。

**验收**：PR 页面每个 job 只出现一次；main push 只跑一次。

### CI-04 docs-only 也跑完整 e2e

**问题**：docs/AGENTS 变更仍触发完整 `check` + `e2e`，成本高；staging 已跳过部署。

**预期路线**：
1. 保持 `main` 的 required checks 可用。
2. 评估拆出轻量 docs check（链接、Markdown、文档路径）作为 required check。
3. 在未拆分前接受 docs 变更跑完整 CI，但不触发部署。

**验收**：docs-only PR 不产生 staging 部署；必需检查仍能阻止坏文档合并。

### CI-05 Actions 版本与运行环境漂移

**问题**：workflow 使用 `ubuntu-latest` 和 Node 20 时代的 action major，GitHub 已提示 Node 20 弃用和 Ubuntu 26 迁移。

**预期路线**：
1. 固定 runner 镜像（例如 `ubuntu-24.04`）而不是 `ubuntu-latest`。
2. 逐项升级 `actions/checkout`、`setup-node`、`upload/download-artifact`、`pnpm/action-setup` 到受支持 major。
3. 升级后跑一次 staging 部署验证。
4. 对 workflow 加 `timeout-minutes` 和 `concurrency`。

**验收**：CI 无弃用警告；同 commit 重跑结果稳定。

### CI-06 workflow 语法和动作校验

**问题**：目前只有 YAML 解析和人工检查，没有 actionlint 或等价检查。

**预期路线**：
1. 在 CI 加 `actionlint` 或等价的 workflow lint。
2. 对表达式、`needs`、`if`、artifact 名称和权限做静态校验。
3. 本地提供同一命令。

**验收**：错误 workflow 在合并前失败，而不是等到 deploy job 才失败。

### CD-06 release/tag 流程

**问题**：`v*` tag 是唯一发布标记，但没有版本号、release notes、tag 创建权限或 release checklist。

**预期路线**：
1. 版本号使用语义化版本，tag 只从已验收的 `main` commit 创建。
2. tag ruleset 限制创建/删除/移动，只有 release 管理者可操作。
3. 发布前记录 release notes、migration 列表、staging run、备份 key。
4. production workflow 只读取 tag，不接受任意分支或手填 artifact。

**验收**：tag 指向可追溯的 commit 和 staging run；tag 不能静默移动。

### CD-07 smoke 覆盖不足

**问题**：production/staging smoke 只检查 `/api/v1/health`。

**预期路线**：
1. smoke 增加公开列表、项目详情、静态首页和认证边界（未登录 `/me` 应为 401）。
2. 客户端通道如果已发布，检查 stable 指针和版本响应。
3. smoke 失败时明确停止并回滚，不继续后续步骤。

**验收**：部署后关键公开路径和权限边界都有自动证据。

### SEC-01 依赖与安全检查

**问题**：没有 Dependabot、CodeQL、`pnpm audit` 或 dependency review。

**预期路线**：
1. 开启 Dependabot（pnpm + GitHub Actions），按周分组更新。
2. `pnpm audit --prod` 作为非阻塞报告，先观察噪声。
3. 根据仓库公开程度决定是否加 CodeQL。
4. 第三方 action 固定 major 或 commit，禁止无审查的 `latest`。

**验收**：依赖漏洞和 action 更新有可见入口；不会静默使用过时 action。

### SEC-02 secrets 与权限边界

**问题**：staging/production 已有 environment secrets，但缺少轮换和最小权限检查；备份 bucket 也需要独立权限。

**预期路线**：
1. Cloudflare token 按环境拆分，staging token 不能部署 production。
2. 备份 bucket 使用独立凭证或最小权限 token。
3. 记录轮换周期和撤销步骤；不在日志输出 token。
4. production environment 保留 required reviewer。

**验收**：staging 凭证无法操作 production；备份凭证不能改业务数据。

## P2

### CI-07 依赖缓存与 CI 成本

**问题**：Actions 已缓存 pnpm，但 docs/重复推送仍会消耗分钟数；没有 CI 成本观察。

**预期路线**：观察月度分钟数；对 docs 拆轻量 job；对同一 PR 的新 push 使用 concurrency 取消旧 run。

**验收**：PR 重复 push 不堆叠旧 run；月度用量可解释。

### CI-08 测试覆盖与回归证据

**问题**：没有覆盖率门禁，但当前测试聚焦关键契约；不必追求覆盖率数字。

**预期路线**：只对高风险模块记录覆盖趋势（权限、发布指针、checker、迁移）；不设全局百分比硬门槛。

**验收**：关键路径新增回归测试；覆盖率报告用于发现空白，不用于刷数字。

### DOC-01 本地开发说明缺口

**问题**：README 没有写本地 `pnpm exec playwright install chromium`。

**预期路线**：在本地开发一节补浏览器安装；说明 `pnpm check` 与 `pnpm e2e:local` 的分工。

**验收**：新环境按 README 能跑通本地 E2E。

## 审查重点

请审查这份清单时重点检查：

1. 是否有遗漏的 CI/CD 风险，尤其是 production 迁移、artifact 提升、回滚和 Free 套餐约束。
2. 优先级是否合理：哪些其实应先于 production 发布。
3. 固定路线是否有错误前提，例如超出 Free 套餐、误用 Wrangler 命令、错误理解 GitHub Environment。
4. 是否存在“已经修复但清单仍写成待办”的重复项。
5. 哪些项应合并为一个变更，避免碎片化 PR。

## gpt-6.1-sol 审查结论

审查日期：2026-10-21。审查方式：只读检查清单与 workflow/config 文件；结论不是执行证据。

### 阻塞项

1. **provenance 不能只靠 `gh run list --commit`。** 当前 production 查找 staging run 的方式在正常 `workflow_run` 上可用（已核对 run `39593544230` 的 `headSha` 是 `7761c32`），但没有把 source SHA、run attempt、artifact ID/digest、staging smoke 结果绑定进 manifest。发布前必须补 manifest 或等价证据。
2. **成功的 staging workflow 不等于成功部署。** docs-only run 会 `build`/`deploy` skipped 但 workflow 仍为 success；production 必须要求实际 build、deploy、smoke 成功。
3. **生产迁移仍没有恢复门禁。** CD-01 的备份、Time Travel bookmark、R2 对象和恢复验证必须成为 migration 的前置条件。
4. **回滚兼容性必须是 P0。** 旧 Worker 必须能在新 schema 上运行；migration 失败或 smoke 失败时要有明确回滚/停写路径。CD-04/CD-05 提升为 P0。
5. **首个 production 发布没有“上一版应用”可回滚。** 当前 production 是旧骨架；必须定义首次切换的 bootstrap 方案、停写窗口和恢复边界。
6. **生产认证配置未闭环。** `apps/worker/wrangler.jsonc` 中 production 的 Discord 变量仍为空；发布前必须确认实际 secret/vars，而不是假设环境已配置。

### 需要修正的清单项

- **CD-01**：明确在 `apps/worker` 目录执行、指定 production config/env、导出文件名；备份 SQL 与 Time Travel bookmark 不是同一时间点，需停止写入或如实记录两个恢复边界。
- **CD-02**：把 Worker/config/migration provenance 纳入完整 artifact；当前只对 Web artifact 做 hash。
- **CI-04**：path-filtered required checks 可能让只改 `.gitignore` 等未匹配文件的 PR 永远 pending；需要 always-running 的 required check 或覆盖全部路径的策略。
- **CD-05**：Time Travel 只能原地恢复，不能恢复到临时 D1；临时 D1 只能用于 SQL import/rehearsal，不能用于 Time Travel restore。
- **CD-06**：artifact 30 天过期；发布晚于窗口会失败。需要持久 release artifact 或明确重建/拒绝策略。
- **CD-07**：smoke 失败当前不会自动回滚；需要定义“失败即停、回滚、通知”的固定动作。
- **SEC-02**：staging/production token 是否真正隔离尚未验证；不同 token 字符串不等于资源隔离。
- **D1/DO/R2**：D1 导出不覆盖 Durable Object SQLite 状态和 R2 对象；需要明确 recovery 边界，不能宣称“备份整个系统”。

### 已确认已修

- `refactor-ci` 已限制 `push`/`pull_request` 到 `main`，重复 check/e2e 已消失。
- staging 已由 `workflow_run` 在 CI 成功后触发。
- staging docs-only 已跳过 build/deploy。
- production 已改为 tag push，并校验 checkout 与 `GITHUB_SHA`。
- staging/production 已有 `concurrency`，但缺少 CI 的 concurrency/timeout 和 freshness 检查。

### 优先级修正

- P0：CD-01、CD-02、CD-03（演练部分）、CD-04、CD-05、生产认证配置。
- P1：CI-01、CI-02、CI-04、CI-05、CI-06、CD-06、CD-07、SEC-01/02。
- P2：CI-07、CI-08、DOC-01。

### 结论

**不批准按当前清单原样执行。** 方向正确，但备份/恢复、完整 artifact、发布 provenance、回滚和首个 production 切换必须先于 lint/format 与工具链美化。

## 本轮实现（待 PR 检查）

- CI：加入 Biome、`format` / `format:check` / `lint`，根 `pnpm check` 纳入 `biome ci`；Node 版本由 `.nvmrc` 和 `engines.node` 固定。
- CI：`refactor-ci` 去掉路径过滤，避免 required checks 永久 pending；固定 `ubuntu-24.04`，加入 concurrency、timeout、新 action major。
- staging：CI 成功后触发；增加 main freshness 检查；改动范围按上次成功部署比较，并分页读取 commit 文件。
- artifact：构建 Web + Worker bundle，生成 `artifact.sha256` 和 `artifact-manifest.json`，staging 和 production 使用同一 release artifact。
- production：tag push 触发；校验 tag commit 是 `main` 祖先；从 staging 成功记录下载 artifact。
- production：migration 前执行 D1 export、记录 Time Travel bookmark、上传 SQL/checksum/manifest 到私有 R2 backup bucket。
- smoke：health、公开列表、静态页、未登录 `/me` 401；上传部署证据。
- 备份验证：新增手动 `verify-production-backup` workflow，校验 R2 对象、SHA-256、SQLite integrity 和表数量。
- 安全：新增 Dependabot 配置；staging/production 继续使用 environment-scoped secrets。
- 文档：新增 `docs/operations/deployment-safety.md`，README 补本地 Playwright 和部署安全说明。

## 仍未完成

- production 首次发布演练和真实 `v*` tag 验证。
- Worker artifact 的 `--no-bundle` 路线已在本地 dry-run 验证，尚未在 staging/production 真实部署验证。
- actionlint、CodeQL、docs-only 轻量 check、CI 成本观察。
- 生产认证配置（Discord vars/secrets）仍需实际值。

# 2026-10 重构历史归档

本目录保存 2026 年 10 月重构过程中的阶段性架构方案、早期功能与补丁盘点、时点审计报告、前端对照记录与已退役迁移脚本说明，**不是当前实现、API 或操作流程的权威来源**。归档文档按历史原貌冻结保留，不随当前实现改写。

## 当前权威文档入口

- 当前接口、协议与运行配置：[`../../reference/worker-api.md`](../../reference/worker-api.md)、[`../../reference/host-protocol.md`](../../reference/host-protocol.md)、[`../../reference/cache-design.md`](../../reference/cache-design.md)、[`../../reference/runtime-configuration.md`](../../reference/runtime-configuration.md)
- 当前使用与运维手册：[`../../guides/using-workshop.md`](../../guides/using-workshop.md)、[`../../operations/legacy-data-migration.md`](../../operations/legacy-data-migration.md)、[`../../operations/deployment-safety.md`](../../operations/deployment-safety.md)
- 当前重构治理、决策与进度：[`../../plans/refactor-2026-10/decisions.md`](../../plans/refactor-2026-10/decisions.md)、[`../../plans/refactor-2026-10/state.md`](../../plans/refactor-2026-10/state.md)、[`../../plans/refactor-2026-10/checklist.md`](../../plans/refactor-2026-10/checklist.md)、[`../../plans/refactor-2026-10/open-threads.md`](../../plans/refactor-2026-10/open-threads.md)、[`../../plans/refactor-2026-10/edge-cache-rollout.md`](../../plans/refactor-2026-10/edge-cache-rollout.md)、[`../../plans/refactor-2026-10/user-actions.md`](../../plans/refactor-2026-10/user-actions.md)

## 本目录归档索引

- **早期架构方案与阻塞记录**：[`brief.md`](brief.md)、[`design-comparison.md`](design-comparison.md)、[`main.md`](main.md)、[`api-design.md`](api-design.md)、[`blocked-decisions.md`](blocked-decisions.md)
- **功能盘点与时点证据**：[`features.md`](features.md)、[`patch-audit.md`](patch-audit.md)、[`api-audit.md`](api-audit.md)、[`cicd-issues.md`](cicd-issues.md)、[`completion-audit.md`](completion-audit.md)、[`frontend-fidelity.md`](frontend-fidelity.md)
- **迁移证据**：[`migration-gates.md`](migration-gates.md)、[`r2-copy.md`](r2-copy.md)。现行操作见[迁移手册](../../operations/legacy-data-migration.md)和[部署手册](../../operations/deployment-safety.md)。
- **仅在 Git 历史保留**：[清理前的归档快照](https://github.com/The-poem-of-destiny/workshop/tree/99cf682d3a46b291bbcf80d74920ea6887ad1971/docs/archived/refactor-2026-10)包含旧前端报告与截图、三份功能审计、后续工作计划及 P0／P4／P5／P6 阶段材料。

保留原因：早期架构与 API 演进背景、旧补丁盘点、已退役工具记录与历史阶段证据可追溯。原始 `model-deepseek.md` / `model-gpt.md` 已删除；其早期裁决结论保留在本目录 [`main.md`](main.md)，现行有效决策统一归口至 [`../../plans/refactor-2026-10/decisions.md`](../../plans/refactor-2026-10/decisions.md)。

# 重构研究证据

这些数字用于校准预期，不是承诺。

## Specification-first convergence

[arXiv:2608.12440](https://arxiv.org/abs/2608.12440)

- 717,725 行 TypeScript、3,648 个文件。
- 任务：拆除一个核心生命周期不变量，跨 189 个文件。
- 流程：写规范 → 对照源码 refine 14 轮 → 冻结 → 实现 → 对照冻结规范 verify 17 轮。
- 31 轮审计，运行前修掉 201 个缺陷；连续两轮零发现才停。
- 3 天，$2,430；首次人工执行无观察到 bug。
- 关键：**规范缺陷在规范阶段修，成本最低；不要让实现 agent 自己评自己。**

## SWE-Refactor

[arXiv:2602.03712](https://arxiv.org/abs/2602.03712)

- 1,099 个纯重构样本；Codex 整体 75.5%。
- 原子重构 82.6%，复合重构只有 **39.4%**。
- 主要失败：只做了一部分、做了另一种变换、测试通过但结构不对（例如空方法骗过测试）。
- 结论：复合重构必须拆；验证要检查“目标变换确实发生”，不能只看测试绿。

## Agentic refactoring 实证

- [arXiv:2511.04824](https://arxiv.org/abs/2511.04824)：agent 重构集中在重命名、类型、注解等低层编辑；结构指标只有小幅改善，代码坏味没有稳定减少；26.1% 的 agent commit 明确含重构。
- [arXiv:2601.20160](https://arxiv.org/abs/2601.20160)：agent 重构高度偏向注解类修改，和人类多样化结构重构不同；仍需与人类提交同等级的质量门禁。
- 含义：**diff 行数、提交数、重构次数不能证明设计改善。** 用删除清单、包边界、LOC/复杂度、查询预算验收。

## 测试与 mock

- [Agentic PR test coverage, arXiv:2607.18057](https://arxiv.org/abs/2607.18057)：agent 只在 49.6% 的改代码 PR 里改测试；现有测试覆盖 agent 改动行 61.5%（Java）/27.0%（Python）。
- [Over-mocked tests, arXiv:2602.00409](https://arxiv.org/abs/2602.00409)：agent 比非 agent 更爱改测试、加 mock；36% vs 26% 的测试 commit 加 mock；mock 过多样例会降低真实交互保证。
- 含义：测试要**少而准**；mock 只用于外部 I/O；不要把“测试数量”当质量。

## Codemod

[AST Codemods for AI Coding Agents](https://negiadventures.github.io/blog/ast-codemods-ai-coding-agents.html)

- 机械迁移用 AST codemod，不让 agent 逐文件手改。
- 流程：扫描 → 写窄规则 → fixture（happy path、alias、spread、已迁移、不支持）→ dry-run → 分批 rollout → 聚焦测试/lint。
- 不支持的情况是成功条件，交人工 lane；不要强行 100% 自动化。

## 对本仓库的推论

1. 先冻结 `decisions.md` + contracts + schema，再写业务。
2. 每个切片只做一个 use case；复合改动拆开。
3. 读路径用旧系统做差分；写路径用状态机/并发测试。
4. 迁移用 extract → transform → load → verify + 对账，幂等。
5. UI 用真实浏览器；Tavern client 用真实 SillyTavern。
6. 删除清单单独执行，不夹带在功能切片里。

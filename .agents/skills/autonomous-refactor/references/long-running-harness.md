# 长任务 harness 参考

来源：

- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Anthropic: Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)

## 问题

长任务不是“一次上下文跑很久”，而是**很多个没有记忆的会话接力**。常见失败：

1. 想一把梭，结果上下文耗尽，留下半实现、无文档的状态。
2. 后来会话看到已有进展，过早宣布完成。
3. 功能没做端到端验证就标记完成。
4. 每轮都要重新摸索怎么启动、怎么测试。
5. 自己评自己，倾向给高分。

## 两段式结构

### Initializer（只做一次）

产出让后续会话能快速接手的基线（默认保存在 `.local/tasks/<task-name>/`）：

- 完整功能清单（`features.json`，建议 JSON 而非 Markdown，减少误改）。
- 进度文件（`state.md`）。
- 启动与冒烟命令（`pnpm dev` / `pnpm check` / `pnpm e2e:local`）。
- 初始基线 commit（在从 `origin/main` 切出的 `worktrees/<task>/` 任务分支上）。
- 架构约束、契约引用、非目标、删除清单。

功能清单每条包含：

```json
{
  "id": "projects-read",
  "category": "functional",
  "description": "Anonymous list returns only public projects",
  "steps": ["GET /api/v1/projects", "assert hidden project absent"],
  "passes": false
}
```

规则：只允许改 `passes`；不允许为了通过而删功能、删测试、改验收标准。

### Coding agent（每轮）

每轮开始：

1. `pwd`，确认位于目标 `worktrees/<task>/` 工作树。
2. 读 `<TASK_DIR>/state.md`、`<TASK_DIR>/features.json`、`git log --oneline`。
3. 跑一次基础冒烟，确认环境没坏。
4. 只挑一个未完成切片。
5. 实现 → 端到端验证 → 更新 `passes` → commit（若当前流程允许提交） → 更新进度。
6. 结束前确保工作树状态干净、边界清晰。

## 上下文：compaction vs reset

- **Compaction**：同一会话内把旧历史压成摘要，保留连续性。
- **Reset**：清空上下文，用结构化 handoff 让新会话接手。更干净，但 handoff 必须够完整。

无论宿主是否默认启用 compaction，都不要依赖对话压缩保存项目状态。项目状态必须落在文件里：`<TASK_DIR>/state.md`、`<TASK_DIR>/features.json`、git commit 以及落盘的验证证据（在支持 `agent://` 的 OMP 等宿主中也只是辅助引用，不能替代任务文件）。

## 评估器

Anthropic 的 planner / generator / evaluator 结构：

- **Planner**：把需求收敛为可执行规范与切片清单；只定交付物与契约，不提前锁死内部实现细节。
- **Generator**：一次一个切片，自己先跑通验证命令。
- **Evaluator**：独立上下文，按冻结的验收标准检查；每个切片先明确完成契约。
- 评估器要“怀疑”，而不是“鼓励”。默认模型评自己的东西会偏乐观。

宿主映射（原生 subagent 或 OMP `task` 可选示例）：

- Planner：主 agent + 决策记录（`.agents/notes/` 或活动计划 `decisions.md`）+ `<TASK_DIR>/features.json`。
- Generator：独立子 agent，独占写入范围或隔离 worktree。
- Evaluator：另一个只读子 agent，审查实际 diff + 运行验收命令，不直接改代码。
- Contract：切片定义里的验收标准，写入子 agent 派发信封。
- 浏览器验证：Playwright / `pnpm e2e:local`；UI 改动必须真实交互验证。

## 本仓库落地

| Harness 概念 | 本仓库归属（参见 [`AGENTS.md`](../../../../AGENTS.md)） |
|---|---|
| 任务私有目录 `<TASK_DIR>` | `.local/tasks/<task-name>/`（Git 忽略，权限 `0700`/`0600`）；共享验收门槛与用户行动清单仅在需要时放入活动 `docs/plans/<plan>/` |
| 功能清单 | `<TASK_DIR>/features.json` |
| 进度与交接 | `<TASK_DIR>/state.md`（“已完成 / 进行中 / 阻塞 / 下一步 / 已知风险”） |
| 持久决策理由 | `.agents/notes/`（或已指定活动计划的 `decisions.md`） |
| 工作树与基线分支 | 从最新 `origin/main` 创建 `worktrees/<task>/` 短生命周期分支（`feature/*`、`fix/*`、`chore/*`） |
| 启动/冒烟 | `pnpm check`、`pnpm dev`、`pnpm e2e:local` |
| Evaluator | 独立只读 reviewer 子 agent；连续两轮零发现 |

## Checklist

- [ ] 本轮只做一个 feature/slice。
- [ ] 开始前跑过冒烟。
- [ ] 验收标准可观察、可执行。
- [ ] 端到端验证，不只单测。
- [ ] 独立 evaluator 检查过。
- [ ] 更新 `<TASK_DIR>/features.json` 与 `<TASK_DIR>/state.md`。
- [ ] 结束时工作树状态清晰、无越界文件。

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

产出让后续会话能快速接手的基线：

- 完整功能清单（建议 JSON，不用 Markdown；模型更少乱改）。
- 进度文件（`state.md` / `progress.md`）。
- 启动与冒烟脚本（`init.sh` / `pnpm dev` / `pnpm check`）。
- 初始 git commit，记录基线。
- 架构、契约、非目标、删除清单。

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

1. `pwd`，确认工作目录。
2. 读进度文件、功能清单、`git log --oneline`。
3. 跑一次基础冒烟，确认环境没坏。
4. 只挑一个未完成功能。
5. 实现 → 端到端验证 → 更新 `passes` → commit → 更新进度。
6. 结束前确保工作树干净、可合并。

## 上下文：compaction vs reset

- **Compaction**：同一会话内把旧历史压成摘要，保留连续性。
- **Reset**：清空上下文，用结构化 handoff 让新会话接手。更干净，但 handoff 必须够完整。

OMP 默认有 compaction；不要依赖它保存项目状态。项目状态必须落在文件里：`state.md`、功能清单、git commit、`agent://` 产物。

## 评估器

Anthropic 的 planner / generator / evaluator 结构：

- **Planner**：把一句话需求扩成产品 spec；只定交付物，不提前锁死实现。
- **Generator**：一次一个 feature，自己先做一轮验证。
- **Evaluator**：独立上下文，按冻结的验收标准检查；每个 sprint 先协商 contract。
- 评估器要“怀疑”，而不是“鼓励”。默认模型评自己的东西会偏乐观。

OMP 映射：

- Planner：主 agent + `decisions.md` / `main.md`。
- Generator：`task` 子 agent，隔离 worktree。
- Evaluator：另一个 `task` 子 agent，只读 diff + 运行验收命令，不改代码。
- Contract：切片文件里的验收标准；写进子 agent 的 `task`。
- 浏览器验证：`browser` / Playwright；UI 必须真的点。

## 本仓库落地

| Harness 概念 | 本仓库文件 |
|---|---|
| 功能清单 | `docs/plans/refactor-2026-10/features.md` + 切片 todo |
| 进度 | `docs/plans/refactor-2026-10/state.md` |
| 启动/冒烟 | `pnpm check`、`wrangler dev`、Playwright |
| 基线 commit | `refactor/2026-10` 分支的首个 commit |
| Handoff | `state.md` 的“已完成 / 进行中 / 阻塞 / 下一步” |
| Evaluator | 独立 reviewer 子 agent；连续两轮零发现 |

## Checklist

- [ ] 本轮只做一个 feature/slice。
- [ ] 开始前跑过冒烟。
- [ ] 验收标准可观察、可执行。
- [ ] 端到端验证，不只单测。
- [ ] 独立 evaluator 检查过。
- [ ] 更新功能清单 / `state.md`。
- [ ] commit 后工作树干净。

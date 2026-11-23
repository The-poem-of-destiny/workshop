---
name: autonomous-refactor
description: Use when an agent must independently plan, execute, verify, or resume a large multi-file refactor or rewrite. Covers spec freeze, vertical slices, parallel subagents, test budget, verification loops, and handoff. 用于大型重构的独立执行、并行切片、验证与交接。
---

# 自主大型重构

目标：在**没有逐步人工确认**的情况下，把重构推进到可验收状态。靠的不是更长 prompt，而是可收敛的闭环：

```text
冻结事实 → 冻结规范 → 垂直切片 → 独立验证 → 连续零发现 → 下一片
```

任务记录目录 `<TASK_DIR>` 默认放在 Git 忽略的 `.local/tasks/<task-name>/`（参见仓库 [`AGENTS.md`](../../../AGENTS.md)）；仅当任务属于需要共享验收门槛与用户行动清单的正式计划时，才将共享治理摘要放在对应的 `docs/plans/<plan>/`，持久设计决策归入 `.agents/notes/`（或已指定计划下的 `decisions.md`）。工作分支按仓库规范从最新 `origin/main` 在 `worktrees/<task>/` 下切出短生命周期任务分支。

## 外部最佳实践（已整理）

主文件只保留核心流程；按需读对应 reference，不要一次性全读：

| 文件 | 何时读 | 内容 |
|---|---|---|
| [`references/long-running-harness.md`](references/long-running-harness.md) | 开始/恢复一次长任务，或发现自己在“一把梭” | Initializer、功能清单、进度文件、context reset、独立 evaluator |
| [`references/dispatch-and-review.md`](references/dispatch-and-review.md) | 要 fan-out 子 agent、合并 worktree、验收子 agent 报告 | 派发信封、状态词、不要信报告、集成顺序、模型分层 |
| [`references/skill-authoring.md`](references/skill-authoring.md) | 修改或新增 skill | 500 行上限、渐进披露、gotchas、checklist、反模式 |
| [`references/refactor-evidence.md`](references/refactor-evidence.md) | 需要校准预期或说服别人为什么切片 | spec-first、SWE-Refactor、agentic refactoring、测试/mock、codemod 的数字 |

默认只读本文件。遇到长任务或并行时，先读前两个 reference。

## 0. 开始前

按顺序读：

1. 仓库 [`AGENTS.md`](../../../AGENTS.md) 与 [`docs/AGENTS.md`](../../../docs/AGENTS.md)
2. 本 skill
3. 本次重构的决策权威（`.agents/notes/` 中的适用决策记录，或活动计划的 `decisions.md`）
4. `<TASK_DIR>/state.md` 与 `<TASK_DIR>/features.json`（若恢复已有任务；若是共享治理计划则同时核对 `docs/plans/<plan>/` 中的当前状态）
5. 相关源码目录的 `README.md`、权威契约与旧行为样本

不要凭记忆假设决策；权威记录没有写的，按“待定”处理，不自行发明产品语义。

完成条件：已确认工作分支／worktree、`<TASK_DIR>` 路径、适用决策源和基线冒烟命令（如 `pnpm check`）可执行且当前状态清楚。

## 1. 不可违反

- **规范先于代码**。接口、错误码、表结构、权限、发布语义先冻结；代码只实现冻结内容。
- **一个切片只做一个可验收变换**。复合重构必须拆开；每个切片能独立回滚。
- **共享文件只有一个 owner**。契约、schema、路由表、根配置、锁文件不能并行改。
- **旧系统只作为产品读语义的参考**，不作为安全、缓存、发布模型的参考。
- **测试取舍先读 [test-maintenance](../test-maintenance/SKILL.md)**。它拥有永久测试准入、维护成本和删除标准；重构不要求每层新增测试，运行验证仍不可省略。
- **不静默缩范围**。做不到就写 `BLOCKED` 和缺什么；不要用 mock、占位、`TODO: implement` 冒充完成。
- **不顺手重构**。删除清单之外的东西先记录，不夹带。
- **不可逆操作要人**：生产部署、真实数据迁移、删旧 D1/R2、改 secrets、Cloudflare 资源变更。
- **每片结束更新 `<TASK_DIR>/state.md`**；新会话只继承文件，不继承对话。

### 长任务 harness（强制）

长任务失败通常不是模型不够强，而是：想一把梭、过早宣布完成、没做端到端验证、没留下干净状态。

- **Initializer 只做一次**：在 `<TASK_DIR>/` 建立功能清单（`features.json`）、进度文件（`state.md`）、启动/冒烟命令、初始基线 commit 与删除清单。
- **每轮只做一个切片**：开始先读 `<TASK_DIR>/state.md` + `git log --oneline`，跑一次冒烟，确认环境没坏。
- **功能清单用 JSON**：只改 `passes`；不允许删功能、删测试、改验收标准来“通过”。
- **结束必须干净**：实现 → 端到端验证 → 更新进度 → commit；工作树可合并。
- **独立 evaluator**：实现者不自评；用新上下文对照冻结规范检查，连续两轮零发现才前进。
- **compaction 不替代状态文件**：项目状态落在 `<TASK_DIR>/state.md`、功能清单、git commit 与任务产物文件。
- **切片契约先于代码**：generator 与 evaluator 先对“done 是什么、怎么验证”达成一致。

## 2. 冻结事实（P0）

写代码前先建立 oracle。没有 oracle 时，规范就是 oracle；有旧系统时，旧系统只是**部分 oracle**。

至少产出（保存在 `<TASK_DIR>/` 或指定参考位置）：

- 路由矩阵：method、path、auth、角色、可见性、输入、输出、错误码、缓存头。
- 权限矩阵：匿名 / 登录 / 作者 / 审核者 / owner 分别能做什么。
- 数据清单：表、字段、行数、FK、公开 id、R2 key、对象大小/hash。
- 公开 API 样本：代表性真实请求/响应，落成 fixture。
- 已知缺陷清单：旧系统哪些行为**不能**成为新系统参考（auth、缓存、发布补偿）。
- 删除清单：路径、表、脚本、产物；每条有引用证据。

样本只覆盖“产品语义”，不覆盖旧实现的偶然行为。旧系统有 bug 时，以已确认的决策记录为准。

完成条件：路由矩阵、权限矩阵、数据清单、已知缺陷清单与带引用证据的删除清单均已落盘，且无未决的产品语义冲突。

## 3. 冻结规范

规范不是一篇散文，而是可执行物：

- `packages/contracts`：zod schema、DTO、错误码、路由常量。
- `apps/worker/migrations/`：目标数据库 schema（上线前空库基线为 `0001_initial.sql`，上线后为有序增量 migration）。
- 等价接口或协议契约文件。
- 每个切片的验收标准（可观察结果，不是“代码写完”）。
- 明确非目标。

规范审计：让**未参与编写**的 agent 对照源码/旧行为逐条找漏洞。连续两轮零发现才冻结。冻结后新增变更必须显式追加决策记录，不静默改写既有约定。

完成条件：契约／schema 通过类型与 schema 检查，独立审计连续两轮零阻断发现，切片清单与验收标准已写入 `<TASK_DIR>/features.json`。

## 4. 垂直切片

切片按 use case，不按技术层：

```text
identity → projects read → catalog/search → install/files
→ author write/revision → submit/review/publish → interactions → admin → jobs
```

每个切片必须写明：

- 输入/输出契约
- 涉及文件与**禁止修改**文件
- 数据表与查询预算
- 权限矩阵
- 失败语义
- 验收命令
- 回滚方式

切片按契约风险选择已有静态检查／行为测试和必要的 storage／HTTP／E2E 运行证据，不机械逐层新增永久测试。缺陷先复现再修复；永久回归测试须通过 [test-maintenance](../test-maintenance/SKILL.md) 准入。

完成条件：每个待执行切片均有自包含边界（独占写入范围、冻结契约、可观察验收命令与回滚方案），互不重叠。

## 5. 子 Agent 与工具规范（按宿主环境映射）

使用当前宿主提供的子 agent、代码检索与任务管理工具；下文中 `task` batch、`agent://`、`xd://`、`prewalk` 等为 OMP harness 的可选语法示例，其他 harness 映射为原生子 agent 派发、消息续接、LSP／搜索工具与模型选择参数。

### 5.1 并行派发

一个独立切片对应一个子 agent（OMP 示例）：

```json
{
  "context": "共享背景：仓库、决策与契约路径、冻结接口、全局约束、禁止修改的文件",
  "tasks": [
    {
      "name": "ProjectsRead",
      "task": "自包含任务：目标、文件、契约、验收、输出格式",
      "solutionSpace": "one vertical slice: read path; contract and schema frozen",
      "isolated": true
    }
  ]
}
```

规则：

- 共享背景写公共事实，单任务描述写本切片细节；子 agent 默认看不到主对话。
- 每个子 agent 必须有唯一写入范围；共享文件由一个 integration owner 串行改。
- 先跑 1 个低风险切片验证模板，再并行 fan-out。
- 子 agent 完成后，主 agent 必须读实际 diff、跑验收命令，不能只信报告。
- 同一子任务的后续补充优先向原 subagent 发消息续接（如 `send_message`，或 OMP `write agent://<id>`），避免重新派发丢失上下文；长报告落入 `<TASK_DIR>/` 并返回路径与摘要（或在支持 `agent://` / `history://` 的环境中按指针读取）。

完成条件：子 agent 写入范围无交叉，且主 agent 已基于真实 diff 与本地命令核实每个子任务产物。

### 5.2 代码导航与批量编辑

- 符号级：优先使用宿主提供的定义／引用／类型检查能力（如 LSP 或 `tsc`；在支持 `xd://lsp` 的环境中可查 references / definitions / diagnostics），改导出符号前先查全仓引用。
- 机械批量：若宿主提供 AST 重写工具（如 OMP `xd://ast_edit` preview + `write xd://resolve`）先做 dry-run 预览并配 fixture，否则在隔离范围内修改后立即跑类型与 lint 验证。
- 文本检索：使用结构化文件与内容检索工具，删除前必须保留零引用证据，不要凭“看起来没用”删。

### 5.3 验证原则

- 一个权威入口：`pnpm check`（format/lint/typecheck/test/build 各自职责清楚）。
- 分层证据：类型、契约、workerd 集成、差分、迁移对账、E2E、真实 SillyTavern。
- 每条验收项对应实际执行的命令和结果；没跑就写没跑。
- 测试通过只证明覆盖路径，不证明 UI、缓存、D1 迁移或生产行为。
- 高风险切片跑**独立 reviewer**（新会话/新 subagent），对照冻结规范找偏差。

### 5.4 进度与模型分层

- 任务清单实时维护阶段与切片；每完成一项立即标记。
- `<TASK_DIR>/state.md` 记录：已完成、当前状态、待办、阻塞、验证证据、下一步。
- 机械实现可交给轻量模型（或在支持的环境中 `prewalk`）；高风险架构设计与最终独立验证留在强模型。

## 6. 派发模板

```text
# Role
你是本切片的唯一实现者。读完以下文件再动手：
- AGENTS.md
- .agents/skills/autonomous-refactor/SKILL.md
- <适用决策记录或契约路径>
- <本切片相关文件>

# Scope
允许修改：<files/dirs>
禁止修改：<shared files, legacy reference, etc.>

# Contract
<frozen types, routes, schema, errors>

# Goal
<observable acceptance criteria>

# Constraints
- 不扩大范围；不顺手重构
- 不新增依赖，除非写明理由并得到批准
- 不用 mock 替代真实集成
- 不写源码文本断言

# Verification
运行：<commands>
必须观察：<output/state>

# Output
STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
FILES: ...
EVIDENCE: <commands + results>
CONCERNS: ...
```

状态词固定；不要用“应该可以”。

完成条件：派发 prompt 完整包含上述七节，子 agent 返回固定状态词及可复现命令证据。

## 7. 验证循环

每个切片按顺序闭环：

1. 运行 `pnpm check`（完成条件：零错误、零警告退出）。
2. 验证新接口与边界的危险行为；是否新增永久测试按 [test-maintenance](../test-maintenance/SKILL.md) 决定（完成条件：高风险契约与失败分支有实际运行证据）。
3. 涉及存储或路由时运行 workerd + 本地 D1/R2 集成或 `pnpm e2e:local`（完成条件：真实本地绑定路径通过）。
4. 涉及公开读路径重构时对照基线样本做产品语义差分（完成条件：非预期差异为零）。
5. 涉及数据迁移改动时运行离线转换／构建／独立校验与对账测试（完成条件：对账报告 `ok: true` 且相关迁移测试全绿）。
6. 涉及 UI 或酒馆客户端改动时在真实浏览器／SillyTavern 桥接场景验证（完成条件：交互与页面状态符合预期）。
7. 启动独立 reviewer 对照冻结规范审查实际 diff 与证据（完成条件：连续两轮审查零阻断发现，方可进入下一切片）。

失败处理顺序：**retry → decompose → alternate → escalate**。只有产品决策、不可逆操作、缺凭据才 escalate。

## 8. 失败模式

| 失败模式 | 症状 | 对策 |
|---|---|---|
| 复合重构只做一半 | 部分调用点未迁、测试只覆盖一半 | 切片 + AST/引用检查 + 独立 verify |
| 测试绿但结构错 | 空实现、mock 回声、只断言非空 | 契约测试 + 真实集成 + reviewer |
| 过细测试阻碍变更 | 每次重构都改大量测试 | 测公共接口，不测实现；删旧断言 |
| 过度 mock | 真实交互没验证 | 只 mock 外部 I/O；优先内存 fake |
| 规范漂移 | 实现与冻结决策／契约不一致 | 规范审计 + 冻结 + 连续零发现 |
| 子 agent 虚报 | 报告 DONE，实际缺文件/测试 | 主 agent 读 diff、跑命令、抽查 |
| 并行冲突 | 两个 agent 改同一文件 | 唯一 owner；worktree；串行合并 |
| 上下文丢失 | 新会话重复劳动 | `<TASK_DIR>/state.md` + 落盘产物 |
| 范围膨胀 | 顺手改无关模块 | 删除清单外只记录，不实施 |

## 9. 交接与收尾

`<TASK_DIR>/state.md` 每次切片完成后更新：

```md
## 当前状态（YYYY-MM-DD）
### 已完成
- <切片>：<验收证据>
### 进行中
- <切片>：<owner> / <剩余>
### 阻塞
- <问题>：<缺什么> / <需要谁>
### 下一步
1. ...
### 已知风险
- ...
```

提交粒度：在授权提交的任务工作流中，一个切片对应一个原子 commit（或一组强相关 commit），消息写清“做了什么、验证了什么、没做什么”；不要提交生成物、secrets、本地快照或 `.local/` 私有记录。

完成条件：`<TASK_DIR>/state.md` 与 `<TASK_DIR>/features.json` 已同步最新验收证据，工作树无未跟踪垃圾或越界修改，所有已运行与未运行验证项可清晰汇报。

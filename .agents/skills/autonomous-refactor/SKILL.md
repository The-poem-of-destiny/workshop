---
name: autonomous-refactor
description: Use when an agent must independently plan, execute, verify, or resume a large multi-file refactor or rewrite. Covers spec freeze, vertical slices, parallel subagents, test budget, verification loops, and handoff. 用于大型重构的独立执行、并行切片、验证与交接。
---

# 自主大型重构

目标：在**没有逐步人工确认**的情况下，把重构推进到可验收状态。靠的不是更长 prompt，而是可收敛的闭环：

```text
冻结事实 → 冻结规范 → 垂直切片 → 独立验证 → 连续零发现 → 下一片
```

## 外部最佳实践（已整理）

主文件只保留核心流程；按需读对应 reference，不要一次性全读：

| 文件 | 何时读 | 内容 |
|---|---|---|
| `references/long-running-harness.md` | 开始/恢复一次长任务，或发现自己在“一把梭” | Initializer、功能清单、进度文件、context reset、独立 evaluator |
| `references/dispatch-and-review.md` | 要 fan-out 子 agent、合并 worktree、验收子 agent 报告 | 派发信封、状态词、不要信报告、集成顺序、模型分层 |
| `references/skill-authoring.md` | 修改或新增 skill | 500 行上限、渐进披露、gotchas、checklist、反模式 |
| `references/refactor-evidence.md` | 需要校准预期或说服别人为什么切片 | spec-first、SWE-Refactor、agentic refactoring、测试/mock、codemod 的数字 |

默认只读本文件。遇到长任务或并行时，先读前两个 reference。

## 0. 开始前

按顺序读：

1. 仓库 `AGENTS.md`
2. 本 skill
3. `docs/plans/refactor-2026-10/decisions.md`（唯一决策源）
4. `docs/plans/refactor-2026-10/main.md`（架构与迁移）
5. `docs/plans/refactor-2026-10/state.md`（当前进度与遗留）
6. 相关源码与旧行为样本

不要凭记忆假设决策；`decisions.md` 没有写的，按“待定”处理，不自行发明产品语义。

## 1. 不可违反

- **规范先于代码**。接口、错误码、表结构、权限、发布语义先冻结；代码只实现冻结内容。
- **一个切片只做一个可验收变换**。复合重构必须拆开；每个切片能独立回滚。
- **共享文件只有一个 owner**。契约、schema、路由表、根配置、锁文件不能并行改。
- **旧系统只作为产品读语义的参考**，不作为安全、缓存、发布模型的参考。
- **测试取舍先读 [test-maintenance](../test-maintenance/SKILL.md)**。它拥有永久测试准入、维护成本和删除标准；重构不要求每层新增测试，运行验证仍不可省略。
- **不静默缩范围**。做不到就写 `BLOCKED` 和缺什么；不要用 mock、占位、`TODO: implement` 冒充完成。
- **不顺手重构**。删除清单之外的东西先记录，不夹带。
- **不可逆操作要人**：生产部署、真实数据迁移、删旧 D1/R2、改 secrets、Cloudflare 资源变更。
- **每片结束更新 `state.md`**；新会话只继承文件，不继承对话。

### 长任务 harness（强制）

长任务失败通常不是模型不够强，而是：想一把梭、过早宣布完成、没做端到端验证、没留下干净状态。

- **Initializer 只做一次**：功能清单、进度文件、启动/冒烟命令、初始 commit、删除清单。
- **每轮只做一个切片**：开始先读 `state.md` + `git log --oneline`，跑一次冒烟，确认环境没坏。
- **功能清单用 JSON**：只改 `passes`；不允许删功能、删测试、改验收标准来“通过”。
- **结束必须干净**：实现 → 端到端验证 → 更新进度 → commit；工作树可合并。
- **独立 evaluator**：实现者不自评；用新上下文对照冻结规范检查，连续两轮零发现才前进。
- **compaction 不替代状态文件**：项目状态落在 `state.md`、功能清单、git commit、`agent://` 产物。
- **切片契约先于代码**：generator 与 evaluator 先对“done 是什么、怎么验证”达成一致。

## 2. 冻结事实（P0）

写代码前先建立 oracle。没有 oracle 时，规范就是 oracle；有旧系统时，旧系统只是**部分 oracle**。

至少产出：

- 路由矩阵：method、path、auth、角色、可见性、输入、输出、错误码、缓存头。
- 权限矩阵：匿名 / 登录 / 作者 / 审核者 / owner 分别能做什么。
- 数据清单：表、字段、行数、FK、公开 id、R2 key、对象大小/hash。
- 公开 API 样本：20–30 个真实请求/响应，落成 fixture。
- 已知缺陷清单：旧系统哪些行为**不能**成为新系统参考（auth、缓存、发布补偿）。
- 删除清单：路径、表、脚本、产物；每条有引用证据。

样本只覆盖“产品语义”，不覆盖旧实现的偶然行为。旧系统有 bug 时，以 `decisions.md` 为准。

## 3. 冻结规范

规范不是一篇散文，而是可执行物：

- `packages/contracts`：zod schema、DTO、错误码、路由常量。
- `apps/worker/migrations/0001_initial.sql`：唯一建库来源。
- OpenAPI 或等价契约文件。
- 每个切片的验收标准（可观察结果，不是“代码写完”）。
- 明确非目标。

规范审计：让**未参与编写**的 agent 对照源码/旧行为逐条找漏洞。连续两轮零发现才冻结。冻结后只追加 `D-xx`，不改历史。

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

切片按契约风险选择已有静态检查／行为测试和必要的 storage／HTTP／E2E 运行证据，不机械逐层新增永久测试。缺陷先复现再修复；永久回归测试须通过 test-maintenance 准入。

## 5. OMP 工具与规范

### 5.1 并行

用 `task` batch，一个切片一个子 agent：

```json
{
  "context": "共享背景：仓库、规范路径、冻结接口、全局约束、禁止修改的文件",
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

- `context` 写共享事实，`task` 写本切片细节；子 agent 看不到主对话。
- 每个子 agent 必须有唯一写入范围；共享文件由一个 integration owner 串行改。
- 默认 32 并发；先跑 1 个低风险切片验证模板，再 fan-out。
- 子 agent 完成后，主 agent 必须读 diff、跑验收，不能只信报告。
- 后续补充用 `write agent://<id>`，不要重新 spawn 丢失上下文。
- 产物用 `agent://<id>` / `history://<id>` 读取；长报告让子 agent 落文件、返回指针。

### 5.2 代码导航

- 符号级：`xd://lsp` 查 references / definitions / diagnostics；改导出符号前先查引用。
- 机械批量：`xd://ast_edit` 先 preview，再 `write xd://resolve`；配 fixture 和 dry-run。
- 文本检索：`grep` / `glob`；不要用 shell 替代。
- 删除前用引用证据；不要凭“看起来没用”删。

### 5.3 验证

- 一个权威入口：`pnpm check`（format/lint/typecheck/test/build 各自职责清楚）。
- 分层证据：类型、契约、workerd 集成、差分、迁移对账、E2E、真实 SillyTavern。
- 每条验收项对应实际执行的命令和结果；没跑就写没跑。
- 测试通过只证明覆盖路径，不证明 UI、缓存、D1 迁移或生产行为。
- 高风险切片跑**独立 reviewer**（新会话/新 agent），对照冻结规范找偏差。

### 5.4 进度与上下文

- `todo` 维护阶段与切片；每完成一项立即标记。
- `state.md` 记录：已完成、当前线上、待办、阻塞、证据、下一步。
- 大调查可用 `checkpoint` / `rewind`（若启用），把过程压成报告。
- 机械实现可 `prewalk` 到便宜模型；高风险设计和最终 verify 留在强模型。

## 6. 派发模板

```text
# Role
你是本切片的唯一实现者。读完以下文件再动手：
- AGENTS.md
- .agents/skills/autonomous-refactor/SKILL.md
- docs/plans/refactor-2026-10/decisions.md
- <本切片相关文件>

# Scope
允许修改：<files/dirs>
禁止修改：<shared files, old system, etc.>

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

## 7. 验证循环

每个切片：

1. `pnpm check` 全绿。
2. 新接口的危险行为有实际契约验证；是否新增永久测试按 test-maintenance 决定，不要求每个接口配一套测试。
3. workerd + 本地 D1/R2 集成覆盖危险路径。
4. 公开读路径跑新旧差分（只比产品语义）。
5. 迁移改动跑 extract/transform/load/verify + 对账。
6. UI/client 改动跑真实浏览器或真实 SillyTavern。
7. 独立 reviewer 对照冻结规范；连续两轮零发现才进入下一片。

失败处理顺序：**retry → decompose → alternate → escalate**。只有产品决策、不可逆操作、缺凭据才 escalate。

## 8. 失败模式

| 失败模式 | 症状 | 对策 |
|---|---|---|
| 复合重构只做一半 | 部分调用点未迁、测试只覆盖一半 | 切片 + AST/引用检查 + 独立 verify |
| 测试绿但结构错 | 空实现、mock 回声、只断言非空 | 契约测试 + 真实集成 + reviewer |
| 过细测试阻碍变更 | 每次重构都改大量测试 | 测公共接口，不测实现；删旧断言 |
| 过度 mock | 真实交互没验证 | 只 mock 外部 I/O；优先内存 fake |
| 规范漂移 | 实现与 `decisions.md` 不一致 | 规范审计 + 冻结 + 连续零发现 |
| 子 agent 虚报 | 报告 DONE，实际缺文件/测试 | 主 agent 读 diff、跑命令、抽查 |
| 并行冲突 | 两个 agent 改同一文件 | 唯一 owner；worktree；串行合并 |
| 上下文丢失 | 新会话重复劳动 | `state.md` + `agent://` 产物 |
| 范围膨胀 | 顺手改无关模块 | 删除清单外只记录，不实施 |

## 9. 交接格式

`state.md` 每次更新：

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

提交粒度：一个切片一个 commit（或一组强相关 commit），消息写清“做了什么、验证了什么、没做什么”。不要提交生成物、secrets、本地快照。

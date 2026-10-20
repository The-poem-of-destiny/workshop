---
name: project-basics
description: Use when setting up or repairing project quality gates: formatting, lint, typecheck, tests, build, pre-commit hooks, CI, or deciding which check proves which claim. 用于项目工程基础、lint/format/typecheck、测试与 CI 门禁、提交钩子和质量证据。
---

# 项目工程基础

目标：让“检查通过”对应一个明确的结论，而不是把 format、lint、typecheck、test、build 混成一句“没问题”。

## 检查门禁

| 门禁 | 证明什么 | 不能证明什么 |
|---|---|---|
| format | 代码风格一致、diff 稳定 | 正确性、可维护性 |
| lint | 已知静态模式、可疑写法、部分 invariant | 架构边界、运行时行为 |
| typecheck | 类型关系自洽 | 输入合法、数据库/网络行为 |
| test | 指定行为在给定条件下成立 | 未覆盖路径、真实环境、UI |
| build / dry-run | 能打包、配置能解析 | 部署成功、线上可用 |
| smoke | 实际入口能响应 | 完整功能、边界条件 |

不要用一个门禁替代另一个。`tsc` 通过不等于测试通过；lint 通过不等于架构正确；build 通过不等于部署成功。

## 工具选择

- **新 TypeScript 项目**：Biome（format + lint）+ `tsc --noEmit` + Vitest。
- **需要 React/a11y 或大量自定义规则**：ESLint flat config + Prettier；不要让 ESLint 和 Prettier 管同一件事。
- **已有 ESLint**：不要为了统一而迁移；先补 `format:check` 和 `--max-warnings=0`。
- **Python**：Ruff（format + lint）+ Pyright/mypy + pytest。
- **Markdown**：markdownlint；本项目已有 `.markdownlint.jsonc`。
- **模块边界**：dependency-cruiser（入口文件公开、子目录私有、测试只走入口、禁止循环依赖），不要用 lint 规则假装架构约束。
- **Cloudflare Worker**：`wrangler types` 生成绑定类型；`wrangler deploy --dry-run` 验证配置与打包；`@cloudflare/vitest-pool-workers` 跑 D1/R2/DO 本地集成。
- **UI**：组件测试 + 真实浏览器检查；不要把快照测试当视觉验证。

## lint 规则优先级

按“能防止真实缺陷”排序，不要先堆风格规则：

1. **正确性**：未使用变量/导入、不可达代码、重复分支、错误的条件表达式。
2. **异步**：未处理的 Promise、浮动 Promise、`await` 误用、React hooks 依赖。
3. **安全**：`eval` / `new Function`、危险 HTML 注入、硬编码密钥、不安全的 URL 拼接。
4. **框架约束**：React hooks、a11y、Cloudflare Worker 不支持 Node API 的写法。
5. **风格**：交给 formatter；不要让 lint 和 formatter 互相改写。

类型感知规则更慢，放在独立 CI job 或只在 PR 上跑；不要为了速度把 correctness 规则全关掉。

## 仓库接线

在项目根或 package 根提供稳定脚本，CI 只调用一个入口。以下以 pnpm 为例，按项目包管理器替换：

```json
{
  "scripts": {
    "format": "biome format --write .",
    "lint": "biome lint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "vite build",
    "check": "biome ci . && pnpm typecheck && pnpm test && pnpm build"
  }
}
```

- `format` 只负责写；CI 用 `biome ci` 或 `format:check`，不要用 `--write`。
- `check` 是唯一权威命令；README/AGENTS 只写这个入口。
- pnpm workspace 下每包拥有自己的 `check`，根用 `pnpm -r check` 或显式顺序编排。
- 生成的类型、构建产物、vendor、快照目录加入 ignore；不要 lint 生成物。
- 工具版本进 lockfile；CI 不跑 `latest`。

## 迁移旧仓库

1. **先基线，不大格式化。** 第一次只对改动文件跑 format/lint，避免一个 PR 改遍全仓。
2. **逐目录 ratchet。** 先把规则设为 warn，稳定后按目录升 error；不要在第一天追求全绿。
3. **CI 从 `--max-warnings=0` 开始只覆盖新代码**；旧代码用 ignore 列表或分阶段目录。
4. **每个 suppression 有理由。** `// biome-ignore lint/rule: reason` 或 `// eslint-disable-next-line rule -- reason`；禁止无范围、无原因的整文件关闭。
5. **不用 `any` / `@ts-ignore` 换门禁通过。** 类型错误要么修，要么收窄到具体行并记录原因。
6. **生成物与手写物分开。** 生成文件由生成器保证；手写文件才进 lint 门禁。

## 提交钩子与 CI 分工

- **pre-commit**：只跑 staged 文件的 format + lint fix + 快速 typecheck；不要在提交时跑完整测试。
- **pre-push（可选）**：跑 `check` 的快速子集；完整套件仍交给 CI。
- **PR CI**：format check、lint、typecheck、test、build/dry-run；不接触 secrets。
- **main CI**：部署 staging + smoke；迁移在部署前执行。
- **tag CI**：production + 人工审批；不要用本地 token 直接发生产。
- Husky v9+ 的 hook 文件不需要 shebang；用 `lint-staged` 限定 staged 文件。
- 没有 Node 包管理器的项目不要为了 hook 引入 Husky；用 CI 和 `check` 脚本即可。

## 证据规则

报告时写清楚：

- 实际执行的命令；
- 结果（通过/失败/未运行）；
- 覆盖了哪个验收项；
- 未覆盖的风险。

不要写“应该能过”“本地没问题”。没跑就说没跑；跑失败就贴失败输出。测试通过只证明测试覆盖的路径，不证明 UI、D1 迁移或 Workers Cache 行为。

## 什么算合理测试

测试是**变更成本**，不是覆盖率 KPI。尤其 agentic coding 下代码迭代快，过细的测试会把实现细节钉死，导致每次重构都要改测试，最后测试成为变更阻力的主要来源。

合理测试只保护**值得保护的东西**：

1. 公共契约：HTTP 状态码、DTO 形状、错误码、SQL 迁移、客户端桥接协议。
2. 危险不变量：权限、可见性、一次性 token、CAS/并发、发布指针、迁移对账。
3. 曾经坏过的 bug：一条回归测试，只测触发条件和修复后的行为。
4. 跨边界集成：D1/R2、workerd、真实浏览器、真实 SillyTavern。
5. 预算与退化：D1 rows read、Worker CPU、包体积、缓存头。
6. 复杂纯逻辑：解析器、checker、fingerprint、排序规则、状态机。优先 property test 或表驱动，而不是逐分支堆用例。

**不要测**：

- 框架接线、路由注册、依赖注入、配置默认值、`JSON.stringify` 之类的转发。
- 生成物、构建产物、第三方库内部行为。
- 源码文本、函数名、文件路径、注释、字符串拼接结果；这些是重构最常改的东西。
- 私有实现细节、内部调用次数、mock 的回声；除非该交互本身就是契约。
- 每个分支、每个 getter、每个常量；typecheck/lint 能证明的不要再用测试证明。
- 为覆盖率补的空断言、`expect(fn).not.toThrow()`、只断言“非空/长度增加”的测试。

**测试层级与预算**：

| 层级 | 测什么 | 数量 | 不测什么 |
|---|---|---|---|
| 纯逻辑单测 | 解析、校验、排序、状态转移 | 少量、表驱动 | I/O、框架 |
| 契约测试 | HTTP/DTO/错误码、bridge 协议 | 每个契约一组 | 数据库实现 |
| 集成测试 | workerd + 本地 D1/R2、迁移 | 每个危险路径 | 所有 CRUD |
| 差分测试 | 新旧系统对同一输入的产品语义 | 公开读路径样本 | 旧系统的安全/缓存缺陷 |
| E2E | 5–8 条真实用户旅程 | 只压关键路径 | 所有 UI 组合 |
| 一次性脚本 | 迁移彩排、性能测量、数据核对 | 不进永久套件 | — |

**agentic coding 的额外约束**：

- 测试站在**公共接口**上，不站在实现结构上；实现移动、文件拆分、函数改名不应导致测试改动。
- 一个切片只加两类测试：验收标准对应的测试，以及修 bug 时的一条回归。不要“顺手补全”。
- mock 只用于外部 I/O（网络、时间、随机、云绑定）；能用内存 fake 就不要 mock；不要 mock 被测对象本身。过度 mock 会测出一套与真实实现脱节的绿。
- 契约变了就**删掉/替换旧测试**，不要为了让旧断言继续绿而加兼容层；旧实现细节测试不重新钉死。
- 测试要能独立、确定、可重复；依赖顺序、真实时间、线上环境、固定账号的测试不算可靠门禁。
- 跑不起、常年 flaky、只验证“能跑”的测试，删除比保留更有价值；删除要在提交说明里写原因。
- 覆盖率只作为**缺口提示**，不作为目标；关键不变量没覆盖时先补关键不变量，不补数字。

判断一条测试是否合理，问三个问题：

1. 它保护的是**行为/契约**，还是**当前实现长什么样**？
2. 实现重构时，它应该继续通过吗？如果每次重构都要改，它太耦合。
3. 它失败时，能否指出一个用户可感知或数据可验证的缺陷？不能，就删。

## 常见反模式

- 配了 lint 但 CI 不跑，配置变成摆设。
- 用 `eslint-disable` / `biome-ignore` 批量压掉告警。
- 在功能 PR 里顺手格式化整个旧仓库。
- 把 typecheck 当测试，把单元测试当集成测试。
- 用 source-text 断言测试实现细节。
- 对生成文件、构建产物、依赖目录跑 lint。
- 把 lint 规则当架构边界；跨包深层 import 需要 dependency-cruiser 或同等机制。

## 完成检查

- [ ] 本地 `check` 全绿，且 CI 跑同一个入口。
- [ ] format、lint、typecheck、test、build 各自职责清楚。
- [ ] pre-commit 只处理 staged 文件，速度可接受。
- [ ] 生成物、vendor、构建输出已排除。
- [ ] suppression 有原因和范围。
- [ ] 证据能对应验收项，未运行项已标明。
- [ ] 架构边界有独立检查，不依赖 lint 规则。


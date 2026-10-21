# Skill 写作参考

来源：[Agent Skills best practices](https://agentskills.io/skill-creation/best-practices)、OMP `docs/skills.md`。

## 核心约束

- 目录：`.agents/skills/<name>/SKILL.md`，只扫描一层。
- frontmatter 必须有 `name` 和 `description`；description 决定何时触发。
- `SKILL.md` 控制在 **500 行 / 5k tokens** 内；细节放 `references/`、模板放 `assets/`、可重复逻辑放 `scripts/`。
- 正文只写 agent **不知道**的东西：项目约定、非显然的坑、具体 API、验收命令。不要解释 HTTP、PDF、数据库是什么。

## 写法

1. **从真实任务提炼**：先做一遍，再记录步骤、纠正、输入输出。
2. **用真实执行 refine**：跑任务，读执行轨迹，不只看最终输出；删掉没用的段落。
3. **一个 skill 一个连贯单元**：太窄会频繁加载多个 skill，太宽无法精确触发。
4. **适度详细**：简洁、分步、带一个可运行例子，优于穷举所有边缘情况。
5. **渐进披露**：主文件放核心流程；细节文件写清“什么时候读”。
6. **按脆弱性决定强制程度**：多种做法都行时解释 why；必须按顺序执行时写死命令。
7. **给默认值，不给菜单**：选一个推荐做法，附一条替代路径。
8. **讲方法，不讲单次答案**：流程要能泛化到同类任务。
9. **Gotchas 高价值**：环境特有、反直觉、不说就会犯的事实。
10. **模板 / checklist / validation loop**：比散文更可靠；批处理先 plan → validate → execute。
11. **脚本**：如果 agent 每次都在重写同一段逻辑，写成 `scripts/` 里的测试过的脚本。

## 本仓库约定

- 主文件：`.agents/skills/<name>/SKILL.md`。
- 细节：`.agents/skills/<name>/references/<topic>.md`。
- 模板：`.agents/skills/<name>/assets/`。
- 脚本：`.agents/skills/<name>/scripts/`，必须有可执行示例和错误处理。
- 引用其他文件时写清触发条件，例如“改 dispatch 规则前读 `references/dispatch-and-review.md`”。

## 反模式

- 把通用编程常识写进 skill。
- 把一次性任务细节冻进 skill。
- 超过 500 行还不拆。
- 给一堆等价选项，没有默认。
- 只写“要小心”，不写具体检查命令。
- 把外部抓取内容原样写入 skill，带指令注入风险。
- skill 与 `AGENTS.md` 重复维护同一事实；单一来源放 `AGENTS.md` 或 manifest。

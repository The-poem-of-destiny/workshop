# 补丁式改动审计（合并）

日期：2026-10-20  
来源：两路独立审计 —— A = `deepseek-v4-flash`，B = `gpt-6.1-sol`。同一份简报、各自独立工作目录、只读仓库。  
本文件做去重、裁决与抽查；**标 ✓ 的结论由主 agent 回读代码确认**。

判定口径：补丁 = 用局部特例让症状消失，而没有修正模型、边界或不变量。  
严重度：**P0** 会导致数据不一致/越权/发布错误；**P1** 旧结构被固化，重写会原样复制；**P2** 死代码、兼容层、测试锁定实现，可随重写消失。

---

## 1. 总表

| ID | 主题 | 位置 | 级别 | 置信 | 来源 |
|---|---|---|---|---|---|
| U01 | 发布用补偿代替事务 | `utils/r2.ts:127-283`、`endpoints/admin.ts:530-690` | P0 | 高 | A F01 / B P-01 |
| U02 | 管理员权限是 token 快照 | `utils/jwt.ts:92`、`endpoints/auth.ts:448`、`endpoints/admin.ts` | P0 | 高 ✓ | B P-02 |
| U03 | 可见性规则复制到 6 个入口 | `endpoints/projects/read.ts`、`index.ts` 文件代理、`utils/db.ts` | P0 | 高 ✓ | A F02 |
| U04 | 安装状态有 4 份事实 | `services/install-identity.ts`、`install-registry.ts`、`install-state.ts`、`installed-transfer.ts` | P1 | 高 | A F03/F04/F12 |
| U05 | taxonomy 与 `tags` 双表示 | `config/project-taxonomy.ts`、`write.ts:189,435`、`types.ts:140` | P1 | 高 | A F05 / B P-03 |
| U06 | 死刷新开关 + 手工清缓存 | `pages/home/api.ts:282`、13 个 mutation | P1 | 高 ✓ | A F06 |
| U07 | 同一字节上传两次 | `pages/home/api.ts:823-870`、`modal/project-editor.ts` | P1 | 高 | A F07 |
| U08 | 审核队列 OFFSET + 客户端去重 | `pages/home/api.ts:982-1027` | P1 | 高 ✓ | B P-04 |
| U09 | 读侧过滤旧草稿，写侧不收尾 | `utils/db.ts:43-57`、`admin.ts:673-681` | P1 | 高 | A F08 |
| U10 | 规范化/派生逻辑 server/client 双写 | `utils/project-preview.ts`、`services/worldbook-normalize.ts`、`utils/character-reference.ts` | P1 | 高 | A F09/F10 |
| U11 | 身份协议多版本常驻 | `install-identity.ts`、`project-type.ts`、`project-inspection.ts`、`repair.ts` | P1 | 高 | A F11 / B P-05 |
| U12 | stale cache 当离线兜底 | `services/project-fetch.ts:115-121,338-342` | P1 | 高 | A F20 |
| U13 | 请求 schema 被绕过 | `endpoints/projects/write.ts:68,199` | P1 | 高 ✓ | A F18 |
| U14 | 订阅语义已变，字段与排序还在冒充 | `utils/db.ts:1764,966-975`、`social.ts`、`index.ts:253-254` | P1 | 高 ✓ | A F19 / B P-06 |
| U15 | 路由 / DO 分流 / 缓存策略三份表 | `index.ts:157-176,358-368` | P1 | 高 | A F25 |
| U16 | 测试断言源码形状 | `cloudflare/tests/*smoke.mjs`（约 49 个） | P1 | 高 | A F21 / B P-08 |
| U17 | 旧排名模块与空操作 | `utils/project-ranking-snapshots.ts`、`project-ranking.ts` | P2 | 高 ✓ | A F13 / B P-07 |
| U18 | 死代码与假功能 | `utils/auth.ts`、`state.ts` 字体、`render/layout.ts` 重复声明 | P2 | 高 ✓ | A F14/F15/F16 |
| U19 | 详情重复返回 preview，每次重解析 | `read.ts:444-480,608-641`、`assets.ts:56-65` | P2 | 高 | A F17 |
| U20 | 一次性迁移变成常驻步骤 | `regex-record.ts`、`config/workshop.json` shim | P2 | 高 | A F22 |
| U21 | 配额/超时写成内联魔数 | `utils/db.ts:27`、`services/install-state.ts:47` 等 | P2 | 中 | A F23 |
| U22 | 边缘自动改错 / host 判定复制 5 份 | `utils/auth.ts:6-20`、`pages/home/api.ts:16-27`、`utils/r2.ts:3-17` | P2 | 中 | A F24/F26 |

---

## 2. 详细

### U01 发布靠补偿，不靠事务（P0）

- 症状：审核通过后可能出现“D1 已批准、R2 还是旧文件”或半套文件。
- 补丁：先改 D1 状态 → 复制 R2 → 失败逐对象恢复 → 再恢复审核状态；rollback 失败只 `console.error`。
- 真问题：发布可见性与内容持久化没有共同边界；R2 复制本身是可变对象的覆盖写。
- 建议：不可变 revision 目录 + D1 单指针切换；失败重试属于发布任务，不在请求栈里回滚。

### U02 权限是签发快照（P0）

- 症状：撤管理员后旧 token 仍有权限；登出无效果。
- 补丁：登录时把 `isAdmin/isSuperAdmin` 写进 7 天 JWT，每个管理端直接信任 payload。
- 真问题：授权事实有两个真相，且没有撤销边界。
- 建议：opaque session + 每请求读当前角色；或带权限版本并可撤销的短 token。

### U03 可见性规则散落（P0）

- 症状：`visibility=0` 的项目不在列表，但拿到 ID 仍能看详情、批量摘要、下载文件。
- 补丁：每个入口各写一遍 `status/is_published/visibility` 判断。
- ✓ 复核：`projectDb.get` 只按 `id` 查询，不带可见性条件；详情端点只判断 `status`；文件代理只判断 `status`。
- 建议：单一 `canViewProject(project, viewer)`，详情/批量/文件/安装/评分全部走它；private 直接 404。

### U04 安装状态的 4 份事实（P1）

- 症状：安装状态与实际世界书条目偶发不一致，需要重扫。
- 补丁：同时写条目内容身份块、`extra.cw_*`、世界书内 manifest、脚本变量 registry。
- 真问题：没有权威安装记录；registry 自己都标注为 advisory。
- 建议：先定唯一权威（D1 行或条目内单一记录），其余降级为可重建缓存；安装定义 prepare/commit 阶段。

### U05 taxonomy 双表示（P1）

- 症状：新分类字段与旧 `tags` 都需要维护，偶尔漂移。
- 补丁：`buildLegacyProjectTags()` 每次双写；migration 写明“保留兼容镜像”。
- 建议：新库只保留结构化字段；需要旧格式时在边界派生，不落库。

### U06 死刷新开关 + 缓存失效散落（P1）

- 症状：`fetchProjects(true)` 看似强制刷新，实际可能读 15 秒缓存。
- 补丁：`forceRefresh = Boolean(forceRefresh && options.bypassClientCache)`，没有调用方传第二个参数；13 个 mutation 各自 `clearProjectListClientCache()`。
- 建议：删除双开关；用 revision/ETag 或统一 mutation 失效；缓存所有权归属于路由声明。

### U07 同一字节传两次（P1，需裁决）

- 症状：选择文件 preflight 一次，提交再 preflight 一次；创建与上传是两次请求。
- 补丁：用重复上传换取 receipt 与内容的绑定。
- 分歧：B 认为这是合理的安全协议（receipt 绑定用户/类型/revision/hash），A 认为是重复传输。
- 裁决：**保留安全语义，去掉重复传输**——单次上传由服务端计算 hash 并绑定 revision；若保留 receipt，则用 hash 复用 preflight 结果，不再重传字节。

### U08 审核队列 OFFSET 补偿（P1）

- ✓ 复核：客户端循环拉到 `total`，用 `seenIds` 去重，超过 200 条合法返回残缺。
- 真问题：队列读取没有稳定 cursor/快照；审核动作会移动 OFFSET 窗口。
- 建议：`(created_at,id)` cursor 或短期 queue snapshot；批准后由服务端返回下一项。

### U09 读侧隐藏写侧失败（P1）

- 症状：队列偶发重复/过期草稿，刷新后消失。
- 补丁：读队列时用相关子查询 `latestSubmittedReviewCondition` 过滤；批准后清理兄弟草稿失败只打日志。
- 建议：一个项目一个当前草稿指针，批准时原子替换并标记旧版本；清理失败进入可观测重试。

### U10 同一规则两份实现（P1）

- 世界书条目规范化：服务端 `project-preview.ts` 与客户端 `worldbook-normalize.ts` 各一套别名/数字映射。
- 兼容状态：`character-reference.ts` 的 TS 计算与批量更新 SQL 的 `CASE` 已分叉。
- 建议：共享 `content` 包，预览/安装/入库读同一份；派生状态不物化，或只由一个函数写。

### U11 身份协议多版本常驻（P1）

- 支持 EJS 身份块、`extra.cw_*`、旧项目名、`[WS][DLC]` / `[DLC][...][WS]` / legacy 头、regex id v0/v1/v2。
- 补丁：每种历史格式留一个解析器，server/client 各一份。
- 建议：定义 vN 协议 + 一次性迁移；迁移完成后旧格式只进异常清单，不做正常路径。

### U12 stale cache 当可用性兜底（P1）

- 症状：网络失败时仍用很久以前的项目详情/世界书源。
- 补丁：正常读有 TTL，失败回退路径跳过 TTL 检查。
- 建议：回退也校验 TTL 与 `expectedVersion`；安装路径禁止 stale fallback。

### U13 请求 schema 被绕过（P1）

- ✓ 复核：`ProjectCreate` 声明 zod schema，但 handler 用 `c.req.json()` 手写校验，schema 里缺 `precautions`。
- 建议：统一 `getValidatedData`；业务校验放在 schema 之后；错误不回显内部 `message`。

### U14 订阅语义与字段脱节（P1）

- ✓ 复核：列表 `enrichProjects` 硬编码 `subscribesCount: 0, userSubscribed: false`；`subscribes` 排序回退成 downloads；同时保留 POST toggle 与 PUT set。
- 与产品决策冲突：你要求**订阅计数公开**，当前实现实际上不展示。
- 建议：只保留幂等 PUT/DELETE；计数由单一写路径维护并真实返回；删除 toggle 与旧排序。

### U15 路由/DO/缓存三份表（P1）

- Hono 路由、`contentServiceKey` 正则、中间件里的缓存路径列表，三份需要同步；`upload-cover` 已不在 DO 分流里。
- 建议：路由注册处声明 `{ runtime, cachePolicy, doKey }`，由同一份元数据生成分流与缓存头。

### U16 测试锁源码（P1）

- 约 49 个测试读源码、切片、断言字符串与顺序；重写会在行为不变时大面积假失败。
- 建议：行为测试走真实 handler/HTTP/DOM；静态成本闸门保留为少数专门脚本。

### U17 死的排名子系统（P2）

- `invalidateCurrentDiscoveryRankingSnapshot()` 是空函数；`project_rank_snapshots` / `project_ranking_days` 只被已死模块与其测试引用；`r2Storage.upload(projectId)` 参数未使用。
- 建议：删除整个模块、表与空操作；旧排序直接 400 或由客户端迁移。

### U18 死代码与假功能（P2）

- ✓ 复核：`readSavedContentFont()` 直接返回默认字体，从不读 localStorage，但 UI 仍允许选择并写入。
- ✓ 复核：`render/layout.ts` 中 `renderProjectsGrid`、`renderDiscoverShelf` 各声明两次（后者覆盖前者）；订阅/我的项目分支存在不可达代码。
- 建议：删除；字符串 UI 重写时加 `no-redeclare` 与不可达分支检查。

### U19 详情重复返回 + 每次重解析（P2）

- `ProjectFetch` 同时把 preview 放进 `project` 和顶层；每次详情都从 R2 读两份 JSON 重新 parse。
- 建议：上传时物化摘要；响应只保留一份；大内容走独立端点。

### U20 一次性迁移常驻（P2）

- 每次 mutation/扫描前跑 `migrateCreativeWorkshopLegacyRegexRecords()`；`legacyShimPath` 与 self-rewrite 常驻。
- 建议：迁移完成标志 + 截止版本；shim 只保留一个下架周期。

### U21 内联魔数（P2）

- 每日下载 15000、每人点赞 100、修复 40、扫描超时 2.5s/8s 等散落在代码里。
- 建议：集中策略配置 + 结构化拒绝原因 + 可观测性。

### U22 边缘自动改错（P2）

- OAuth redirect 路径不对时自动改写；错误文本正则映射成友好文案；R2 key 从 URL 剥离；host 判定复制 5 份且实现不一致。
- 建议：边界显式失败；错误码结构化；共享 `isPreviewHost`。

---

## 3. 两路审计的分歧与裁决

| 争议 | A | B | 裁决 |
|---|---|---|---|
| attestation / 双次上传 | 重复传输，是补丁 | 合理安全协议，不应简化 | 保留安全绑定，去掉重复字节；见 U07 |
| 客户端列表短缓存 | 死开关 + 分散失效，是补丁 | 合理 UX 容错 | 缓存本身保留，重做失效所有权；见 U06 |
| R2 备份/回滚 | 补偿式事务，是补丁 | 补偿是补丁，但回滚能力可保留 | 发布任务内部可实现，不放在审核 handler；见 U01 |
| DO 转发 | 排除（合理平台边界） | 明确“不是补丁” | 一致：保留 DO，删分发器；见 U15 |
| 订阅计数 | 旧字段应删 | 仅指 toggle 协议 | 产品要求公开计数，因此保留字段但重做写入；见 U14 |
| 测试数量 | 49 个源码断言 | 同类结论，但只点名少数 | 一致：整体替换为行为测试 |

---

## 4. 不是补丁（合并两路结论）

1. **`CodeCheckService` DO 转发**：Free 下 Worker 10ms / DO 30s，把大 body 与解析放进 DO 是平台约束；问题只在路由分发方式。
2. **上传 attestation 的安全语义**：receipt 绑定用户、类型、checker revision 与精确 hash；问题在重复传输。
3. **点赞计数触发器**：同一事务内维护 `likes_count`，属于物化读模型。
4. **公开项目计数触发器 / recount**：读模型维护 + 迁移修复入口。
5. **R2 代理的 `private, no-store` 与下载计数**：缓存语义与计费边界。
6. **项目列表客户端短缓存**：按用户与查询隔离，只在短窗口回显；问题是失效所有权。
7. **排名预计算与时间窗口**：把排序成本移出热路径；发现冷却与 featured 数量是产品规则。
8. **日限额、revision 校验、`content_mutation_token`**：并发与滥用防护，方向正确，问题是实现分散。
9. **世界书两阶段替换**：SillyTavern 侧确实需要暂存/切换；外层多存储 saga 才是问题。
10. **OAuth 结果保留 5 分钟供 WebView 重试**：有产品理由；真正问题是 state/redeem 的绑定方式。

---

## 5. 重写前必须定方案（最终结论见 `decisions.md`）

1. **发布一致性**：不可变 revision + 指针切换（主方案已定）。
2. **权限撤销**：opaque session + 每请求读角色（主方案已定）。
3. **访问策略**：单一 `canViewProject`，private 两态（主方案已定）。
4. **安装权威**：D1 记录 / 条目内单一记录 / 两者关系，必须先定。
5. **共享格式**：条目规范化、兼容状态、身份协议各只有一份实现。
6. **缓存所有权**：路由声明失效策略，而不是每个 mutation 手工清。
7. **队列契约**：cursor 或 snapshot，不能再让客户端拉满去重。
8. **兼容截止**：哪些旧格式在新系统彻底消失（tags 镜像、订阅 toggle、旧排名、旧 shim、旧身份解析）。
9. **测试边界**：行为测试与静态成本闸门分开。

## 6. 可随重写消失

U05、U13、U14 的旧字段/协议、U17、U18、U19 的重复形状、U20、U21（保留语义、重写配置）、U22，以及 U16 的源码断言测试。前提：新 API/新库不保留旧字段与旧路径。

## 7. 对功能清单的影响

- **D-04 订阅计数公开**：当前代码硬编码 0，属于功能缺失而不是缓存问题；新实现必须真正计算并返回。
- **E6 attestation**：保留“内容与 revision 绑定”的语义；是否保留 receipt 由实现方式决定。
- **C12/C13 安装登记**：必须先定权威记录，否则 React 化后仍会出现“部分完成，请重扫”。
- **D6 上传检查**：单次上传 + 服务端校验，不再二次传字节。

## 8. 抽查记录

已回读确认：`projectDb.get` 无可见性过滤；`enrichProjects` 硬编码 `subscribesCount: 0`；字体读取忽略 localStorage；`render/layout.ts` 两个渲染函数各声明两次；`ProjectCreate` 绕过 zod；审核队列客户端 `seenIds` 去重与 200 上限。其余条目来自两路审计原文，未逐条复读。

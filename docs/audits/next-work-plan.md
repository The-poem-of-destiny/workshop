# Creative Workshop 后续工作规划审计

## 1. 总体结论

审计基准：本地 `refactor/2026-10`，`0ce8f845e558ef123427a274ff6d753301f2df64`。已完整读取用户指定的五份计划/状态文档和三份审计；按冻结的 `decisions.md` 裁决，不把历史报告当作当前实现。本文是规划，不修改 checklist，不实施修复，不 commit/push/部署，不查询线上或读取凭据/生产备份。

**结论：checklist 可作缺口索引，不可作验收账本，更不可据此宣布生产切换。** 大部分未勾项与当前代码吻合；已勾项混合了“局部实现”“历史运行记录”“完整用户旅程”，证据粒度不一致。当前是 backend-only 的可复用基础，不是完整工坊：公开读、CAS/不可变修订、人工 D1 指针发布、幂等互动存在；真实登录、Checker 权威链、新客户端、管理写入、调度/缓存与完整 UI 尚未闭环。

### 1.1 已勾选项中被高估的范围

| checklist 定位 | 可保留的窄结论 | 不能据此推导的结论 |
| --- | --- | --- |
| §0 `pnpm check`、§1 workerd 集成、§12 测试数量 | 有统一脚本及 Worker/domain/迁移测试源码 | 不证明 T2/T3/T6、浏览器旅程、Free 预算、真实 OAuth 或安装安全完成；测试数量不是验收标准 |
| §2 flow、`GET /me`、登出、角色 | Origin 入口校验与已有会话的查库/撤销路径存在 | 不能从创建 flow 推导可登录；无 callback/redeem/device 与生产 session 签发路径 |
| §3 公开读、匿名详情 | 摘要与公开计数可读，release 文件有登录门禁 | D-03 的条目索引、B10 的基线 items/hash、分页/标签/作者筛选、发现/周期排序仍缺 |
| §4 上传/冻结/submit、单次上传 | 有 MIME/大小/hash、条件写入与冻结机制；D-34 的二次上传已移除 | 未调用结构/类型策略校验，不能算“合规内容上传/提交”；缺 gate 时也不是规定的转人工 |
| §6 审核/发布、§9 管理 | 有人工批准/拒绝与单 batch 切发布指针、角色管理 | 非 D-09/D-31 的权威审核闭环；任意 checkerVersion/report、空拒绝理由、不可读审核封面仍是缺口 |
| §7 下载计数 | user/project/day 去重与触发器原子计数存在 | POST 返回 204，尚未交付一次性取件地址/消费 |
| §10 公开列表/详情/搜索/响应式 | React 页面与 CSS 断点存在 | 默认无搜索时排序结果被 `home.latest` 遮蔽；无完整作者/管理 UI，CSS 断点也不等于设备交互验收 |
| §12 真实备份、本地 E2E、浏览器、staging 演练 | `state.md:46–53`、`archive/p4-migration.md:28–47`、`archive/p5-cutover.md:15–40` 记录了历史执行 | 本次未复核线上；历史 staging version 不等于当前 HEAD 已部署，空库/种子数据冒烟不等于真实数据 cutover |

### 1.2 相对旧审计已过期的结论

三份审计针对 `e103ee4`，不是 `0ce8f84`。两次清理是**位置与保留状态变化，不是缺失功能已实现**：

- `af049aa` 移除当前树 `src/CreativeWorkshop`、`util/`、`config/`、`test-dist/`、webpack 与 `.github/workflows/bundle.yaml`。不能再说“当前客户端仍构建、当前离线 checker 是死产物、当前 bridge 仍暴露配套脚本健康检查”。这些只在历史/`../workshop-legacy` 参考中存在。D-08 在当前树的旧实现删除已发生，但新客户端仍须防止重引入；客户端用户旅程仍未交付。
- `0ce8f84` 删除 `tests/fixtures/legacy/*`（Git 清单为 17 个 JSON）与 `tools/p0-capture.mjs`；“fixtures 尚在、只是未接测试”已过期。T6 必须先从 Git/legacy 读取恢复并筛选样本，不能引用不存在的目录。
- 官方基线移至 `apps/tavern-client/data/official-card-baselines/`；`apps/tavern-client` **目录存在，但只有数据，不是客户端包或可运行产物**。`packages/content` 仍未建立。根 `pnpm build` 现在只构建 Worker Web（`package.json:7`），不再构建旧客户端。
- `state.md:78–93,101–117` 已吸收三份审计并记录客户端移出与广泛缺口；旧报告“state 未提这些缺口”“仍宣称整体 CLEAN”的指控不能按旧行号继续套用。`state.md:35,58` 的短 FTS 正面声明仍与后面的 LIKE 缺口声明及代码矛盾。
- 旧审计的 done/partial/missing 数量只能作历史统计，不能平移到当前树；尤其 D-08、C/H 客户端与 T6 的状态应重新标注。

### 1.3 证据边界

本次代码结论以路由→存储→D1/R2→DTO→既有测试的静态追踪为基础；不因表/路由存在而判端到端完成。实际运行与未运行项目在 §5 单列。用户限制只允许写本文，故不安装依赖、不构建产物、不启动会写 `.wrangler` 的本地演练，也不改现有证据文档。


## 2. checklist、audits、features、decisions、state 的矛盾和缺口

### 2.1 需要先统一的规范与证据口径

| 来源冲突/遗漏 | 当前证据与裁决 | 后续动作 |
| --- | --- | --- |
| checklist §4/6 的已勾“上传/提交/审核” vs §4/5/6 未勾校验与绑定 | 前者只覆盖机械路径，后者决定能否安全发布；不能把局部勾选解释成该 use case 完成 | 后续实现时按“HTTP 输入→策略→冻结资产→报告→指针→消费者”记录证据，不靠测试总数 |
| `state.md:35,58` 称短 FTS 可用 vs checklist §3、audits 称 LIKE | 当前 `storage/projects.ts:123–144` 是 LIKE 短分支；建表/`check-schema.mjs:77` 可 MATCH 不等于 HTTP 使用 | 以代码为准，修查询并验证 HTTP 与读预算 |
| D-30 元数据即时生效且内容 revision 不变 vs 当前 PATCH | `storage/authoring.ts` 的 `patchProject` 新建 revision，公开 DTO 又从 published revision 取字段；已发布项目编辑元数据不能按 D-30 立即生效 | 在扩大版本/元数据前冻结项目可变元数据与 release 固有属性边界，保留 D-11 不可变内容；不是给每次标题修改增加内容审核 |
| D-31 upload/review revision 可不同 vs 当前单个 `submissions.checker_revision` | 提交使用客户端 `checkerRevision`，审核又接受自由 `checkerVersion`；简单“审核版本等于客户端版本”仍错误 | 分离 `client_checker_revision` 与服务器固定的 `review_checker_revision`；P0 止血不能变成永久错误约束 |
| `features.md:256` 要卡片与详情警告 vs D-27 `decisions.md:217` 只详情 | 以唯一决策源 D-27 为准 | 卡片不加 warn 角标；详情分组展示；作者预检提示另行保留 |
| D-09 block/missing 不跑 DO vs `features.md:228,288`“人工基于 DO 报告” | block/missing 分支按设计没有自动 DO 报告，不能用伪造空报告冒充 | 区分未验证客户端摘要与权威结果；人工查精确冻结文件，一票决定并绑定服务器固定 review revision/hash；辅助重跑遵守 D-31，不能偷偷把全部分支塞回 DO |
| 旧 gate `accept/reject`、audit、certification vs 新 `pass/warn/block` | 历史 `report.mjs:83–91` 只有 high L1–L7 导致 reject；M1/M2/M5 和语法/预算 high 可仍 accept、但 certification fail | 将转换放在 Checker 公共内核，先形成有依据的显式契约与差分样例；业务层不得按类型/规则名再判人工，也不得把所有 accept 自动映射 pass |
| 旧预算 120s vs DO 30s CPU（D-01/D-31） | 历史 `limits.mjs` 的 120s 是浏览器超时，非 DO 可执行 CPU 承诺 | 保留规则预算并分开记录运行时上限；DO 中断最多三次后转人工，不自动拒绝、不静默放行 |
| merged §4 写 `PUT /admin/site` vs main §5/checklist §9 | 主计划与现有读入口是 `/api/v1/site`；`routes/site.ts` 只有 GET | 采用 `PUT /api/v1/site`，权限属于管理，不另建第二套同义路径 |
| checklist §8 的旧 shim/兼容选项 vs D-33 | 源码移出不等于“一个周期”下架窗口已履行；也没有证据能定义其截止日 | 分发层交付一次迁移提示及过渡 shim；若选择 API 兼容，必须维护 D-29 登录/可见性边界，不恢复匿名旧文件漏洞；未确认窗口结束不得宣布已合规下架 |
| checklist §0/§12 的历史运行勾选 vs audits 的“已验证” | A/B 都明确未运行测试；merged 引用 `pnpm check` 是证据入口，不是独立执行日志 | 为后续每个勾选附 SHA、命令、环境、输出、未覆盖项；线上记录须另有 Worker version |
| checklist 开头“所有空项关闭” vs 结尾只枚举部分章节 | `checklist.md:5` 与 `:169–172` 不同；Q 项未定，不能靠忽略 §3/7/运维项缩范围 | 用更严格的全项门槛；待定项需正式决策记录后才能完成/移出，不把 blocked 当 done |

### 2.2 审计自身需纠正的建议

- B §5.2 提议短 FTS 可回退 LIKE、甚至删除短索引，与 D-14 相悖；本计划不采纳。
- A/B/merged 把“checker 源码不存在于当前树”延伸为环境阻塞，`state.md:114` 也如此表述。`git ls-tree 2aa31fb^` 已确认规则源码、vendor notices、构建入口、测试语料及外链策略可恢复；这是待实现任务，不是缺信息。离线旧 bundle 本次也可从 Git 直接在内存执行。
- B 的封面“无尺寸/解码”应收窄为 D-30 要求的 MIME/大小/尺寸；**不解码大图**是明确约束，不能据审计建议加入重图像解码。
- merged §5 把 R2 适配器未实现整体算“有意延期”过宽：实现与本地复制验证可以推进；远端导入才受目标/授权约束。缺 Discord secret 同样只阻塞真实交换验证，不阻塞代码实现、负面授权边界和本地行为验证。
- `reviews.submission_id UNIQUE` 不等于跨 submission 历史丢失；但 D-31 显式重跑/自动结果/人工覆盖要求可追溯多次报告，不能继续把唯一 final review 当成全部历史。需独立保存检查运行/报告版本并给审核详情读取。
- A 把匿名条目索引缺失列为 partial，B 却把 D-03 标为 done。当前 DTO 只有计数而非条目索引；保密边界可保留，功能完整性不能勾满。

### 2.3 全量覆盖回查

以下映射把 features 的所有保留/重做功能纳入 §4 工作项；“删除”项作为反向约束，不重新实施。

| 功能集合 | 后续工作项 | 易遗漏的验收 |
| --- | --- | --- |
| A1–A6 | W15、W18、W22 | A5 仅测试构建的预览管理员；不许生产认证旁路 |
| B1–B10、B12 | W02–W03、W16–W20 | 摘要条目索引、reference version items/hash、匿名发现同小时集合、作者筛选而非作者主页 |
| B11/G5 | W24（BLOCKED Q-10） | 不能把缺接口/配额表说成只是 UI 收起 |
| C1–C14、C16–C20；H1–H3、H5–H8 | W12–W14、W19、W21–W23 | 免责声明、自定义服务地址、目标世界书、命名兼容、选择性更新、卸载恢复、修复、转移、正则身份及 staging 别名；不能以安装成功代替全部 |
| C15/H4、E6、F7/F8/F12、I6、T1 | W12/W22 的禁止回归 | 不恢复依赖健康检查、收据/二次上传、计数重算/旧待审清理暗门、站外通知、源码文本断言 |
| D1–D15 | W01、W04–W07、W09、W16、W19–W20 | 单条目删除→新修订；软删→清理；拒绝可读；兼容性/注意事项/引用检查；我的列表 |
| E1–E5、E7–E10、§12/§13 | W09–W11、W22 | 全规则/报告投影/预算/版本固定/lease/超时/人工与自动审计；离线可重建入口 |
| F1–F6、F9–F11、F13 | W04–W06、W11、W17、W20 | Q-06 阻塞稳定队列契约；审核三种文件与条目 diff；设置/精选/基线写权限与审计 |
| G1–G4 | W08、W18、W22 | 现有幂等/私有评分不可破坏；一次性地址不能放松 session 与项目权限 |
| I1–I5、I7 | W03、W20、W22 | 实际页面排序、手机交互、Toast/确认、Discord、作者信息、Banner 位置缩放、无 CDN 依赖 |
| J1–J8、T2–T6 | W10、W18、W22–W23 | 调度、cache/rows 预算、错误日志、定期备份恢复、artifact 提升、迁移与真实用户旅程 |

Q-05（安装状态权威来源）、Q-06（稳定 cursor 或短期 snapshot）、Q-10（抽签去留）均保持 **BLOCKED**。可以准备消费者需求和验证样本，不能替三项选择实现。

### 2.4 迁移“verify 全绿”还有额外边界

`tools/migrate/lib.mjs:300–338` 校验 ID 存在、计数与 hash 元数据，但没有验证 published/working 指针所属同一个项目，也没有验证 approved 内容策略。项目指针在 `0001_initial.sql:54–55` 甚至没有 FK。本次纯内存输入“p 的发布指针指向 q 的 rq、两项目已发布但零资产”，`verify()` 仍返回 `ok:true, foreignKeys:true`；这是实际观察，不是线上数据缺陷的断言。

另外 `mergeUsers():125–145` 取权限最高值，未产出权限冲突阻塞；`roleUser():186` 在 ID 不匹配时回落第一位用户。`transform():197–279` 没有站点设置、日指标、ranking/discovery 的映射生产路径，虽然 TABLES 列出了它们；`reconcile(transform(source), target)` 无法发现 transform 自身遗漏。`cli.mjs:64` 的 all 还只是 expected 与自身 reconcile。故 §7.2 的“全部数据语义对账”不能用这些通过记录替代；W23 必须把源表覆盖、丢弃/冲突清单、对象真实字节和目标实际导出纳入门禁。


## 3. 按依赖顺序的优先级计划

优先级不是串行瀑布；依赖图与可并行边界见 §5。每项完成必须交付消费者可观察的行为、失败语义与运行证据，不能只补表或返回占位值。

| 阶段 | 先做什么 | 依赖与阶段出口 |
| --- | --- | --- |
| **P0 正确性** | W01 内容结构/项目类型策略；W02 短 FTS；W03 默认排序；W04 私有草稿/管理员封面；W05 拒绝理由；W06 checkerVersion 绑定；W07 Discord allowlist；W08 一次性下载 | 八项都必须覆盖。W01 的大 JSON 校验/hash 先接真正的 ContentService DO，不能为了“低风险”继续塞进普通 Worker 10ms。W06 先分清客户端版本与权威版本，最终出口依赖 W09 的真实 review 构建。W08 先冻结一次性取件粒度，不把多个文件误用一个只能消费一次的 URL |
| **P1 Checker 内容与信任链** | W09 原规则/报告/语料/两个 bundle；W10 提交记录、DO 权威检查、cron lease/三次重试/自动发布；W11 人工报告、diff、显式重跑与审计 | 源码来自 `2aa31fb^`，规则不发明；旧报告→新 gate 的转换必须先冻结，无法证明映射前**停止自动发布接线**。客户端 block/missing 不调用 DO；warn 只在详情显示 |
| **P2 分发与认证** | W13 `/client/*`、R2/version/channel 发布；W14 精确门禁与过渡提示；W15 callback/redeem/device/session、guild/CORS/CSP | W13 与 W15 可和 Checker 独立推进；W14 依赖真实 channel 记录与 W12 消费者。没有 secret 只停止真实 Discord 验收，不停止其余实现；没有真实 ST 只停止真实安装旅程验收 |
| **P3 产品闭环** | W16 项目版本/元数据；W17 Admin 写；W18 榜单/周期/清理/cache/预算/备份；W19 作者生命周期与基线；W20 Web 作者/管理 UI；W12 新 Tavern client | W16 的字段/元数据边界要在 W09–W15 并行期先冻结，避免客户端/UI 重做 DTO。Admin/UI 不能靠手工 SQL 或测试 session 冒充。Cache 最后开启，先解决 revision 可见性与 purge |
| **P4 证据与迁移出口** | W22 T2/T3/T6 与 5–8 条 Playwright；W23 CI artifact、R2 copy、目标对账、cutover 演练 | 测试随每片交付，不拖到最后统一补。W23 的实现/本地彩排可提前；真实 staging/生产操作必须有目标与授权。Q-05/Q-06/Q-10 保持 W21/W24 blocked，不自行选答案 |

**新增必须前移的 P0 风险**：`app.ts:44–49` 只查项目 public，不查资产 revision 是否已发布；公开项目的新草稿 cover 只要已知 URL 就可匿名读。本次用当前 SQL 与内存 SQLite 复现查询返回 `{found:1}`，尚未执行 HTTP/R2 取件。W04 要同时修“作者读不到私有封面”和“匿名能读未发布封面”，不是简单给全局资产路由加作者例外；W18 缓存开启以前必须关闭该缺口。


## 4. 工作项目标、触点、验收、依赖与风险

以下编号是执行/验收单元，不是新增产品范围。拟新增文件名不作为“已经存在”的证据。共享 schema/contracts/路由装配由同一集成人负责；既有 staging 已应用 0001，后续变更使用增量 migration，不重写历史已应用结构。

### W01 — 内容结构与项目类型策略（P0）

- **目标/触点**：上传/提交真正调用 `packages/domain/src/project-content.ts:169–222` 的 `validateProjectContentText` 与 `content-policy.ts:45–63` 的 `validateProjectContentPolicy`；接 `routes/authoring.ts:124–161`、`storage/authoring.ts:291–388`。移除吞 JSON 错误后 count=0 的宽松计数；大 JSON 的解析、计数/hash 放入 D-01 ContentService DO，Hono 显式调用，不恢复旧正则分流器。
- **验收证据**：实际 HTTP 拒绝非法 JSON、空世界书/正则、文件种类错传、角色仅 regex、空 revision；扩展仅合法 regex 可提交。失败不产生 submission、不冻结草稿、不改变发布指针。上传/submit 竞态只允许同一冻结资产集合；审阅 hash 与最终 release bytes 一致。旧 `authoring.test.ts:99–112` 中以空世界书上传成功为前提的用例改用有效业务输入，不重钉缺陷。
- **依赖**：已有 domain 足够启动；DO binding/迁移与快照/CAS 需要一名 owner。上传格式校验不能在传第一份文件时误判“另一种必需文件尚未传”为整个项目不可创作；项目类型策略在完整提交出口执行。
- **风险/阻塞**：10MiB 解析留在 Worker 会违反 10ms 预算；先验证后冻结会有 TOCTOU，先插 submission 后异步算 hash 又可能留下半初始化提交。需将验证结果与原子冻结的资产身份关联，失败保持可编辑。无外部凭据阻塞。

### W02 — 1–2 字 FTS 与标签语义（P0）

- **目标/触点**：`storage/projects.ts:123–144 searchPredicate` 改用已维护的 `project_search_short MATCH`，复用 `0001_initial.sql:334–345,361–433` 的短字符表示；保留 ≥3 字 trigram 与标签检索，不以 LIKE 兜底替代 D-14。
- **验收证据**：HTTP 用 1 字/2 字中文、标签命中、作者名、引号/FTS 操作字符及非 BMP 字符检索；公开结果无 private/deleted；更新/删项目后索引同步。真实 D1 查询计划/rows-read 预算证明没有短词全表扫描；仅“搜索有结果”的现有测试和 `check-schema.mjs:77` 不足。
- **依赖**：W18 预算阈值共同验收；与一般 list/filter DTO 变更由同一个 catalog owner 集成。
- **风险/阻塞**：短索引按字符切分，不能直接把原始字符串作为 MATCH；字符 AND/短语边界须对照旧检索行为，不能新增臆测的标签语义。无 Q 项阻塞。

### W03 — Web 默认排序（P0）

- **目标/触点**：`web/src/App.tsx:63–70,108` 当前请求随 sort 变化，渲染却用 `home.latest`；统一用列表查询结果作为数据源，不保留长期遮蔽结果的“占位货架”。`storage/home.ts:70–80` 的六条 latest 不得变成整个首页列表。
- **验收证据**：种子项目的更新时间、发布时间、下载、点赞次序各不相同；无搜索与有搜索时点击四个 tab，观察实际 DOM 顺序与请求参数一致，清空搜索仍正确。快速切换不得由旧请求结果覆盖当前排序。
- **依赖**：独立低冲突切片，可先于身份/Checker；由 Web owner 最终接 W20 分页与筛选。
- **风险/阻塞**：静态读代码可定位 bug，本次未做浏览器复现；修复验收必须实际浏览器操作，不用源码字符串断言替代。

### W04 — 私有草稿、审核封面与 revision 级授权（P0）

- **目标/触点**：统一封面授权：`app.ts:39–61`、`storage/authoring.ts:108–117`、`routes/admin.ts:60–77`、`storage/admin.ts:246–256`。公开 URL 只服务已发布且 public 的 revision；作者可读自己的草稿，reviewer/owner 可按 submission 读 cover；私有响应 `no-store`，banner 单独校验实际登记归属。
- **验收证据**：私有草稿作者 200、匿名/他人 404；pending cover 审核者 200、普通会员无权；公开项目 cover A 可读，未发布 cover B 即使已知 key 也 404，批准 B 后才公开。隐藏/删除后新请求不可读。测试要真正 GET 图片字节，不止断言 coverUrl 字段存在。
- **依赖**：无外部阻塞；必须先于 W18 公开缓存。作者 UI 的 `<img>` 不会自动携带 Bearer header，需通过已认证取件→Blob 或明确的安全私有图片交付路径接线，不能把 session token 塞进 URL。
- **风险/阻塞**：不能仅把 `public OR author` 加进原 SQL 而继续泄漏公开项目草稿；也不能给私有文件设置共享缓存。

### W05 — 拒绝理由与作者可见历史（P0）

- **目标/触点**：`contracts/src/admin.ts:20–25` 对 reject 强制非空理由，`storage/admin.ts:290–310` 同时保存 review 与审计理由；作者 draft/我的项目/投稿状态 DTO 增加目标 submission/revision 的拒绝状态和原因。
- **验收证据**：缺失/空白理由拒绝为 4xx 且不改状态、不写假审计；有效拒绝作者可读、他人不可读；重提后上一轮理由/内容快照仍在，当前状态不误标为旧拒绝。approve/reject 并发仅一票成功、另一票 409。
- **依赖**：W11 历史报告读取、W19 作者列表、W20 展示。普通批准不强造理由，但 D-09 要求的人工覆盖自动结果必须说明原因，不能用“approve 不接收 reason”阻断该规则。
- **风险/阻塞**：目前审计 detail 只有 project/revision/checkerVersion，不含 reason；不能只改表单 required。无外部阻塞。

### W06 — checkerVersion 止血与权威快照绑定（P0→P1）

- **目标/触点**：`submitProjectSchema:32–35`、`storage/authoring.ts:375–387`、`reviewAdminSubmission():259–337`、`admin-review.test.ts:87–99`。分离不可信 client revision 与服务器固定 review revision；禁止审核请求自由覆盖，旧测试不得继续把 checker-1→review-2 当正确行为。
- **验收证据**：同一 submission 的权威报告、人工决定、manifest/content hash、固定 review revision 相符；错 revision/hash/report 来源返回 409 且不写 review/audit、不动发布指针。checker 升级不改变 pending submission；只有显式重跑可切版本并留下旧报告与审计。
- **依赖**：W09 提供真实可重建 review artifact，W10 固定权威报告。P0 可先关闭请求覆写与字段混用，但没有服务器 review revision/报告时不得宣称 D-31 完成，也不能强制 upload/review 相等。
- **风险/阻塞**：当前 hash 是冻结 revision 的 `kind:sha256` 清单，正常路径有价值，不能笼统写“完全没有 hash”；但 submission 插入后另算 hash 存在初始化空窗，且报告仍是 `z.unknown()`。需原子落定冻结清单身份与检查运行，禁止任意 JSON 自称权威报告。

### W07 — Discord 线程 URL allowlist（P0）

- **目标/触点**：替换 `contracts/src/authoring.ts:15` 的通用 `.url()`，在 create/PATCH/revision 的元数据出口复用历史 `2aa31fb^:cloudflare/src/utils/external-links/policy.mjs:202–241 normalizeProjectDiscordThreadUrl` 的 host、17–20 位 snowflake、`/channels/<guild>/<thread>` 与 guild 白名单/canonicalization；配置来源改用新项目的明确配置，不恢复旧 config 文件。
- **验收证据**：允许的 HTTPS Discord 线程被规范化并公开；任意网站、伪后缀 host、邀请/消息地址、HTTP、带凭据、未允许 guild、非法 ID 被拒，编辑原值保持不变并返回 findings。空值不渲染按钮。
- **依赖**：W15/W16 共享经确认的 guild 配置与元数据 findings；先实现纯规则与输入边界，不编造允许公会 ID。
- **风险/阻塞**：guild 实际配置未知时真实正例验收 blocked，不能用“有非空列表”假装准入。不得顺手改 Checker 的可信媒体/官方链接规则。

### W08 — 一次性下载发放与消费（P0）

- **目标/触点**：`routes/projects.ts:32–77`、`storage/downloads.ts:3–20`、`storage/releases.ts:19–45`、下载 events/触发器。POST 记账后返回短期一次性地址或重定向；消费必须原子且绑定 user/project/release/文件身份与过期时间，仍需 session 和最新访问权。
- **验收证据**：POST 与重复 POST 保持 user/project/day 只增一次；获得的地址确实可取预期 bytes；重放、过期、跨用户、换 kind/release、已隐藏/删除/会话撤销均失败；并发消费只有一次成功；GET 不二次计数、所有能力响应 no-store。
- **依赖**：先冻结“一次发放”的粒度。manifest 可含 worldbook+regex，不能签一个 token 后取第一份就让另一份不可下载；新客户端 W12/W14 按同一契约消费。D-28 明确计数发生在 POST，不另改成流成功才计数。
- **风险/阻塞**：现有直接文件 GET 不计数可作为授权安装文件路径保留，但新增的一次性取件路径必须真的消费 token；若下载 UI 仍绕过 POST，不能算端到端交付。不是单纯返回一个长期 release URL。无外部阻塞。

### W09 — Checker 内容迁移与双 bundle（P1，先于自动发布）

- **目标/触点**：从 `2aa31fb^:cloudflare/src/utils/ejs-checker/` 移入拟建 `packages/content`，关联 `external-links/{policy,collect}.mjs`、Acorn/parse5、vendor tokenizer 与 notices；审读依赖后迁移，不能只复制离线生成物。旧 `index.mjs:10–56`、`report.mjs:58–134`、`audit.mjs:113–186` 是行为 oracle；`build-{upload,review}-checker.mjs` 是构建参考而非新目录约定。
- **必须复现**：L1–L7（作用域、private/decorator、跨条目符号），M1–M5，U2–U5（HTTP/IP/动态 URL、媒体/官方/CharInfo 豁免），API1–API2（未知 API 不拒绝），AH1–AH4；EJS/HTML/regex source-map 与 EJS-PARSE/JS-PARSE/FILE/CHECKER-INTERNAL/CHECKER-LIMIT；2000 条、500 单元、20 万 JS 字符、4 万/10 万 AST 节点与浏览器 120s；gate/audit/certification、上传 SCRIPT-RISK/SCRIPT-REVIEW 投影、fingerprint/baseline。
- **验收证据**：旧新引擎同输入逐项比较 ruleId/severity/位置/可见性、gate/audit/certification；异常差异逐项裁决，不删语料求绿。由同内核可重建 upload/review/离线入口，独立 revision；bundle bytes→revision 可验证、notices 随静态资产交付，精确 `?v=` 命中 immutable，错版本不缓存；旧 review revision 在 pending 存续期间可加载。
- **依赖/风险**：旧源码和合约/AST/预算语料可从 Git 恢复，无“没有实现资料”的阻塞。旧 `ejs-differential-v2.mjs` 还依赖机器外的 staging corpus 与 Windows 卡文件，不能承诺全部数据都在仓库；将可恢复的自包含行为语料先迁入 T2，其余缺真实输入明确记录。旧收据/challenge HMAC、预检二次上传不恢复（D-34）；旧脚本/注释“Worker 从不执行分析”必须按新 DO 架构改掉。
- **gate 迁移门禁**：本次旧 bundle 内存冒烟为 plain→accept/green/pass；L1→reject/not_applicable/fail；M1→accept/yellow/fail；语法错误→accept/yellow/fail。原三维结论必须保留并被测试保护；新路由 gate 的转换先形成经确认的 Checker 契约，不能由业务层自行把 accept=pass 或所有 high=block。未冻结转换前停止 W10 自动发布，继续可做解析/报告/人工精确文件审阅。

### W10 — 提交记录、ContentService、调度与自动发布（P1）

- **目标/触点**：扩展 W01 的真实 ContentService；`src/index.ts:4–8` 增 scheduled 装配，`wrangler.jsonc` 增 DO binding/class migration/cron；`submissions` 与检查运行/lease schema 增量演进。提交记录 client gate/revision/warning_count/acknowledged/checked_at，缺字段按 missing 进入人工，不再因 `gate` 必填直接 400。
- **验收证据**：workerd/D1/R2 真实走 pass/warn→DO→发布、DO block→人工、客户端 block/missing→人工且不调 DO；warn 发布并保留详情 findings；无自动拒绝。重复 scheduled/lease 争抢只领取一次；失效 lease 可恢复；最多三次检查超时转人工。报告记录固定 review revision、hash、耗时、结果；指针/审核审计与状态变更保持原子，不复制 R2。
- **依赖**：W01/W06/W09；与 W18 共用唯一 scheduled owner。D-33 抽查只覆盖首次投稿/超大/含外链三类，不扩大为全量强制人工；缺具体阈值时列规范缺口，不编常数。
- **风险/阻塞**：DO 必须调用指定 artifact 对冻结内容检查，不重新走整 Hono app；DO 30s CPU 与浏览器 120s 区分，不能把资源中断当通过。新状态名可与现 schema 不同，但须完整表达 checking/needs-human/auto-published/人工拒绝，不只新增枚举。

### W11 — 人工审核、历史报告、diff 与重跑（P1）

- **目标/触点**：`storage/admin.ts:159–337`、审核 contracts/文件路由、检查运行/审计读取；补 worldbook/regex 条目 added/modified/deleted/unchanged 与 changedFields、cover 对比、历史拒绝/重提快照、accepted/changed/new/removed findings。
- **验收证据**：真实管理员界面可查看精确 submission 文件、既有 DO 报告、上一轮差异；本地辅助重跑只能加载固定 review revision，不覆盖 DO；显式升级重跑审计可追溯；人工覆盖自动结论需理由。block/missing 分支显示“未验证客户端结果”，不伪造不存在的 DO 报告。
- **依赖**：W04–W06/W09/W10/W17；Q-06 阻塞最终队列读取契约，不阻塞审核详情与报告存取。
- **风险/阻塞**：唯一 `reviews.submission_id` 可继续表达最终人工决定，但不能承载所有检查历史；权限与内容快照不能通过公开 DTO 泄漏。

### W12 — 新 Tavern client 用户旅程（P2/P3）

- **目标/触点**：在现有 `apps/tavern-client/` 数据目录旁建立 D-20 浏览器安全实现与单 IIFE 构建。只读 `../workshop-legacy @4fdf71a` 作行为参考，不恢复根 src/webpack/配置链。迁移 bridge、免责声明、自定义服务地址、上下文握手、目标世界书选择/创建/切换、条目命名兼容、安装/选择性更新/卸载恢复、diff、基线冲突、已安装扫描、修复、更新中心、跨角色转移、正则记录/身份升级。
- **验收证据**：真实 SillyTavern 分别安装世界书+正则、更新保留玩家改动、卸载恢复原条目、损坏后修复、转移；恶意 origin/source/bridge message 不可触达安装能力，token 不发给宿主。官方同名但 fingerprint 改动条目按当前基线 README:11–18 fail closed，不能被误删。
- **依赖**：W13–W16/W19；安装状态权威记录依赖 W21/Q-05。可先做桥接与纯内容逻辑，但不能选旧 registry 作为默认权威悄悄解决 Q-05。
- **风险/阻塞**：真实 ST 当前仅有历史“未运行”记录，本次未探测环境；实际验收需可用实例与许可。无实例不等于可以不实现；不恢复 D-08 配套脚本展示/健康检查、客户端 TTL Map，更新中心只保留规定产品语义与请求期 in-flight 去重。

### W13 — `/client/*` 分发与独立发布（P2）

- **目标/触点**：`app.ts:28–83` 补显式 handler；`wrangler.jsonc:25–29,45–49,65–69` 现已有名为 workshop-client-* 的 R2 bucket binding，但目前只用于项目资产，不等于独立产物分发。核清项目资产/客户端产物 key 与绑定职责；D1 `site_settings` 或明确 channel record 存当前版本，不为“记录表”机械建第二份真相。
- **验收证据**：版本对象 `/client/v/<sha>/index.js` 的 bytes/hash、immutable 与 tag 正确；stable/staging 指针各自返回预期 artifact，浏览器 revalidate、边缘 300s、CORS `*` 且无 credentials；发布顺序上传版本对象→D1 版本记录→覆盖稳定对象→purge，故障/回滚账本证明不会永久指向不存在对象。
- **依赖**：W12 artifact；可先用真实最小客户端功能包验证分发，不用假 JS 占位宣布完成。Workers Cache 实现与 staging 开启依赖 W18/D-24 验证。
- **风险/阻塞**：不能用 jsDelivr `@main/@tag`、R2 自定义域/zone 或 Pages 替代冻结方案；实际 R2/Cache 平台能力、Free purge 限额必须实测，未支持时记录阻塞并维持 no-store，不发明 ctx.cache 成功日志。

### W14 — 精确版本门禁、旧入口过渡与别名（P2）

- **目标/触点**：新 client 与 API contracts、release manifest/install/download 消费者接当前 channel 版本；D-06 精确匹配，旧 API/shim 过渡在分发层清晰处理。核对 features H3 的 staging 别名与环境 origin，不凭历史 config 决定现域名。
- **验收证据**：当前版本可安装/更新/修复；较低、较高但不相等、错 channel 均阻止并指向更新；只浏览不误拦。旧 bundle/旧导入地址收到实际可见的一次迁移提示与新固定地址；若交付兼容路径，旧 bundle 登录后的安装/更新确实可用且 private 仍 404。
- **依赖**：W12/W13/W15。D-33 的一个周期窗口需明确开始/截止与执行记录；本次不自行宣布已到期。
- **风险/阻塞**：不恢复 `client.minimum`，不在新树重做整个 legacy client。兼容 shim 只是有期限的迁移交付，不是永久双协议；默认 clean cutover 仍迁移全部新消费者。

### W15 — OAuth、设备码、session、guild、CORS/CSP（P2）

- **目标/触点**：`routes/auth.ts:40–104`、`storage/identity.ts:48–81`、`storage/sessions.ts:16–40`、`http/session.ts`、identity contracts/env、oauth_flows/sessions migration 与 Web 回调页面。实现 Discord callback/state/TTL/code exchange/guild；browser 同源 opener、embed code+iframe verifier redeem、device secret 同源轮询三条交付；生成可撤销 opaque session 与真正 30 天滑动过期。
- **验收证据**：callback/redeem/device 走通，并发双 redeem 只有一次 session；state/code/device secret 错误/过期/重放/guild 不合格拒绝；撤销/角色变更立即失效；续期实际更新 expires_at 而非只 touch last_seen。Origin 必填且精确允许、OPTIONS 正确、非法 origin 不获 API CORS，CSP 不破坏 iframe/弹窗；宿主永远得不到 session token，设备轮询不能退化为 state-only poll。
- **依赖**：可与 Checker 并行；共享 W07 guild 配置、W12 bridge 与 W20 登录 UI。真正 Discord exchange 需要受控配置/secret，本次未读取 .env，不能把 state 的“缺 secret”升级为已检查当前凭据。
- **风险/阻塞**：现在 `oauth_flows.origin` 存请求 Origin；改为服务端配置/可信 origin 标识，不反射存储原请求。区分 iframe redeem challenge 与 Discord 上游 PKCE；当前 `verifier_hash` 混存 hex 与外部 challenge、服务端 verifier 不返回，必须改成一致且可兑换的契约。D-10 token 哈希存储要求与 `sessions.ts` 当前裸 SHA-256 也需按 main §3 的 HMAC 约束统一；测试种子 session 不证明安全签发已完成。

### W16 — 项目版本标签与 D-30 元数据（前置冻结，P3 交付）

- **目标/触点**：projects/revisions 元数据模型、`contracts/src/{authoring,projects}.ts`、`patchProject/addRevision`、公开投影与迁移工具。区分项目 version label、世界书 schemaVersion、内部 revision number、client version、checker revision；补 built/tested/incompatible、安装注意事项、原版冲突选择、cover/banner 位置缩放、metadata_checker_revision/findings/actor/time。
- **验收证据**：create/PATCH 使用同一元数据检查器，长度/控制字符/标签/版本/URL/封面 MIME、大小、尺寸/频率限制按冻结规则返回 pass/warn/block；block 保持原状态，warn 生效并作者可见。已发布项目改元数据同步生效且内容 revision/hash 不变；release 固有条目数量/schema 元数据仍一致。审计与修改同 batch。
- **依赖**：W07、W17/W19 的消费者先对齐 DTO；规则未给具体长度/频率/尺寸阈值时从旧行为/项目配置形成显式规范，不自创数字。既有版本解析 `domain/src/version.ts` 可复用，但不能用它的存在证明 API 有项目版本字段。
- **风险/阻塞**：当前 PATCH 新建 revision，公开从 published revision 读字段，直接加 zod 不会满足 D-30；不能改动已发布内容字节来实现元数据编辑。封面只读头验尺寸，不解码大图。

### W17 — Admin 写接口与审计读取（P3）

- **目标/触点**：`routes/{admin,site,recommendations,references}.ts`、`storage/{admin,home,references}.ts`、相应 contracts/schema。补 `PUT /api/v1/site`、Banner 上传/展示设置、精选 PUT/DELETE、reference set/version/items 登记、`GET /admin/audit-events`；保留多作者精选数据/说明但不做独立公开区块。
- **验收证据**：受控 reviewer/owner 权限矩阵明确；未授权调用不写数据/对象；每个成功管理写入与 actor 审计一致，失败不造假审计；设置→公开读→Web 真正生效；reference items 的 exact/normalized/name/structure hashes 可被客户端读取并比对。
- **依赖**：W04/W07/W16、W19 基线读取与 W20 UI；Q-06 不阻塞这些写接口。
- **风险/阻塞**：`storage/admin.ts:340–374` 目前列表未滤 deleted；新增生命周期后需同步筛选。avatar 来源按 D-27 仍是 Discord；checklist 的 avatar 上传条目不可据“assets.kind 有 avatar”擅自引入替换 Discord 头像的 UI/产品流程，应先澄清该条验收范围。

### W18 — 调度、发现/周期、Cache 与资源运维（P3）

- **目标/触点**：一个 scheduled owner 整合 W10 自动检查与榜单/7d、30d 快照、过期 session/flow、旧 revision/孤儿资产清理；使用 `ranking_runs/entries/discovery_exposures` 与 daily metrics。请求路径不 List R2，不按项目全量扇出；完整 ranking run 后才切可读结果。
- **验收证据（数据）**：同小时匿名请求集合一致、客户端洗牌；跨小时按曝光历史轮换；发布/隐藏/删除影响发现候选。日榜与 7d/30d 使用已确认旧公式和实际事件，likes_delta 有生产者、迁移历史基数口径明确；周期统计只用于排序/推荐，不展示项目/分类/周期总数。清理先 dry-run，published/最新 draft/审核保留快照永不误删，90 天策略与 D-33 历史要求同时满足。
- **目标/验收（缓存）**：D-24 先形成键、头优先级、tag/purge 矩阵、并发/SWR、身份隔离、Free 额度与降级的研究及 staging 证据；再接 D-28 default 网关鉴权 + Public/Viewer，剥除 Authorization/Cookie，可信 props 含 userId/sessionVersion。每个 GET 显式头；发布/下架/私有化/删项目一次 purge 后不可见，用户间无混读、撤销不读旧 Viewer；测 Cf-Cache-Status、rows、CPU 与目标 ≥80% 命中。静态哈希资产 immutable，HTML/manifest revalidate，安装文件/审核/写请求永不公开缓存。
- **目标/验收（运维）**：每公开读路径 rows-read/write 预算与双峰负载验证 Worker p95 <10ms；合并 cron 批处理，给出 100k 请求/日等 Free 硬限降级。日志采样与错误不采样要实际验证；定期备份校验、恢复到隔离目标并对账，不能只做定时导出。
- **依赖/风险**：W02/W04/W10/W13/W16–W19；可先实现榜单/清理 dry-run，但共享缓存开启必须后置。Workers Cache 平台行为未在本次外部检索/线上验证，所有 D-24 假设均需 staging 证据；证据未全不得开生产 cache，不恢复 `caches.default`/客户端 TTL Map。

### W19 — 作者生命周期、我的列表、基线 items 与内容索引（P3）

- **目标/触点**：作者/me/projects/references 路由与存储/DTO；补 `DELETE /projects/:id` 软删、单条目删除生成新 revision、`GET /me/projects`/`/me/subscriptions`、reference version items/hash、公开条目索引与提交前引用校验。
- **验收证据**：删除不立即破坏已引用/待审资产，公开列表/详情/文件/封面同步不可见，后续清理可对账；删最后条目遵守项目类型策略，不通过“上传空文件”绕过 W01。作者自己的拒绝/私有项目可见、他人不可见；个人订阅列表只返回允许查看项；匿名条目索引有条目身份/摘要，不含完整可安装内容/URL。
- **依赖**：W01/W04/W05/W16/W17；baseline 指纹与原版冲突消费者依赖 W12/W22，不依赖 Q-05 选权威存储即可先交数据面。
- **风险/阻塞**：现 references 仅返回 version/count（`storage/references.ts:15–50`）；当前官方 baseline 数据路径已变，生成器/导入入口要同步，不只在测试里塞 reference_items。

### W20 — Web 公开、作者与审核管理 UI（P3）

- **目标/触点**：`web/src/{App.tsx,api.ts,styles.css}` 按现有风格拆成可维护流程，不重建设计系统。公开列表默认 24、顺序翻页/X–Y、类型/标签/作者筛选、发现栏；登录态 header 菜单复用我的列表；作者创建/编辑/上传/提交/拒绝原因；审核队列/精确文件/报告/diff/批准拒绝；管理设置/成员/精选/基线/审计。
- **验收证据**：实际浏览器完成以上操作，错误/冲突/加载/空态与 Toast/确认弹窗可见；卡片 16:9、4/3/2/1 与手机可操作，作者头像失败回退首字、项目 author_note/发布时间/更新时间/schema、Discord 按钮、Banner 桌面/手机位置缩放都消费真实 DTO。详情分组警告；已安装/待更新仅来自 client 本地信息，普通浏览器不假装有状态。
- **依赖**：W03/W05/W11/W15–W19；可用已完成真实 API 先做不受阻的公开页，不以 mock 后台宣布作者/管理闭环。Q-06 未定只阻塞最终队列分页形态。
- **风险/阻塞**：当前 `Detail` 只接 `ProjectSummary`、打开不请求详情 API；不把“已有详情侧栏”误认为已消费 authorNote/Discord/findings。本地打包字体/图标或明确系统字体，不重新引入外部 CDN 依赖。

### W21 — 安装状态权威记录（BLOCKED Q-05）

- **目标/触点**：梳理安装/扫描/选择性更新/修复/转移对持久状态的共同契约，列出 D1 行、条目内单一记录、registry 缓存的故障与离线行为供技术裁决，不选答案。
- **验收证据**：正式 Q-05 决策后，同一安装在重载/换角色/本地修改/服务端不可用/损坏登记时只有一个可解释状态，更新/卸载不误删原条目；T3 与真实 ST 保护该状态转换。
- **依赖/风险**：W12/W22；当前不得据旧 registry 或现有 baseline 文件替产品作决定。此阻塞不影响纯 bridge、内容规范化、服务端分发/认证的推进。

### W22 — T2/T3/T6 与真实旅程（每片随行，P4 汇总）

- **目标/触点**：T2 从 Git 恢复规则/AST/source-map/预算/外链/报告语料；T3 恢复 fingerprint/diff/安装安全行为；T6 从 `0ce8f84^:tests/fixtures/legacy/` 与历史 capture 读取样本，转成新 `/api/v1` 产品语义契约，不照抄旧响应的鉴权漏洞。继续现有 Worker/workerd suites，不复制旧 49 个源码断言。
- **验收证据**：T2 差分有稳定规则/位置/投影/边界；T3 覆盖规范化不误认官方条目、真实内容改变使风险重审、选择性更新/恢复/修复危险状态；T6 覆盖公开 ID/筛选/短中文搜索/条目计数/基线数据与匿名权限差异。现有空内容、任意 checkerVersion 的不合规正向用例替换成消费者可观察的负例。
- **真实旅程**：5–8 条 Playwright 跑本地 Worker（建议 7 条：匿名搜索排序分页；三种登录交付的代表安全链；作者上传/提交；人工拒绝→改稿重提；审核/自动 pass-warn 分支；管理设置与角色撤销；下载/权限/隐藏失效）。每条可表驱动关键分支，不能只 GET 根 HTML；真实 ST 的安装/更新/修复另记，不用 Playwright 假扮 Tavern Helper。
- **依赖/风险**：每个实现项自带最小行为回归与真实入口 smoke，最终统一 `pnpm check`、`pnpm e2e:local`；UI 还需真实浏览器视觉/交互证据。A5 如保留测试构建预览管理员，证明生产包/路由没有认证旁路。无凭据的外部场景明确未验证，不能用测试种子登录顶替真实 OAuth。

### W23 — CI artifact、迁移适配器与 cutover 演练（P4）

- **目标/触点（发布）**：`.github/workflows/{refactor-ci,deploy-staging,deploy-production}.yml` 由独立重建改为精确 SHA 构建一次、不可变 artifact/hash 逐级提升；固定 lockfile/工具版本，移除部署时 `--no-frozen-lockfile` 与浮动 `npx wrangler@4`。部署前 migration、后验 Worker version/health SHA、发布账本和 environment 审批必须完整。
- **验收证据（发布）**：staging 与 production 提升同一 artifact hash，日志可定位 commit SHA、migration 列表、Worker version；回滚指向既有 artifact 而非重建。tag 不等于部署，push 不等于部署；本轮禁止执行这些远程动作。
- **目标/触点（数据）**：`tools/migrate/{lib,cli,load-local}.mjs` 与 `from_d1_sql.py` 补 D1 目标导入/R2 copy、断点/幂等/失败恢复，逐对象 source→target key、bytes、SHA；本地可先实现，远端必须明确目标与授权。修 §2.4 的跨项目指针/零内容/权限冲突/归属回退/源表遗漏门禁；补 site/banner、参考集、私有评分、精选、审计、曝光历史、可解释日指标的映射/显式不迁清单，抽签等待 Q-10。
- **验收证据（数据）**：全量两次字节一致仅是第一步；源表独立清点→映射/丢弃及冲突清单→目标实际 D1 导出/R2 回读→独立 reconcile，不能 expected 自比。delta 与完整基线合并后不丢资产/关系，失败中断重跑不重复计数；approved 每项实际内容策略通过，公开 ID、指针归属、全部 FK/hash/互动/评分/历史审计对齐。
- **目标/验收（切换）**：授权后在 staging 真实数据演练登录/安装/审核/分发/缓存，实证停写屏障覆盖旧 cron、OAuth、文件 GET 计数和所有写路径；最终 delta 起点对齐 barrier。生产须人工审批并记录 SHA/artifact/Worker version/监控窗口，旧 D1/R2 只读 7–90 天，开放写前可回旧，写后仅回滚代码。
- **依赖/风险**：W01–W22 的核心安全/旅程出口；Q-10 未决影响数据迁移范围。现旧库权限冲突“取最高”与随机归属回退不能默认为上线策略；历史 staging 空数据 health/list 0 个 5xx 不覆盖真实 cutover。旧 worktree 只读，停写屏障实施需另有允许范围，本文不修改它。

### W24 — 审核队列与抽签待定项（BLOCKED Q-06/Q-10）

- **目标/触点**：Q-06 在 `contracts/src/admin.ts`、`storage/admin.ts:124–156` 的 offset 基础上，等技术确定稳定 cursor 或短期 snapshot；Q-10 等产品决定每日抽签接口/配额/迁移保留还是正式删除，UI 入口继续收起。
- **验收证据**：Q-06 决策后并发新提交/审核期间翻页无遗漏/重复、筛选排序稳定；Q-10 若保留则登录/配额原子扣减/重复请求/迁移状态可验证，若删除须正式更新范围与消费者，不能把“暂未迁移”写成 done。
- **依赖/风险**：W11/W20/W23；未决时相关项保持 blocked，不冻结客户端/后台对 offset 的永久依赖，也不阻止不相关 work slice。


## 5. 推荐执行顺序、并行切片与停止条件

### 5.1 推荐切片波次

1. **冻结规范与止血**：集成人先写路由/权限/数据/错误矩阵和 W01/W04/W05/W06/W08 的契约测试；W03 可独立实现。先跑一次现有 `pnpm check`/本地 smoke 作为环境基线，再逐片执行。任何不通过只阻塞依赖它的切片，不得删测试或降低验收。
2. **P0 并行**：W02（短 FTS）、W03（Web 默认排序）、W04（cover 授权）、W05（拒绝理由）、W07（Discord parser）可按文件 owner 并行；W01 与 W06/W08 涉及共享 submissions/assets/contracts，指定一个 integration owner 串行合入。W04 合入后再允许考虑静态/Workers Cache。
3. **Checker vertical slice**：W09 先迁公共内核+自包含语料+revision，再由 W10 接 DO/cron/状态机，W11 接审核读取/diff/审计。W09 未通过旧规则差分，W10 禁止自动发布；W06 的止血可以先阻止不可信覆盖。
4. **身份/分发并行**：W13/W14 与 W15 可并行，各自拥有 wrangler/schema/auth owner；W12 只在 bridge/HTTP 契约稳定后实现。W13 的 client R2 binding 不得与项目资产路径混用。
5. **产品与运维**：W16 先冻结 DTO/metadata 语义；W17/W19/W20 按契约并行。W18 由一个 scheduled/cache owner 统一接线，避免多个 cron 竞争领取/重复发布。Cache 研究和 no-store staging 验证先于开启。
6. **证据收口**：W22 随切片补 T2/T3/T6 与 API/集成回归；W23 的本地 artifact/迁移适配器可提前，但真实 staging import/cutover 只能在所有 block 清零、目标和人工授权存在后执行。W21/W24 保持 blocked，不拖住无关实现。

### 5.2 每个切片的停止条件

- **正确性停止**：发现 private/working/review 内容泄漏、未经校验内容可发布、下载 token 可重放/跨用户、审核 hash/revision 不一致、角色撤销仍可用；立即停止后续缓存/发布，不用特殊路由掩盖。
- **Checker 停止**：任一旧语料 gate/report/fingerprint 未解释；规则结果被业务层二次判定；DO 超时静默发布；管理员可替换固定 revision；客户端 gate 被当授权。返回 `BLOCKED`，写明缺失 oracle/样本，不用空报告。
- **身份停止**：Origin 未白名单、token 跨 origin、state-only poll、redeem 可重放、guild 未验证、session 未查库/滑动过期未生效；不进入真实用户邀请。
- **迁移停止**：源/目标 hash、公开 ID、指针归属、FK、互动/审计任一不一致；R2 只登记 key 未回读字节；权限冲突被自动猜测；cutover barrier 未覆盖 OAuth/文件 GET 计数；不执行真实切换。
- **资源/缓存停止**：无显式缓存头/tag、下架后仍可 HIT、Viewer props 不含全部身份维度、rows/CPU/Free 额度超过阈值；生产维持 `private, no-store`。
- **证据停止**：只有静态表/路由、单元测试或历史 state 记录，没有真实 HTTP/workerd/浏览器/迁移回读证据；不勾 checklist。生产切换永远需要人工审批与 Worker version 记录。

### 5.3 本次审计已执行与未执行

已执行的只读/内存证据：

- 读取当前 HEAD、状态、五份计划与三份审计；确认工作树只有本文新增未跟踪文件。
- `git ls-tree`/`git show` 读取 `2aa31fb^` Checker 源码、构建入口和历史语料；直接在内存运行历史 bundle：普通内容为 `accept/green/pass`，L1 为 `reject/not_applicable/fail`，M1 与 EJS 语法错误为 `accept/yellow/fail`。这证明旧三维输出存在，不证明新 Worker 已实现。
- 通过 Node 内存调用当前 domain validator，观察非法 JSON、空 worldbook、worldbook/regex 错配会返回 invalid；当前 Worker 尚未调用。
- 用当前 migration schema + 内存 SQLite 重现 `verify()` 可接受跨项目 published pointer/零资产输入；这是迁移门禁缺口复现。
- 用当前 cover SQL + 内存 SQLite 重现 public project 的 unpublished draft cover 查询返回 found=1；这是 revision 级授权缺口复现，未启动 HTTP/R2。

本次未执行：`pnpm check`、`pnpm test`、`pnpm e2e:local`、Web build、Wrangler、真实浏览器、真实 SillyTavern、Discord、Cloudflare/R2/D1、生产或 staging 网络检查。原因是本任务是只写审计且不应修改运行时状态；历史 `state.md`/archive 记录只作历史证据，不能写成此次通过。

### 5.4 完成定义

某项只有在以下四层都存在时才可从 checklist `[ ]` 改为 `[x]`：冻结 contracts/schema/权限与失败语义；端到端代码链路；针对危险不变量的行为测试；实际入口 smoke/集成证据。删除项按决策保留为“不可回归”，Q-05/Q-06/Q-10 在正式追加决策前不计完成。所有空项关闭、`pnpm check`/E2E/staging 全绿且人工审批记录齐全前，不能写生产 cutover done。

## 6. 不要做

- **不要发明 Checker 规则、gate 映射、预算或 findings 语义。** 规则内容必须以 `git show 2aa31fb^:cloudflare/src/utils/ejs-checker/...`、外链 policy 与可恢复语料复现；不把旧 `accept/reject` 三维结果未经裁决改成新业务状态。
- **不要把有表、有路由、有单测或历史 state 当作端到端完成。** 尤其不要把 session seed 当 OAuth 登录、`run_worker_first` 当 `/client`、R2 key 当复制、D1 表当 cron/cache 消费者、封面 URL 当封面可读。
- **不要声称生产 cutover、真实 OAuth、真实 SillyTavern、staging 真实数据导入或当前 HEAD 已部署。** 缺 secret/实例/授权时只标 `BLOCKED`；本地/历史演练不替代生产审批。
- **不要在当前树重做 legacy 客户端。** 只读 `../workshop-legacy` 获取行为 oracle；新实现放 `apps/tavern-client`，按 D-20 做单 IIFE 与新 contracts，最终迁移全部消费者并删除过渡路径。
- **不要恢复已删除的 attestation/二次上传、配套脚本健康检查、站外通知、旧 toggle、旧暗门、客户端 TTL cache 或 `caches.default`。** 它们分别被 D-34、D-08、D-07、D-33、D-24/D-28 约束。
- **不要用兼容 shim 永久掩盖新契约，也不要让旧路径绕开 D-02/D-03/D-29 的权限检查。** 过渡必须有开始/截止窗口、真实旧 bundle 验证和迁移提示。
- **不要靠增大列表 LIMIT、LIKE 全表扫描、前端硬编码排序、手工 SQL 管理写入、空报告/假 audit、mock 登录或只断言源码文本来“完成”。**
- **不要自行回答 Q-05、Q-06、Q-10。** 在决策追加前保持相关项 blocked；不为方便测试偷偷选择安装状态、队列读取或每日抽签语义。
- **不要修改 `workshop-legacy`、生产资源、凭据、`data_backup/`，也不要在本文之外写文件。** 本报告唯一允许的变更是 `docs/audits/next-work-plan.md`。


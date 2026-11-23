# 分类体系与显式审阅的离线切换（六分类初版，主类已由五分类部分替代）

- Status: implemented
- 确认日期：2026-11-13
- 决策负责人：项目所有者；契约维护者：Domain/Contracts 与 Worker；界面维护者：Web；迁移维护者：离线工具；交付与安全边界：Integration。
- 本记录保存已接受设计及其取舍，不是部署许可、操作运行簿或验收日志。当前行为分别由 [API 参考](../../../docs/reference/worker-api.md)、[使用指南](../../../docs/guides/using-workshop.md)、[迁移说明](../../../docs/operations/legacy-data-migration.md)和[部署安全规则](../../../docs/operations/deployment-safety.md)维护。
- 局部取代（2026-11-18 / PR #107）：主分类枚举已由 [社区低调入口、政策问答准入、合集体系与界面体验精修](community-access-collections-and-ux-refinement.md) 收敛为**五分类**（`系统核心`、`角色`、`内容扩展`、`规则扩展`、`体验优化`；原`事件`并入`内容扩展`，原`玩法`更名为`规则扩展`，12 组预设标签完整保留），目录筛选在 `includeContained=true` 时对所有已选分类在 `projectType ∪ includedTypes` 上执行 **AND** 匹配（`false` 时仅在主类上执行 OR）；下文保留 2026-11-13 初次落地时的六分类历史表述，其余结构化包含关系、普通标签上限、预设分组语义与离线审阅/对账机制保持有效。
- 生命周期核对（2026-11-23）：结构化分类、空库 schema、API/Web 和完整离线候选工具由 [PR #90](https://github.com/The-poem-of-destiny/workshop/pull/90) 合并，四普通标签上限由 [PR #89](https://github.com/The-poem-of-destiny/workshop/pull/89) 合并，98 对象基线与 `preload`/`delta` 工具、五分类收敛、`[工坊]` 世界书标记及 FTS `char(0)` 净化分别由 [PR #104](https://github.com/The-poem-of-destiny/workshop/pull/104)、[PR #107](https://github.com/The-poem-of-destiny/workshop/pull/107)、[PR #108](https://github.com/The-poem-of-destiny/workshop/pull/108)、[PR #109](https://github.com/The-poem-of-destiny/workshop/pull/109)（`d7deb9d`）合并。远端 `staging`（`workshop-staging-migrate-977ebb415bf6`）与 `production`（`workshop-prod`）D1 均已完成五分类 + 98/98 对象预装载，`deploy-staging` 已在 `d7deb9d` 跑通；剩余生产最终停写 `delta`（如适用）与 `v*` tag 正式切换在 [state.md](../../../docs/plans/refactor-2026-10/state.md) 与 [user-actions.md](../../../docs/plans/refactor-2026-10/user-actions.md) 跟踪。

## 背景与取代范围

旧主类、扩展子类、普通标签和历史多分类表示混合了“作品主要是什么”“还包含什么”和“用哪些词检索”。继续在运行时兼容旧值会让创建、修改、发布、筛选与离线转换各自解释同一份资料，也会掩盖未经审阅的旧数据损失。

本决策只局部取代既有记录中与本次分类和迁移基线冲突的部分：

- [视觉方向](new-ui-visual-direction.md)的旧分类枚举与类型/普通标签计数，改用六类独立主分类徽标与最多四个普通标签；该记录其余视觉、单行裁切、交互及响应式选择不变。
- [旧重构 D-12、D-39 等记录](../../../docs/plans/refactor-2026-10/decisions.md)中的历史 `0021`、`0001` 只是起点及“执行完整旧增量链”的操作前提，不再是当前 schema 或数据切换依据。保留其历史正文及当时执行事实，不把历史审计通过当作本轮验收。
- 不取代现有权限、安装、内容解析、安全检查、动态推荐和 [Cache API 设计](../../../docs/reference/cache-design.md)。也不恢复经典界面迁移或更改其他产品决策。

## 决策

### 分类、包含关系和普通标签各有一个事实来源

主分类恰好一个，初版顺序为 `系统核心`、`角色`、`内容扩展`、`玩法`、`事件`、`体验优化`（后经 [五分类收敛决策](community-access-collections-and-ux-refinement.md) 合并为 `系统核心`、`角色`、`内容扩展`、`规则扩展`、`体验优化`，其中`事件`并入`内容扩展`、`玩法`更名为`规则扩展`）。系统核心指玩家的命定核心伙伴，不表示替换整套游戏。`projectType` 必填；`includedTypes` 是独立结构数组，不是第二主类或普通标签。创建缺省为空，完整响应总是包含数组，PATCH 省略时保留原值并验证合并后的资料；排除自身、系统核心和重复项，不另设两三个的任意上限。

预设和自定义词同样存储为普通 `tags`，作者最多 20 个、目录最多选择 12 个、卡片/列表最多展示 4 个。独立主分类徽标不占四个名额，详情、tooltip 与筛选保留完整标签；不为四个标签改造既有窄屏单行裁切。取消运行时旧 `extensionType`/`extension_type`、规则/内容子类和多主类兼容路径；历史值只能通过显式离线审阅转换。

预设只是可选快捷词；主分类只改变各组的优先级，不隐藏其他组。`合集` 属于组成形式，与作品大小或角色数量无关。不设规模组，不提供 cbz/hnh/1011 或轻中大型快捷词；已有同名普通标签仍然有效。词表在 [Domain taxonomy](../../../packages/domain/src/taxonomy.ts)维护，不在本记录复制第二份。

作者按作品的主要作用选择主类：引入新机制归入`玩法`；调整既有机制，或补充既有定论的注解，归入`体验优化`。本轮不新增内容规模机制，也不为合集建立逐角色索引。

建议搭配是软关系，不阻断安装，也不驱动客户端沿建议关系自动解析或下载目标；这不表示输入可以超限。`recommended` 最多 50 项，可选 `note` 经 trim 后最多 300 字符，字段与校验以[既有合同](../../../packages/contracts/src/requirements.ts)为准。

### 筛选按词义分组，而不是按输入方式分组

默认 `includeContained=false` 时只匹配主类（重复 `projectType` 参数之间为 **OR**）；明确 `includeContained=true` 时在 `projectType ∪ includedTypes` 的并集中对所有已选分类执行 **AND** 匹配（PR #107 演进确认，详见 [API 参考](../../../docs/reference/worker-api.md#目录筛选与游标)）。重复标签先规范化、去重，再应用总数 12 的上限：预设同组 OR、跨组 AND，每个自定义词独立 AND；手输预设词仍归入其预设组。规范化后的同一查询语义共同决定 SQL、游标和缓存身份，不能为参数顺序或重复值生成不同作用域。

标签既有公开合同保持 1–100 Unicode code points，API 输入沿用 JavaScript `trim()`；持久值和审阅目标必须已经 canonical，不在迁移或数据库边界偷偷修剪。Python、Domain、Contracts 和 SQL 对相同字符采用同一边界，不增加 NUL 或其他字符的额外产品禁令。长度检查不能被 SQLite 的 NUL 截断语义绕过，也不能为验证而改变保存的 JSON 或重复身份；同时 FTS 派生索引触发器与离线重建在写入 `project_search`／`project_search_short` 时统一将 `char(0)` 净化为空格（PR #109，见 [上线前加固记录](pre-launch-hardening-oauth-bridge-and-cdn.md)），防止内嵌 NUL 截断搜索分词或破坏线上／离线对账一致性。

### 内容准入不与分类绑定

任意合法主类和包含组合均可提交有效 World Book-only、Regex-only 或混合内容，但必须至少有一种有效非空内容。取消分类特有的内容组合限制，不取消解析、权限、安全检查、客户端检查记录或人工审核流程。安装依赖继续使用 `requirements`；卡片 DLC 条目名仍由作者提供，上传保存时自动添加 `[工坊]` 标记（兼容读取历史 `[WS]`），卡片端 `DLCManagement` 同步识别 `[工坊]` 与 `[WS]`。

推荐器继续动态按实际主分类分组，保留既有池预算与公式，不新增六类固定配额。分类表达变更不是推荐算法扩展或重新分配资源的理由。

### 迁移是可审阅的完整候选，不是运行时回退

使用一次性离线工具和可编辑决策文件；每项最终转换必须绑定不可变源快照及其哈希。current、legacy 和 preview 生成的所有决策均以 `reviewed=false`、`tagsAcknowledged=false` 开始，明确映射建议也不能代替操作者确认。旧角色、系统、系统核心和事件可形成明确建议；扩展与未知值必须人工决定，不能按标题猜最终类。历史无效、空、重复或超上限标签必须提供合法 `targetTags` 和明确 `tagChangeReason`，不能只勾选确认、静默去重或截断；不同历史字段之间的合法重叠不冒充原数组重复。

当前库必须从完整当前快照重建，保留新增项目、全部非 taxonomy 字段/行及其类型和重复数、账号历史、工作/发布指针和对象引用。只有已明确批准移除的旧字段适用移除合同，不借分类转换丢失 description 或 requirements。候选构建后由独立步骤对账 canonical schema（初版 21 个业务表与 3 个派生搜索表；随合集与公开图片副本合入后现行基线共 98 个 schema 对象）、FK/完整性及搜索投影；未审阅、过期哈希、未知 schema/字段和损坏候选一律拒绝。

候选使用 v2 格式固定源、schema、工具与 legacy provenance；相关输入或 helper 改变后，使用原审阅输入生成新的输出并另行核验，不修改旧候选的 pins 来伪装有效。旧候选即使数据库字节相同，也不能沿用过期工具或缺失 provenance 的核验结论。挑选已发布项目到可丢弃本地预览库的 importer 不等于完整当前库迁移。离线对象引用对账不获取或复制远程 R2 字节，也不证明实际对象字节完整。

已导入当前库的历史不完整发布不应被无条件拒绝，也不能获得普遍豁免。current 的 build 和 verify 均可重复提供完整 `--legacy-provenance PREPARATION SOURCE_SQL MANIFEST` 三元组，支持多个独立导入；每组三项缺一不可。只有经独立源对账、审阅及固定本地备份核验，且原发布版本不可变字段、资产与发布关联在当前快照中保持原样的具体历史例外才可接受。当前工作指针、计数、rowVersion、历史及新增行仍按当前快照保留，已审阅 taxonomy/tag 改动不冒充内容变动；缺失、伪造、冲突或过期 provenance 仍 fail closed。这保留已有受核验导入的含义，不放宽一般发布就绪检查。

例外资格不能把 preparation 自述或候选哈希当作源事实。独立对账从固定的原始 SQL、manifest 与经核验的本地备份重建完整 canonical 版本和资产元数据，再按实际 schema 的存储类型、NULL 与缺省值语义比较 preparation 及当前发布关联；MIME、序号、对象别名和其余非 taxonomy 字段均不能只检查一个方便的子集。canonical schema 新增而独立映射尚未覆盖的版本或资产列必须拒绝，不能凭刷新 pins 获得资格。这样既拒绝当前库与 preparation 一起篡改元数据，也允许确实等价的类型/缺省表示及原有精确历史例外；当前可变字段仍独立按当前快照保存。

### 基线、上线和授权保持分离

当前 `apps/worker/migrations/0001_initial.sql` 是上线前 98 对象空库基线，绝不能对既有数据库执行。上线时冻结基线，此后按递增 migration 追加，而非反复改写已上线基线。真实切换需另行授权和受核验的当前候选、停写与对账流程；本分类 PR 的合并本身不是部署或迁移。

早期基于固定 `ACCEPTED_SCHEMA_SHA` 的暂停门禁已升级为 `.github/scripts/verify-release-schema.py`：在 `staging` 与 `production` 发布前动态将远端目标 D1 的全部表、索引、视图和触发器（98 个对象）与当前代码迁移链执行只读精确比对，不一致则直接阻断发布且绝不自动运行破坏性迁移。截至 2026-11-23，`staging`（`workshop-staging-migrate-977ebb415bf6`）与 `production`（`workshop-prod`）D1 均已预装载至五分类 + 98/98 canonical schema 对象。

## 考虑过的替代方案

- **将包含类编码成普通标签，或保留多个主类**：拒绝。主类优先级、筛选开关与作者意图无法可靠区分，规范化和缓存作用域也会依赖模糊推断。
- **继续运行时映射扩展/子类**：拒绝。会让新写入和历史数据的含义不同，掩盖必须由作者或迁移审阅者决定的歧义。
- **按分类限制内容组合、只展示当前类预设或新增规模/六类配额**：拒绝。分类是组织信息，不是内容有效性的代理；这些限制和算法改变没有本轮产品依据。
- **从旧样本覆盖当前库，或自动整理不合法旧标签**：拒绝。会丢失新数据和历史，并把无法追溯的清理伪装为无损迁移。
- **把明确映射当作自动审阅，或普遍拒绝/放行历史不完整发布**：拒绝。建议不能替代明确确认；例外必须与独立核验的不可变源和具体发布关联绑定，既不丢弃合法历史，也不为无关或后来改变的内容跳过就绪检查。
- **只固定 preparation 哈希，或仅对账对象键、哈希与字节数**：拒绝。哈希只能固定某份输入，不能证明其中元数据来自原始源；当前库和 preparation 可一起改变未覆盖字段。完整源重建、typed 对账与 schema 覆盖门禁同时约束 build 和独立 verify，才不会把被改过的 MIME、版本字段或新列伪装成已核验历史例外。
- **沿用历史 `0021` 运行说明或直接对既有库套新 `0001`**：拒绝。旧链与当前 canonical schema 不同，当前候选和上线门禁才是切换前提。

## 后果与风险

一套显式契约增加了离线人工审阅和独立对账的步骤，但避免运行时兼容分支、双写镜像和无依据的默认分类。全部耦合的 schema/API/Web/迁移消费者必须原子交付，不能把不兼容中间态当成独立可部署版本。

目录的普通词、包含关系和组内 OR 可能比旧筛选更宽；用户仍可用跨组及自定义 AND 收窄。预设不代表内容安全评级。查询身份保持 canonical 可复用现有 Cache API，不新增缓存机制；缓存既有 TTL 陈旧性与授权边界仍以缓存参考为准，不把本地 harness 当成真实边缘命中证明。

完整候选的成功不代表真实数据切换或对象字节验收。既有窄屏单行裁切、动态推荐的原预算与本地预览 TTL=0 均有意保持，不扩大本轮改造。

## 验证要求与交付状态

本地服务端真实创建、上传、提交、人工批准及匿名回读已覆盖六类与三种有效内容组合；元数据/内容拒绝边界、分组查询、canonical 游标/本地 Cache API、Unicode HTTP 与 SQL/Python 合同已取得行为证据。当前 helper 固定的 v2 SQLite/SQL 完整候选已取得独立 typed 对账证据；三种审阅输入的初始标记、明确标签修复理由、公开重复键与私有无效内容省略的精确源例外、多导入及缺失/伪造/过期 provenance 拒绝边界亦已验证。完整非 taxonomy 版本/资产字段的当前单独篡改与当前加 preparation 协同篡改，均在刷新输入与工具 pins 后由 build 和独立 verify 拒绝；实际 canonical schema 新列缺失映射同样拒绝。显式/回退 MIME、对象别名、根版本优先序号、可空缺省及存储类型等合法变体仍可通过，当前计数、rowVersion、历史和新增行保持不变。桌面/移动作者、筛选、真实客户端 checker、审核者与 owner 表面，以及未弱化门禁的完整本地检查和 E2E 亦已取得行为证据；这些证明不能相互替代，也不代表线上边缘缓存或真实数据切换。精确命令、结果、私有探针错误及其处置保存在任务记录，不在本决策存放 fixture、运行日志或凭据。

PR #90 及后续五分类收敛 PR #107、基线与增量切换加固 PR #104／#109（`d7deb9d`）的源码、离线工具、`staging` 自动发版验收及 `staging`／`production` D1 五分类 98/98 对象预装载均已完成。剩余旧站停写后的最终 `delta` 补齐（如有新写入）与 `v*` tag 生产 Worker 切流归属上线运维门禁（见 [user-actions.md](../../../docs/plans/refactor-2026-10/user-actions.md)），本记录不构成自动生产切流授权。

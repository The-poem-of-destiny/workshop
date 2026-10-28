# 当前状态（2026-10-22）

本文件只记录当前工作状态，不作为设计完成或线上部署证明。设计见 [api-design.md](api-design.md)，发现与验证见 [api-audit.md](api-audit.md)，前端映射见 [frontend-fidelity.md](frontend-fidelity.md)。

2026-10-29 缓存切换以 [D-48](decisions.md#d-48-公开入口缓存与有界陈旧) 和 [api-design.md](api-design.md#6-缓存设计公开投影与实时权限分离) 为准；以下旧阶段记录不代表当前部署或授权状态。default entrypoint 的公开投影在 staging 配置 300 秒缓存、尽力 purge，production 关闭；真实 hosted HIT／失效尚待验证。迁移 0025 保留 epoch 行以兼容旧 Worker，删除写触发器。

## Git 与部署边界

- 当前分支 `work`；本次纠错前基线为 `8a3643a8f9fb46a1fadbb8e0c6ba67b6f1f0541f`。用户已授权本地 commit，源码分批提交见末节；未 push、未创建或重开 PR。
- PR #22 已由用户关闭；本地提交授权不包括远端历史、PR、tag、staging 或 production 部署。
- 原重构阶段未部署或操作远程 D1/R2；随后单独授权了 staging 样例数据导入（见下），不包括新代码部署。当前任务已授权按职责创建本地 commit，仍未授权 push、PR 或部署。
- 本次提交仅在本地，`origin/main` 不包含这些变更；不以 commit 或 push 代表 Cloudflare 已部署。
- legacy 参考固定为只读 `../workshop-legacy`，commit `15303df5e3b30aa7f3fc924296ae57497a7ad09a`。

## 本轮已落地的工作

- Workers Cache 官方研究保存在被忽略的 `ref/cloudflare-workers-cache/`；入口、性质、使用约束写入 `AGENTS.local.md`，`/ref/` 已忽略。
- 区分新的 Workers Cache 和旧 Cache API。已移除 `caches.default` helper，加入显式 uncached gateway、命名 `Public`、可信 epoch props、30 秒内部策略与外部 `private, no-store`。production 缓存保持关闭；没有 hosted HIT／tiering／purge 证明。
- authoring upload/submit 使用 If-Match 和 rowVersion；提交前授权、DO 内容校验／索引，最终 D1 batch 冻结快照、创建任务和捕获发布基线。
- 冻结快照禁止 PATCH；当前公开展示通过独立 published-metadata／published-cover 读写，与 pending revision 分离。
- manual/automatic publication 使用持久化发布基线与项目删除状态；ticket 消费和 public 日计量同 batch；旧裸 release manifest/files 路由已移除。
- 排行使用统一 scheduled reference time、有界日期窗口、准备完毕后的原子可见性切换。
- React + Vite + Tailwind v4 + Radix/CVA shadcn-compatible primitives 已实际使用。前端按指定 legacy 的卡片顺序、204px sidebar、1480px detail、media/reading/summary rail 重建；不恢复发现页。

## 历史独立 review 与停止条件

- 原 API 设计第 1–2 轮、实现第 3–4 轮完成后因三个 P2 暂停；用户明确“继续”后已重新开放并修复：
  1. migration `0020` 增加独立 `entry_index_ready`，提交与完整索引同批写入；历史默认未完成，不再以 manifest 推断。
  2. 消费时用 D1 当前事务时钟检查 ticket/session 到期，日计量取持久化 consumed_at；后续复核又要求锁定当前精确 session token hash，已实现。
  3. 历史索引通过 DO `indexRevision` 只读生成，不运行当前提交准入／baseline rules；原 500 回归通过。
- 前端：第 1 轮修复 7 项布局／可访问性问题；第 2 轮修复 dirty published metadata 丢失与冻结控件静默 no-op；第 3/4 轮只读复核确认这两项修复正确。浏览器证据另记 frontend-fidelity。
- 续作首轮独立复核确认 index-ready／历史读取／时间一致性，发现同用户多 session 的替代授权边界；已补强原过期回归，保留第二条有效 session，仅使当前 session 过期仍不得消费或计数。
- 续作最终独立 `SessionBoundaryReviewRetry` 无 findings：精确当前 session 的消费校验不能由另一 session 代替，内部 hash 不进入公共 Session／me／auth；DB consumed_at 与 daily event 同批一致，详情状态未知时不写关系。前一次同范围 review 因上游 HTTP403 失败，未计通过。

## 验证证据（本次 schema 收敛后已重跑）

- 当前 `pnpm check` 全链通过：workspace、Biome（无 errors，47 warnings／1 info）、各 package typecheck/tests、schema、migration/export/backup checks、Web build、Wrangler staging dry-run。
- Worker suite **13/13 files、85/85 tests 通过**；当前索引回归验证 manifest 不代表完成、ready=0 返回 404、持久索引不读取原文件及合法空索引；R2 后 ticket／精确当前 session 到期回归仍通过。
- 当前 worker/frontend typecheck 与 Web build 通过；bundle 仍有 >500 kB 提示，不以调高阈值隐藏。
- `pnpm check:schema` 与 migration transformer 检查通过；Web bundle 已构建。
- 本次 `pnpm e2e:local` **21/21 通过**（subagent `SchemaCutoverE2E`）；含新发布冻结条目索引、普通票据取件、排序、subscription、作者 workspace、owner、审核批准／拒绝及 successor 再提交。后续三个导入工具修复不修改该 Worker/Web 运行路径，另有真实备份样例烟雾覆盖。
- 视觉 subagent 内部检查了 7 张本轮截图：desktop/mobile browse/detail、作者、owner tools、review；desktop 无可见水平溢出，detail 左 media/reading、右 operations；mobile 为 media→reading→operations。1280px 截图不能证明 1480px cap；mobile detail 截图不能排除所有溢出，未声称逐像素一致。
- 未验证真实 Workers Cache hosted HIT、tiering、global purge 或费用；没有本地 Cache API fallback／伪造 x-cache。production 缓存仍关闭。

## 有意保留与未验证事项

- 本轮工作树及既有未提交改动全部保留；研究目录和 AGENTS.local.md 是本机材料，不提交。
- 重构交付时未验证生产、staging 部署、远程数据导入、真实 Discord OAuth、真实 SillyTavern 游玩或全球缓存行为。随后用户单独授权了备份样例导入 staging，结果见下；该授权不包含 Worker／Web 代码部署或 production 操作。
- 原暂停及续作授权、独立复核、修复证据保留在 api-audit；未把旧结果覆盖为新成功，也未删掉失败用例逃避回归。

## 最终交付状态

此前把核心实现与本地检查通过记为整体完成，未充分审计 schema 和仅为旧数据保留的兼容路径，结论过早。用户要求先纠错、再完成收敛及本地 commit；本次已按下节完成。该结论只覆盖本次 API／前端重构与 schema／导入工具收敛，不将 `features.md` 中仍列为部分／未实现的其他产品功能宣称为完成，也不代表线上发布。

## 后续授权：备份样例导入 staging

- 用户明确允许将 `data_backup` 部分数据整理进 staging，并提醒旧格式变化。目标仅 `workshop-staging` D1 与 `workshop-client-staging` R2，未操作 production、未 commit／push、未部署 Worker／Web。
- staging 原 projects／users／assets 均为 0、schema 停在 `0011`。先保留非 FTS 业务表快照与 Time Travel bookmark；Wrangler 全库 export 因虚拟表限制失败，未把该命令记作成功备份。快照、书签、SQL、转换结果及验证回执保存在已忽略的 `data_backup/staging-import-20261022/`，目录 0700、文件 0600。
- 从旧库严格选 `approved AND is_published=1 AND visibility=1`，最终导入 **9 个公开项目、9 个发布 revision、6 位必要作者（均 member）、21 个文件共 15,678,301 bytes**。未导入旧管理员权限、会话、OAuth、私有／草稿、未完审核、互动、历史计数、排行或站点配置。
- 格式转换保留公开项目 ID／版本／发布日期，以现行 taxonomy 转换旧 tags；从真实内容按现行 parser 建立 **39 条 worldbook + 4 条 regex 索引**，重算计数／manifest，并原子写完整索引后设置 ready。修正旧导出器将单个 regex 对象的字段数误作条目数的派生数据；没有修改原备份字节。
- 排除 `819cb54c-7448-42ce-9955-62bcf46e7e99`：其 `regex-*.json` 实际为 worldbook，未猜测合并语义或将它冒充正则。所选扩展缺少旧版 subtype，保留 null；未知 schemaVersion 亦保留 null，不伪造。
- 本地隔离迁移和同一份 SQL／R2 演练成功，全部 9 个 detail／cover／entries 匹配。随后 staging 应用现有 migrations `0012`–`0020`，先上传文件并逐个下载校验 SHA／bytes，再执行 106 条加法 SQL；无 DELETE／REPLACE 或既有项目覆盖。
- 线上核验：catalogue 9 项、detail 9 项、cover SHA 9 项、index 43 条、搜索正常；21 个 R2 对象 roundtrip 全匹配，FK 违反 0、索引计数偏差 0。当前 deployed API 未返回工作树新增的 publishedRevisionId 字段，未宣称未部署的新代码已经上线。


## 本次纠错、收敛与本地提交

- 按实际 reader／writer 和产品不变量核对 28 张表，均有用途；删的是 7 个死／镜像字段、旧 OAuth helper、两个无项目业务用途的 asset kind 和整个历史索引读取回退，不凭旧库行数决定保留范围。类型化 metadata 审计、最新 checker 报告投影、checker history、排行／发现／引用／互动仍有明确用途，保留。
- 新增 `0021_remove_obsolete_state.sql`：保留有效 release、共享 R2 引用和作者历史；撤下 ready=0 的旧发布并清除不完整派生索引；不删除原 R2 对象。该迁移只在本地验证，**尚未应用到远程 staging／production**。
- 导入仅产出 users／projects／当前 revision／assets／完整 entry index，不恢复旧权限、草稿、会话、审核或互动。索引解析／entry key 复用 domain 模块，不再复制一套 legacy parser。
- `SchemaCutoverReview` 首轮发现三个导入缺陷：旧封面 key 不在 served namespace、缺少内容 key 时可能静默丢掉发布文件、共享对象复制清单重复。已修复：封面进入 `covers/imported/<sha256>`，原 key 只放 `meta.assetSources`（不进 DB）；内容缺 key 拒绝整项目；共享 destination 按 hash／bytes 去重并拒绝冲突。限定复核无剩余 actionable findings，不将其称为全产品无缺陷证明。
- 修复后完整 `pnpm check` 成功：Worker 85/85、domain 17/17、content 7/7、Tavern client 6/6，schema／导入／SQL export／backup／typecheck／build／staging dry-run 全过。仍有 Biome 47 warnings／1 info、Web bundle >500 kB 提示，未压制。
- 非空升级烟雾确认：有效发布指针、3 条 revision 历史、2 个共享对象 association、当前公开封面、OAuth PKCE／binding、canonical checker 报告均保留；旧不完整发布撤下；FK、搜索与 epoch 正常。脚本为临时演练，不增加永久测试框架。
- 原 9 个真实备份项目经新工具重新转换／本地 D1 加载：6 位 member、21 文件、43 索引；copy manifest 对 21 文件逐个 SHA／bytes 校验。以最终映射 R2 启动 workerd，实际验证 catalogue 9、detail 9、封面 SHA 9、索引 43，并通过本地合成会话取得 12 份原始内容文件，全部 bytes／SHA 匹配。这不是 Discord OAuth 或远程部署验证。一次附加并发本地 R2 灌入出现连接错误，最终改顺序灌入 21 个文件成功，未把失败尝试记为通过。
- 便于追踪的本地源码提交：
  - `ce63274` — API／schema 不变量与旧状态清理；Web 调用方迁移与下一提交配套。
  - `fe61959` — legacy 层级前端重建、真实 primitives、API／客户端调用方及 E2E。
  - `8bdaf97` — 仅导入真实可验证公开内容的本地工具及回归。
- 设计／审计／状态文档另作独立 docs commit，完整提交 SHA 以 Git 历史为准。机器配置、凭据、研究目录、备份和生成物不纳入提交；真实样例目标与验证摘要保留在已忽略的 `data_backup/schema-cleanup-20261022/`。本次无 push、PR、部署或远程数据清理。

## 合并、部署与客户端发布（2026-10-22）

- PR #23 合并到 `main`（merge `8e3567f`），PR CI 与合并后 main CI 均通过。deploy-staging 首次运行完成 `0021` 迁移与 Worker/Web 部署，但在 `Publish staging client` 失败。
- 故障归因：`wrangler r2 object put` 使用 Cloudflare REST API，而桶级 R2 权限（Object Read & Write / Bucket Item Write）只对 S3 API 生效。用同一凭据按 SigV4 写同一桶返回 200，证明不是权限缺失，而是调用方式不匹配。此前“该 token 完全没有 R2 权限”的判断已更正。
- 修复：`apps/tavern-client/scripts/publish.mjs` 的对象上传改为 SigV4 直连 `<account>.r2.cloudflarestorage.com`（access key = token id，secret = SHA-256(token)），D1 记录仍用 Wrangler，写入顺序不变。
- 同时修复 deploy smoke 的断言写法：`curl | grep -q` 会让 `grep` 提前退出，在 `pipefail` 下表现为 `curl (23)`；现改为先落盘再断言，staging 与 production 工作流同步。
- 最终 deploy-staging（`7b0719e`）**全绿**：迁移、Worker/Web 部署、客户端发布（bucket `workshop-client-staging`）、版本记录与 smoke 全通过。当前 staging Worker 版本 `3e3f7d8b-995d-4d32-89a2-bb0d7174aff0`；`/client/staging/index.js` 的 SHA 与 `/api/v1/client/version?channel=staging` 的 revision 一致。
- 两个环境经配置、部署绑定与实测确认分开：staging = `workshop-staging` D1 + `workshop-client-staging` R2；production = `workshop-prod` D1 + `workshop-client-prod` R2。production 本次未被部署或修改。
- 临时诊断工作流与任务分支均已删除，`main` 仅保留原有四个 workflow。本机 token 未上传到 GitHub；该约束记录在机器本地 `AGENTS.local.md`。


## 本轮 W1～W7 改造与验证（2026-10-26，完成）

- 范围依 D-40～D-47；本轮不 commit／push／PR／部署，不操作远程业务数据。W8 完整数据迁移与 W9 正式切换不在本轮执行范围。
- 已整合统一资料／封面／内容冻结送审、人工 block／missing 路由、撤回历史与失效任务保护；独立审核／作者编辑／正文阅读任务层、管理分区；安装多位置实例及 diff 确认；周期排序／总数；配套脚本版本登记 API 与 CLI。实现存在不等于全部验收完成。
- 全量检查第三轮曾退出 0：Worker 114 tests、domain 23 tests、Tavern client 13 tests、类型／schema／迁移／备份／Web build／Worker dry-run；另推送命令真实本地 HTTP 3 tests 通过。该结果早于下列独立复核修正，不能代替最终检查。
- W1 后续复核修正：主动重检显式升级固定 checker；人工重检 pending 的耗尽租约回收；approve／reject 的最终 D1 事务按检查状态、报告 hash、checker revision、manifest CAS。新增竞争与租约回归后统一送审 16 tests 通过；撤回／替代完成后不发布、不重新排队，旧公开更新时间亦不受草稿修改影响。
- W4／W5 第二轮按真实 Tavern Helper 字段投影修正：世界书身份存 extra，正则 UUID 归属记录按角色绑定且写前 pending 留痕；RegExp 的 source／flags 参与 diff 与状态核对；无角色证据的旧 registry 不赋予版本。当前安装客户端 16 tests 通过；测试宿主模拟实际字段剥除及默认值回读，并非真实 SillyTavern 运行。
- 宿主能力边界：扫描全部可读世界书和当前角色正则，其他角色明确未扫描；宿主不存在跨世界书／正则事务，写入中断可能部分完成，必须报告失败并重扫，不伪称回滚成功或自动覆盖玩家内容。
- W6 网关回归已通过：`SELF.fetch` 完整 Worker 入口覆盖 `period=all` 与周期隔离，10 tests 通过；实际浏览器 7d 下载排序返回 200、total=55、25 items，并在排序／周期变化后清 cursor。
- 安装第三轮修复后客户端 17/17 tests 通过；实际 adapter 使用 Tavern Helper `type: "character"` 而非旧 scope 分支。完整扫描确认中断实例全部内容已不存在后，可在明确新装确认时清 pending；预览／取消不写。客户端构建通过（0.1.3，revision `aecc6567690f9c757401adaedb2116ab48e0fb0e8c18b87b7753816ff0720976`）。这不是实际 SillyTavern 验证，也不是最终全量检查。
- 历史停止点：HTTP E2E 第五轮退出 1，按原上限停止；前 14 场景通过，旧点赞 selector `/^点赞\s*\d/` 超时（当前按钮只有“点赞／已点赞”，数量在独立统计区）。随后另获追加授权并于首轮完整通过，结果见下；未跳过后续旅程。
- 本地 1440×1000／390×844 实际操作已覆盖作者独立任务层 dirty 取消、创建／上传／自检／提交及冻结历史，审核完整内容与差异、手机固定操作区和返回队列焦点，管理分区搜索保留，匿名不取正文、登录后独立阅读，周期切换及 Web 无宿主入口。证据 `/tmp/wb-w1-w7-ui-20261026/`；只写隔离本地，8800 的 0023／0024 仅 `/tmp/wb-preview-8800-state`。
- 最终开放式对比发现的阅读关闭焦点与 HTTP `crypto.randomUUID is not a function` 均已修；阅读层显式恢复原条目按钮，桥使用 `getRandomValues` 生成关联 ID。评分评论回填／隐私说明与整体替换文案亦已修，具体差异和未纳入本轮的产品建议见 completion-audit。
- 用户明确批准追加最多 **3 轮**；本次使用追加第 **1** 轮即获得完整 E2E 通过。浏览器专项一度因 1 天本地 debug session 到期返回 401；仅在隔离 state 续期后继续阻塞步骤，不改线上会话或扩大重试轮数。
- 追加首轮 HTTP E2E **21/21 通过**（`local://modern-e2e-extra-round-1.log`）：包含真实排序、详情点赞、作者工作区、owner 工具、批准、拒绝理由及拒绝后再提交。后续详情安全修复由专项浏览器复验覆盖，不将早于修复的 E2E 冒充这些新增行为证明。
- 最终 `pnpm check` 退出 0（`artifact://6319`）：Worker **123/123**（16 files）、domain **23/23**、content **7/7**、Tavern client **17/17**；类型检查、28 表 schema、迁移／SQL export／备份、Web build 与 staging dry-run 均通过。前一次仅被安装源码／regex-host 测试格式阻断，格式化这两文件后重跑成功；Biome **106 warnings** 与 bundle >500 kB 提示未隐藏。
- CLI `node --test tools/push-companion-version.test.mjs`：3/3 通过，覆盖真实本地 HTTP PUT／匿名精确版本核对、拒绝不安全输入及凭据不泄漏；不代表已向线上推送版本。
- HTTP 真实浏览器桥协议专项：未注入 UUID，原生 randomUUID 缺失仍可生成 requestId；scan／confirm 超时、dispose、严格 origin/source/requestId/type 过滤、preview → confirm → cancel 均符合预期。纯消息 host 模拟，无真实宿主写入。证据 `/tmp/wb-w1-w7-ui-20261026/retest-protocol.json`。
- 会话恢复后专项浏览器完成：`/me` 200；1440×1000 和 390×844 下，阅读返回按钮及 Escape 都恢复原条目 option 焦点。评分评论保存、关闭重开回填、仅改星保留评论均通过；手机清空保存后重开评论为空、星级保留。4 次评分写入均 204，手机 scrollWidth=390，无横向 viewport overflow。证据 `/tmp/wb-w1-w7-ui-20261026/retest-auth-ui.json` 及同目录截图；自建 tab 已关闭。
- W1～W7 与最终开放式对比审计完成；文档 checklist 已按本轮证据更新。清单外“阅读行为配置”“已存内容逐条删除”及其他可借鉴项仍明确记录为差异／建议，不声称全旧站等同；W8／W9、真实 ST、线上部署未执行。用户既有修改保留，无本轮 commit／push／PR／部署。
- 用户随后授权补齐开放式对比审计中的两项明确缺口：阅读预览返回白名单行为配置并在登录阅读层纯文本展示；作者编辑器读取当前工作版本已保存世界书／正则条目，确认删除生成 successor，未保存本地选择或冻结版本阻止删除，公开快照不变且仍统一送审。行为配置只保留已确证字段；缺省为“未指定”，role 0/1/2 映射系统／用户／助手，未知值原样显示；regex `findRegex`、替换内容与源码不执行。
- 补充最终 `pnpm check` 通过（`artifact://6405`）：覆盖新版本继承计数修复与回归；Worker 126/126、domain 23/23，schema／迁移／备份／Web build／staging dry-run 通过，Biome 107 warnings 未隐藏。此前专项阅读测试 18/18 通过。编辑器最后格式修正后 Worker/Web 类型检查也通过。
- 真实浏览器桌面 1440×1000／手机 390×844 验收通过：世界书主副关键词、长词、position/order/depth、启用状态和正则表达式／替换长度与真实 preview GET 一致；脚本形态文本没有执行。作者 dirty 时禁用删除，取消零请求，确认删除生成新 revision 并保持旧文件／公开预览不变；关闭重开保留结果，统一送审后冻结。手机阅读与删除确认均无 viewport 横向溢出。证据 `/tmp/wb-gap-supplement/behavior-evidence.json`、`delete-evidence.json` 及同目录截图。
- 删除验收发现新建版本虽继承内容但 summary 计数归零，已修复 `createRevision` 继承当前 revision 的条目计数。新增继承回归与真实 fixture 局部确认通过：未上传替代内容，新 draft worldbook=2，文件实际2条，UI同样显示2条；证据 `/tmp/wb-gap-supplement/delete-inherited-count-confirm.json`。浏览器自建 tab 已关闭，仅写本地隔离 fixture；没有 commit／push／PR／部署或远程业务写入。
- 用户授权修复 107 条 lint 警告：补全 Hook 响应依赖、稳定回调、请求刷新身份与项目／版本重置边界；管理初始加载和轮询通过 Effect Event 读取最新通知回调；重复发现／条目使用内容身份加重复次数的 key；检查器循环移出条件赋值，CSS 按原匹配范围与值调整级联。未关闭规则、增加 suppress 或排除源码。
- 修复后 `pnpm check` 通过（`artifact://6417`）：Biome 检查 219 个文件，零错误／零警告；Worker 126、domain 23、content 7、Tavern client 17 tests 全通过，类型／schema／迁移／备份／Web build／staging dry-run 通过。Vite 主 JS 845.71 kB 的 >500 kB 构建提示仍存在，不等于 lint 警告。
- 修复后完整 `pnpm e2e:local` 单轮 21/21 通过（`local://lint-e2e-result.log`），未改断言或跳过旅程。当前没有文件行数、函数长度或认知复杂度上限；Biome 默认 1 MiB 是跳过分析阈值而非质量门禁，已在 README 明确。没有擅加阈值、commit／push／部署或远程业务写入。
- CSS／Hook 专项真实 Chromium 1440×1000、390×844 通过：卡片 More 圆形／列表 More 方形及展开、侧栏 active 图标、桌面与手机详情尺寸、主按钮 hover、reduced-motion 均保留；筛选／清除／每页 50 可操作，作者任务层 idle 无 DOM 更新循环，各已测页面无横向溢出。截图 `/tmp/wb-lint-smoke/`；自建 tab 已关闭。该数据集只有一页，未专项验证下一页或错误重试；手机另有 7 条外部 Discord 头像 ORB 请求失败，无 JS console 错误，不将外部请求失败混为本次 lint 清零。

## 最新 main 产品整合（2026-10-28，进行中）

- 用户原 `feat/frontend-workflows` 工作树及索引保留；本地保护快照 `local/product-preserved-20261028` 为 `dc15e29b1186deabcde2a58eeecd8989efeb613f`，不推送该混合快照。整合在 `.worktree/product-integration-20261028/`，基线 `origin/main` 为 `bf095ce`，不是把旧架构覆盖 main。
- 保留 main 的模块职责拆分、懒加载、Knip 循环／依赖门禁及 Biome 复杂度／函数与文件行数上限。上节没有行数门禁的描述是旧分支历史，不再描述本次基线。
- `pnpm install --frozen-lockfile` 与完整 `pnpm check` 已通过：Biome 无警告，Knip 依赖／循环、全部工作区类型／测试、真实 workerd Worker 16 文件 126 测试、schema／迁移／备份、Wrangler 和 bundle 门禁通过；未降低规则。客户端 `0.2.0` 构建通过，打包 SHA-256 `fd148b434a6624956e36f96973181db00279e665d80f0aa6f67ea6a3bd2cf25d`；不代表发布渠道已上传。配套版本 CLI 本地 HTTP 风险测试 3/3 通过。独立本地 E2E 与专项浏览器正在执行；后续修复仍须重跑最终 head 的强制检查。
- 本次授权范围为按关注点 commit／push／PR、强制 CI 与独立审查通过后正常合并；无生产部署、tag、远程业务迁移或个人 Cloudflare 凭据使用。W8／W9 与真实 SillyTavern 验证仍未执行。
- 第一轮独立后端审查无发现；客户端／UI 审查指出纯正则实例更新首次新增世界书时缺少目标选择，已修复所有选择与预览消费者并获只读复核关闭。该修复仍需真实本地 UI 验证，静态审查不等于运行通过。
- 第二轮产品独立审查无发现；工具审查发现导入包 SQL 未绑定已验证 target，以及 R2 无条件上传可覆盖旧对象两项 P1。正在修复为生成 SQL 精确校验及隔离副本、相同内容复用／不同内容拒绝／原子条件新建；远程导入未执行，修复与复审通过前不可合并工具切片。

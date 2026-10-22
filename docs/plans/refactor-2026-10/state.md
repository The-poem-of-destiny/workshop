# 当前状态（2026-10-22）

本文件只记录当前工作状态，不作为设计完成或线上部署证明。设计见 [api-design.md](api-design.md)，发现与验证见 [api-audit.md](api-audit.md)，前端映射见 [frontend-fidelity.md](frontend-fidelity.md)。

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


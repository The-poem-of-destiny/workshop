# API 重新审计：事实、决策与处理证据

日期：2026-10-22。原第 4 轮后的暂停经用户“继续”开放续作，已报告缺陷曾修复并完成本地检查（Worker 85/85、E2E 21/21）。随后用户要求先纠正旧数据兼容优先的重构方向；D-39／migration0021 删除无用字段及读时历史回退。本次收敛的验证单独记录，不把原检查或 review 当作新结果，也不据此声称生产已验证。

## 基线来源

独立只读 `ApiEvidence` 审查了 HTTP 路由、storage、contracts、调用方、迁移、调度器；主会话补查并复现关键快照错误。旧文档或已有测试不能替代设计依据。`CacheOperationsReview` 独立复核平台能力和证据边界；另一次机制专项核查三次遭上游拒绝后停止，未记为通过。

## 发现与处理状态

| ID | 可观察问题／违反的边界 | 源码证据（基线符号） | 当前处理状态 |
|---|---|---|---|
| A01 | 失败的元数据 CAS 仍可能改写 revision，并为失败请求写审计 | `storage/authoring.ts:patchProject` 第二条 UPDATE 无 CAS；审计只看 expected+1 | 已改为批次内 dependent-write guard；当前完整检查通过 |
| A02 | 待审快照提交后仍能 PATCH，改变审核对象的类型／标签等 | `patchProject` 无 submission guard | 已拒绝所有有 submission 的 working revision（含已发布指针相同者）；保留快照回归，Worker 全套通过 |
| A03 | submission 在 manifest／索引／校验完成前就能被 cron/DO 领取，失败后再补偿恢复旧任务 | `submitRevision` 先插 checking/queued，再校验；`scheduler` 独立领取 | 已改为先授权、DO 预校验与完整索引，再以 marker/CAS 批次创建真实任务；Worker 全套通过 |
| A04 | upload/submit 没有资源版本前置条件，与其他作者写操作不一致 | `http/routes/authoring.ts`、Web `api.ts` | 已要求 If-Match、原子 rowVersion 链与前端串行传递；类型检查与 Worker 全套通过 |
| A05 | 复用 cover 的 R2 key 后 `.first()` 可选到非发布关联，造成公开封面偶发 404 | `0014_shared_r2_assets.sql`；`app.ts` cover 查询 | 已按当前公开／作者／审核有权 association 做 EXISTS 判定；project-level display cover 有独立引用；公共 gateway 不再带身份进入 Public |
| A06 | 文档存在 `/api/v1/client/version`，实现却只有 `/client/version` | `client-api.ts`、`client.ts` | 已规范为 `/api/v1/client/version`；兼容性无 channel 时 fail closed，宿主识别 bootstrap |
| A07 | 所谓 Workers Cache 实际是旧 Cache API；public detail 在 epoch 读取前预读 DTO，还可能把旧值填到新 epoch 下 | `http/public-cache.ts`、`projectsRoutes.get('/:id')` | 已移除旧 Cache API helper；default gateway 先读 epoch、named Public 接受可信 props，staging-only 配置；epoch 初始种子与 public projection 触发器已补齐 |
| A08 | 借浏览器 public cache 直接返回公开封面／详情，隐藏后仍可能不经过服务器权限边界 | 公开 cache-control 与 visibility 的组合 | gateway 对外响应已统一 `private, no-store`；Public 内部 30s 且 `stale-if-error=0`，身份请求绕过 Public |
| A09 | 裸 release 文件路由和票据路径并存，下载计量可走不同边界 | `projects.ts` releases/files 与 downloads/acquisitions | 已移除裸 release manifest/files，E2E 与 read-path 改走 ticket 唯一字节通道 |
| A10 | token 取 R2 后的消费 UPDATE 不再检查发布指针和可见性；计数失败被吞掉 | `storage/downloads.ts:consumeDownloadToken` | 消费 CAS 已重复检查当前发布／可见性／权限／session，消费与 public 日计量同一 batch |
| A11 | 冻结索引 best-effort，匿名读取在索引缺失时解析完整 R2 内容 | `submitRevision` catch、`content-index.ts` fallback | 解析全部在 DO；submit 同批写 index 与独立 ready marker；历史只读生成与准入分离，原 500 回归通过 |
| A12 | 审核列表历史过滤与 pending 工作队列文档混淆 | `listAdminSubmissions`、admin query schema | 明确为 pending 默认工作队列与可选管理历史过滤，不新增端点 |
| A13 | 固定日期指标夹具与实时日期计算造成日榜 [10,3] 变 [0,0]，不是随机波动 | `scheduler-jobs.test.ts` 的 2026-10-21；`buildRankings()` 的 Date.now | 已统一 scheduled reference time，并限制上下界；Worker 全套通过 |
| A14 | 排行重建把旧 complete 改 building 并先删 entries；中断或并发读会丢失上一份可用结果 | `storage/rankings.ts:buildRankings/getRankings` | 已改 candidate 完成后 conditional winner 才切换；Worker 全套通过 |
| A15 | 排行仅设起始日期，无上界；未来日期数据可进入当前榜单 | `buildRankings` metrics join | 已加入统一参考时刻和 inclusive upper bound；Worker 全套通过 |
| A16 | Web 错误解析读顶层 message，服务端实际返回 error.message | `web/src/api.ts:requestJson` | 已保留 status/code/details 并解析嵌套 error；类型检查通过 |
| A17 | manifest 存在不代表索引已完成，历史／导入数据可能被误返回空索引 | `content-index.ts:getProjectEntryIndex` 旧 `manifest_hash !== null` | 保留独立 entry_index_ready，匿名仅查 ready=1 的持久索引；D-39 删除历史兼容，0021 撤下旧不完整发布，导入必须写完整索引 |
| A18 | 消费 CAS 的 ticket/session 到期判断仍使用取 R2 前时间 | `downloads.ts:consumeDownloadToken` 旧绑定预读 now | CAS 使用 D1 当前事务时钟；事件日期／时间取 consumed_at；补强回归在有效第二会话存在时只使当前会话过期，仍拒绝且不计数 |
| A19 | 历史索引复用当前提交准入，使已发布内容被错误过滤／报错 | 旧 historical fallback 调用 `validateRevision` | 之前拆只读 DO 仍是不必要历史兼容；现按 D-39 删除整个 indexRevision 回退，读取不解析／重新准入，只取已完成索引 |

## 尚未定为缺陷的事项

- 参考集版本 ordinal 的唯一约束保护并发创建；若明确冲突返回 409，竞争失败不是数据损坏，不应擅自增加重试平台。
- home／推荐／site／reference 现在进入 named Public；新增同事务 epoch triggers 覆盖 site/banner、用户公开资料、推荐及 reference 变更。不能继续用旧 no-store 状态解释当前边界。
- D-30 允许已发布项目做经校验的元数据修改，不应以“不可变”之名禁止整个功能；必须分清内容资产／历史审核快照与当前展示元数据。
- 下载消费的“成功”最多能在线性化时证明服务端已打开 R2 对象并取得读取权，不能证明客户端完整收到了流；不能靠测试或计数时机伪造网络送达确认。

## 验证纪律

不扩建繁琐测试集。优先复用现有行为测试、最小烟雾和独立设计 review；只为明确复现且重要的用户可见不变量保留必要回归。源码文本、接线、文案、实现细节不作为新测试目标。研究／设计／实现／运行结果分开记录，未经复核不标记关闭。

## Review 记录与暂停依据

- API round 1：cache/state 两个独立设计切片；吸收上传 CAS、D-30 独立目标、先授权后 DO、finalize-before-queue、发布基线、消费计量和 bootstrap 边界。
- API round 2：补齐公开封面独立替换路径与存量 submission cutover（supersede + audit，保留历史并要求 successor）。
- API round 3：发现并修复带身份封面经过 Public 丢身份、漏选 crop、nullable display fallback、banner epoch、空库 epoch 种子。
- API round 4：A17/A18/A19 未满足；当时按停止条件暂停，未把实现当作通过。随后用户明确“继续”，开放针对这些问题的续作修复与独立复核；未追溯改写原轮次结果。
- 前端 round 1–3 及浏览器证据见 `frontend-fidelity.md`；整体当前状态见 `state.md`。

## 用户授权续作的发现与最终复核

- `ApiContinuationReview` 确认独立 index-ready、历史只读索引路径、DB-clock 消费及日计量修复；又指出 session EXISTS 不能只匹配同用户／version，因为另一有效 session 可能救活本次已过期／撤销的 session。
- 已在 `storage/sessions.ts` 导出内部命名类型 `AuthenticatedSession`，复用认证时计算的 `tokenHash`；消费 CAS 绑定精确 hash、user、version、revoked 和 DB expiry。公共 contracts `Session` 未加 hash，me／auth 响应不序列化内部 hash。
- `SessionBoundaryReview` 首次执行因上游 HTTP403 失败，不算通过；`SessionBoundaryReviewRetry` 独立只读复核无 findings，确认 exact-session／hash 隔离／事务日期／daily dedup 和 UI 就绪修复正确。
- 续作首次 E2E 已通过发布索引 smoke，但暴露详情关系未加载时订阅反向切换；已禁用未知状态的互动，并让 harness 等 enabled 后读标签，不靠重试掩盖状态。
- 最终 `pnpm check` 完整通过：Worker **85/85**，domain **17/17**，content **7/7**，Tavern client **6/6**，类型／schema／migration／export／backup／Web build／staging dry-run 均成功。
- `FinalReopenedE2E` 执行 `pnpm --filter @workshop/worker web:build && pnpm e2e:local`，**21/21** 成功；含实际 published entries（revision、key、hash、length 且不含 content）、订阅／作者／审核／owner／successor 流程。
- 非失败提示仍有 Biome 47 warnings／1 info 与 Web bundle >500 kB；未擅自扩大范围修复。没有 commit、push、PR 或 staging／production 部署，未验证 hosted cache 全球行为、真实 Discord OAuth 或真实 SillyTavern 游玩。

## Schema 收敛纠错后的验收

- D-39 按 28 张表的实际用途收敛；migration `0021` 删除 7 个无用／重复字段并收窄资产种类，撤下没有完成索引的旧发布，不保留 `indexRevision`／R2 读时修复。
- 独立 `SchemaCutoverReview` 对已有非空库升级、canonical 数据保留及精简导入器作只读复核，发现三项实际导入问题：封面 namespace、缺内容 key 的部分发布、共享对象复制重复。修复后限定复核无剩余 actionable findings。
- 修复后的 `pnpm check` 完整成功（Worker 85/85）；当前 Worker/Web 的 `SchemaCutoverE2E` 21/21。真实 9 项备份经新工具加载到隔离 D1/R2，再由 workerd 读取 9 个 detail／9 张封面／43 条索引及认证下载 12 份内容，SHA／bytes 全匹配。另有非空 schema 升级 smoke，未增永久框架。
- 用户已授权本地分批 commit；当前不再沿用之前“不 commit”的边界。没有 push、PR、部署或远程执行 `0021`，不宣称原 goal 等于全产品或上线完成。


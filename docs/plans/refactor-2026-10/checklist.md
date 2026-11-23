# Creative Workshop 重构 Checklist

更新：2026-11-22。当前核对基线为 `origin/main` 的 `bd13703`（含版本备忘 #94、当前订阅推荐资格 #93、政策准入与合集 #95、五分类 `规则扩展` #107 及 `[工坊]` 标记 #108）；精确合并与验证证据见 [state.md](state.md)。

状态口径：下节“当前交付与验收门槛”的 `[x]` 表示对应源码已合入 `main` 且已有明确范围的本地／CI 证据；`[ ]` 表示该项尚未完成。**本文件不是全部旧复选框清零即可上线的授权书**：源码合入不等于线上生产已部署，历史清单不再定义当前 backlog，真实数据切换和生产发布必须另获授权。

按主题选择下一项工作或查找尚未定案的线头，见[上线前重构：待核对与收口清单](open-threads.md)。本页继续跟踪交付与验收，不重复记录设计待办。

## 当前交付与验收门槛

- [x] 核心 Worker／Web／Tavern client 源码已合入：统一冻结送审、审核与作者／管理工作区、安装实例与整体预览／确认、玩家改动保护及 `[工坊]` 世界书条目／注册表标记（读取兼容历史 `[WS]`，PR #108）；本地行为与 CI 证据见 state，不代表真实 Discord／SillyTavern 已验收。
- [x] PR #89 四普通标签上限、PR #90 结构化分类与显式审阅离线候选工具、PR #91 预览／焦点／完整发现批次与手动推荐阅读、PR #95 社区低调入口／政策 3 题准入／合集、以及 PR #107 **五分类收敛**（`系统核心`、`角色`、`内容扩展`、`规则扩展`、`体验优化`）与布局重做均已合并。决策依据见[五分类与体验精修记录](../../../.agents/notes/implemented/community-access-collections-and-ux-refinement.md)与[离线切换基础记录](../../../.agents/notes/implemented/six-category-taxonomy-and-reviewed-cutover.md)，视觉范围见[映射](frontend-fidelity.md)。
- [x] 历史 staging 迁移在 2026-11-06 取得 210/210 批及源／目标／搜索对账验收；这是既有 schema 的阶段证据，不是当前五分类／新 schema 生产切换完成。
- [x] 版本绑定的本人体验／评分备忘：[PR #94](https://github.com/The-poem-of-destiny/workshop/pull/94) 已实现、独立审查且 exact-head required checks 通过后正常合并；本地证据不代表生产启用，不将旧无版本评分猜配到任一版本或公开。
- [x] 当前订阅才可新增／编辑玩家推荐：[PR #93](https://github.com/The-poem-of-destiny/workshop/pull/93) 已纠正并通过 Worker API、Chromium 与 exact-head required checks 后正常合并（`b7be9ee`）。退订立即失去资格，既有推荐保留且本人可撤回；重新订阅恢复资格，不保留历史资格或从下载、安装、评分推断订阅。该证据不代表生产部署或真实生产数据切换。
- [ ] 当前五分类 schema／taxonomy 真实生产切换：另行授权；保留当前源 D1/R2，检查候选 schema 与关键数据，切换后验证受影响路径。不要求完整恢复演练或逐项独立对账。
- [ ] 当前版本真实 Discord 完整登录／准入与真实 SillyTavern 安装／更新／卸载验收，见 [user-actions.md](user-actions.md)。合成本地账号与消息宿主不替代它们。
- [ ] 目标环境 Cache API hosted 行为与陈旧风险验收；方案以 [D-49](decisions.md#d-49-分类-ttl-cache-api)、[缓存设计](../../reference/cache-design.md)和[运行配置](../../reference/runtime-configuration.md)为准，不验证全球 purge 或旧 Workers Cache 方案。
- [ ] 生产首次切换、发布审批和精确部署版本验收；按[切换手册](../../operations/deployment-safety.md#schema-evolution-and-production-cutover)保留恢复点，生产切换尚未执行。

已合并功能 PR 的授权不包含建 tag、生产部署或生产数据操作。不绕过分支保护。发布按[滚动规则](../../operations/deployment-safety.md#routes)进行；`0001_initial.sql` 只初始化空库。经典界面迁移、双前端开关及每日抽签继续暂缓。

## 本轮工作包（2026-10-26）

以下为 2026-10-26 的历史工作包，依据 [D-40～D-47](decisions.md#d-40-完整替代旧版与完整数据迁移)保留当时的实现、测试范围及编号。W1～W7 已经过后续 main 整合；测试数字不是当前分支新测量。W8／W9 的当前边界以上节为准，不再把既有 staging 的已修正问题列为未完成代码工作。

- [x] W1 统一提交与审核模型（D-43）：元数据、封面、内容统一冻结，移除展示直写；作者 block／missing 转人工，pass／warn 经独立云检查；撤回／替代与失效任务、人工证据 CAS 由真实 D1 回归覆盖。最终 Worker 123 tests 与 E2E 21/21 通过，详见 state。
- [x] W2 审核独立任务层（D-43／D-46）：独立完整内容／双方 revision 差异、固定操作区、返回队列焦点与连续审核；桌面／手机本地操作及批准／拒绝／再次提交 E2E 通过，证据见 state。
- [x] W3 作者／阅读／管理与手机组织（D-46）：独立编辑、未保存保护、统一资料／文件／提交历史、独立长文阅读和管理任务分区；保留已确认视觉方向。桌面／手机实际操作通过，阅读关闭焦点与评论回填／改星保留／显式清空专项通过；记录见 state。
- [x] W4 安装实例与旧数据适配（D-41）：可靠旧身份、多位置独立版本、完整扫描范围／失败证据、存疑不认领；宿主 adapter、Web bridge 与 UI 一并迁移。客户端 17 tests 和 HTTP 真实浏览器消息协议覆盖；按用户要求未操作真实 SillyTavern。
- [x] W5 修改 diff 与整体操作（D-42）：先预览再确认，整体替换／删除选中实例内容，取消零写入、状态变化重核对、无关内容保留；确定性客户端测试通过。宿主无跨资源事务，未知部分写入必须重扫，不保证底层原子 CAS。
- [x] W6 全项目查询与分页（D-44）：四类排序、7／30／90 天点赞净增量与有效下载、完整结果集及 total；真实 D1 边界／分页／Worker 网关回归和浏览器排序 E2E 通过。不恢复旧发现接口。
- [x] W7 配套脚本版本推送（D-45）：owner API、不可变版本登记与匿名读取、独立调用工具；Worker API 回归及 CLI 真实本地 HTTP 3 tests 通过。不上传／执行脚本，不做前端健康面板。
- [ ] W8 当前快照迁移：历史 210/210 只代表 2026-11-06 的 staging 演练；当前库仍需另行授权并准备、核对候选。
- [ ] W9 正式切换（D-40）：另获授权后按[切换手册](../../operations/deployment-safety.md#schema-evolution-and-production-cutover)停写、保留来源、切换并冒烟；不提供旧协议长期兼容。

每包验收需实际运行改变的路径；界面需桌面／手机操作证据。本轮依用户明确要求，客户端／宿主行为用确定性代码级测试验收，不进行真实 SillyTavern 操作；报告必须保留这个证据边界。完成决策记录不等于完成实现，既有本地／staging 样本也不等于 W8／W9。

## 历史细项（2026-10-21～2026-10-26）

以下第 0～12 节保留当时的勾选、实现名称、schema 链、测试数与部署版本，**不是当前实现合同或待办**（早期 `features.md` 与原 `archive/*` 已统一归档至 [`../../archived/refactor-2026-10/`](../../archived/refactor-2026-10/README.md)）。其中旧 shim、项目级评分、四卡发现区、独立展示资料修改及旧 migration 链等已被后续决定／实现取代；不要按本节执行迁移或恢复已删除兼容路径。当前状态以本页顶部、[API 参考](../../reference/worker-api.md)、[客户端宿主协议](../../reference/host-protocol.md)及[用户验收事项](user-actions.md)为准。


## 0. 文档与仓库

- [x] 单一 `decisions.md` 作为决策源。
- [x] `features.md` 功能清单与 `main.md` 架构方案保留。
- [x] 删除原始 model 方案；历史材料移入 `archive/` 并由 `archive/README.md` 标注非事实来源。
- [x] pnpm workspace、单 lockfile、Node 版本与 CI 入口。
- [x] `pnpm check` 覆盖 workspace、strict typecheck、worker/domain/content 测试、schema、迁移测试、wrangler dry-run。
- [x] 删除旧 `cloudflare/`、旧 E2E/Playwright、PowerShell 部署器、提交的 `dist/`/`test-bundles/`。
- [x] 旧客户端 `src/`、`util/`、`config/`、`test-dist/` 与 webpack 构建链移出当前工作树；旧版本在 `../workshop-legacy`（`4fdf71a`）只读对照。
- [x] CI 对精确 SHA 构建一次并逐级提升同一 artifact；artifact 现含 Web、Worker bundle、Tavern client（当前未在 staging 实际部署验证）。
- [x] 部署流水线包含 D1 migration、artifact hash、Worker version 记录、client 发布与 smoke（workflow 已实现；真实部署仍需环境审批）。

## 1. 平台与数据模型

- [x] 单 Worker + Static Assets；`/api/*` JSON 404 不被 SPA 吞。
- [x] `apps/worker/migrations/0001_initial.sql` 基线表、外键、FTS 表与触发器；0002–0006 追加。
- [x] workerd + 本地 D1/R2 集成测试。
- [x] `ContentService` Durable Object（D-01），自审、租约、自动发布、重试。
- [x] `scheduled`/cron 入口（榜单、清理、自动审核派发）。
- [x] 项目版本标签字段（schema/contracts/API/客户端）。
- [x] 元数据检查字段与 findings（D-30）。
- [x] 客户端版本记录：`site_settings.client_channels`（publish 脚本写入）+ 版本化 R2 对象。
- [x] Banner 上传与 `assets.kind` 写入路径；作者头像按 D-27 使用 Discord，不做 avatar 上传。

## 2. 认证与权限

- [x] 角色存 `users.role`，每请求查库；owner 保护；会话撤销。
- [x] `POST/GET /auth/flows`、Origin 白名单、D1 flow。
- [x] `GET /me`、`DELETE /sessions/current`。
- [x] Discord callback / `POST /auth/flows/:id/redeem` / 设备码。
- [x] 生产 session 创建、30 天滑动过期（`touchSession`）。
- [x] PKCE verifier 可兑换；服务端只存 hash。
- [x] session token 使用 HMAC（配置 `SESSION_HASH_SECRET` 后生效；staging 已设置）。
- [x] 公会准入 `DISCORD_ALLOWED_GUILD_IDS`；可选按 Guild 校验身份组 `DISCORD_GUILD_ROLE_IDS`（staging 已配置：`1134557553011998840` 需要身份组，`1417861565679669272` 仅校验公会）。
- [x] OAuth flow 绑定发起浏览器 cookie；staging 无 cookie 404、带 cookie 200。
- [x] CORS 允许列表与安全头；严格同源 CORS；静态 shell 设置 CSP（允许 iframe 嵌入）。
- [x] `oauth_flows.origin` 与 D-10“不存储请求 Origin”的口径统一。
- [ ] 真实 Discord 授权完整旅程（用户已确认 callback 配置并实测 staging 登录成功；嵌入／设备码、刷新退出与公会／身份组拒绝路径仍待人工验收；见 user-actions.md）。

## 3. 公开读、搜索与发现

- [x] 公开 list/detail/home/recommendations/reference-sets/site。
- [x] 详情匿名摘要；manifest/files 需登录。
- [x] FTS trigram（≥3 字）。
- [x] 1–2 字搜索走 `project_search_short MATCH`。
- [x] 标签筛选、作者筛选。
- [x] API 默认 24/页；统一 cursor/nextCursor 契约。
- [x] Web 分页/加载更多与“第 X–Y 条”。
- [x] 发现栏使用独立推荐批次；逐用户曝光采集已移除。
- [x] 普通作品列表支持 7/30/90 天及全部周期的指标排序；独立推荐位不再生成榜单。
- [x] reference version items + hash 指纹（B10/C11）。
- [ ] 每日抽签接口（Q-10 暂缓，不阻塞当前开发）。

## 4. 创作与内容

- [x] 创建项目、两态可见性、CAS 更新。
- [x] 不可变 revision、worldbook/regex/cover 上传、冻结、submit。
- [x] 作者私有 draft 摘要。
- [x] 单次上传；attestation/二次上传已删除。
- [x] 上传/提交调用 `validateProjectContentText` 与 `validateProjectContentPolicy`。
- [x] 空世界书/非法 JSON/项目类型不匹配内容拒绝。
- [x] 元数据检查：长度、控制字符、版本格式、封面尺寸、频率、审计。
- [x] Discord 线程 URL host/guild/path 白名单。
- [x] 单条目删除生成新 revision。
- [x] 项目软删 `DELETE /projects/:id` + 清理任务。
- [x] 拒绝原因必填并对作者可见。
- [x] `GET /me/projects`、`GET /me/subscriptions`。
- [ ] 兼容性元数据、安装注意事项、原版冲突选择、提交前引用检查。
- [x] 封面位置/缩放字段与 UI。

## 5. Checker

- [x] 从 `2aa31fb^` 移植 checker 源码到 `packages/content`。
- [x] L1–L7 组合兼容规则。
- [x] M1–M5 能力/风险规则。
- [x] U2–U5 外链/媒体规则。
- [x] API1–API2 规则。
- [x] AH1–AH4 提示规则。
- [x] EJS-PARSE / JS-PARSE / FILE / CHECKER-INTERNAL / CHECKER-LIMIT。
- [x] 预算：2000 条目、500 单元、20 万字符、4 万/10 万 AST、120s。
- [x] upload-checker 与 review-checker bundle 构建；Web 在提交前执行 browser checker。
- [x] upload/review bundle 的独立 `?v=` 分发路由与 immutable 缓存（`/client/checker/v/<revision>/...`，staging 200 immutable）。
- [x] 上传端记录 client gate / warning count / acknowledged / checked_at。
- [x] DO 权威复核；pass/warn 自动发布，block/missing/超时转人工。
- [x] 审核绑定 `submission + content hash + checker revision`；本地重跑同 revision。
- [x] 报告、fingerprint、diff、baseline、accepted/changed/new/removed（审核详情读取上一 submission 的条目与 findings 差异）。
- [x] checker 语料/behavior test（T2）。

## 6. 审核与发布

- [x] 审核队列/详情、批准/拒绝、单 batch 切 published 指针。
- [x] 角色变更、最后 owner 保护、审计写入。
- [x] `GET /admin/audit-events`。
- [x] 审核详情读取 cover 文件；worldbook/regex 条目级 diff。
- [x] 拒绝理由必填并写审计。
- [x] 审核 request 不得覆盖 submission `checker_revision`（D-31）。
- [x] 自动结果与人工结果都写审计；人工覆盖自动结果写理由。
- [x] 审核队列只拉 `pending`，一次返回全状态 counts，keyset cursor，动作后本地推进（D-36）。
- [x] 管理项目列表过滤已删除项目并支持筛选。

## 7. 互动与下载

- [x] 点赞/订阅/评分幂等；评分仅本人可见。
- [x] 下载计数按 user/project/day 幂等，触发器原子增量；只在票据消费成功时计数。
- [x] `POST /acquisitions` 返回一次性票据；文件路由消费 token 后才计数。
- [x] 公开计数/周期计数的展示口径与 D-27 对齐。

## 8. 客户端与分发

- [x] `apps/tavern-client`（D-20）；旧 `src/CreativeWorkshop` 明确停用。
- [x] `/client/*` Worker 代理 R2、stable/staging 指针、版本化对象。
- [x] 客户端版本记录 + 精确 channel 门禁（D-06）。
- [x] 旧客户端兼容提示：`/test-dist/CreativeWorkshop/index.js` 返回迁移提示并加载 stable client（旧 API 映射未做）。
- [x] `test-dist` shim 由新 Worker 服务（D-33 窗口到期后删除）。
- [x] D-08：移除配套脚本展示/依赖健康检查（config + bridge + service）。
- [x] 固定导入 URL 和版本化客户端对象；缓存策略见 D-49。
- [ ] 真实 SillyTavern 安装/更新/修复旅程。
- [~] 安装状态：本地世界书为权威，订阅/下载/安装分离（D-35）；已显示未安装/已安装/可更新，本地修改与扫描状态待客户端扩展。

## 9. 管理后台

- [x] 项目列表、成员列表、角色修改、审核队列。
- [x] 站点设置写接口（`PUT /site`）。
- [x] Banner 上传与位置/缩放设置（owner POST /site/banner + R2 + 公共 URL）。
- [x] 编辑精选写入/删除。
- [x] 角色引用 set/version/items 登记。
- [x] 审计日志读取。
- [x] 管理端权限与操作审计覆盖所有写接口。

## 10. Web UI

- [x] 公开单屏列表、详情侧栏、搜索框、4/3/2/1 响应式。
- [x] 排序 tab 在默认视图生效。
- [x] 作者筛选（详情点作者名 → `authorId` 过滤 + 清除）；分页、“我的项目”已完成。
- [x] 发现栏只保留 4 卡发现；移除最新/推荐/周热度重复货架；保留我的订阅 UI。
- [x] 登录态、作者创建/编辑/上传/提交后台。
- [x] 审核队列/详情/批准拒绝后台。
- [x] Toast、弹窗集合、警告标记、Discord 按钮、Banner 位置缩放。
- [x] 卡片作者头像/时间/一句话/更新时间；详情显示发布/更新时间与 schema。
- [x] 详情展示项目简介；项目级作者备注已移除，不做作者级独立 bio。

## 11. 缓存、调度与运维

- [x] 第一阶段动态 API `private, no-store`；文件/审核文件 no-store。
- [x] 静态 hashed 资产 immutable（Worker `/assets/*` 返回 `max-age=31536000, immutable`）。
- [ ] D-49 Cache API hosted 命中、隔离与写入／撤回场景验证；目标环境操作和上线须另经用户授权。
- [x] cron：榜单、7d/30d、清理、过期 session、自动审核。
- [x] 可观测性采样率；错误不采样（`shouldSampleRequest` + 单测）。
- [ ] 定期备份与校验（J6；已加导出校验工具与单测，缺 Cloudflare 定期备份调度）。
- [x] 备份导出校验：assets bytes/sha256、项目 published/working 指针。
- [x] D1 rows read/write 预算测试：公共列表页 rows_read < 200、rows_written = 0（单测）。

## 12. 测试、迁移与上线

- [x] Worker 76 测试、domain 17、content 7、schema 27 表校验。
- [x] 迁移 synthetic + SQL converter 测试。
- [x] 真实备份全量两次 + delta + reconcile；隔离本地 D1 load。
- [x] 本地 HTTP E2E 19/19；真实 Chromium 搜索/排序 DOM、作者工作台+订阅、owner 管理、审核通过/拒绝、拒绝→改稿重提 6 条旅程。
- [x] staging 部署、D1 migration 0002–0011、Worker `7625ef0a-5ff6-4c19-9d6a-479ee44c47a1`（commit `e04e43a`）。
- [x] R2 批量复制适配器（manifest、SHA/bytes 校验、本地演练、幂等重跑、损坏修复、remote `--apply`）。
- [x] 迁移映射覆盖 site_settings、project_metrics_daily、ranking_runs/entries、discovery_exposures；本地测试断言不再被列为 dropped。
- [ ] staging 真实数据导入与独立 reconcile（需授权目标）。
- [x] T3 entry-key/fingerprint/玩家修改保留单元测试（tavern-client 4 项）；真实 ST 旅程未验。
- [x] T6 新公开 API 契约由 `apps/worker/test/read-path.test.ts` 覆盖；旧响应样本与 `tests/legacy-contracts.test.mjs` 已删除，不再维护旧客户端兼容。
- [x] Playwright 5 条真实浏览器旅程（本地 Worker + 真实 Chromium）。
- [x] staging 远程 HTTP smoke：health/list/root/reference-sets/site/home 200，Origin 拒绝 403，client compatibility 200。
- [ ] 生产切换 runbook 执行与人工审批。
- [ ] 生产旧库只读保留、回滚窗口、监控指标演练。

## 上线判定

以下是早期历史判定，保留供追溯，不作为当前授权或要求逐个完成旧功能的清单；当前门槛只见本页顶部及部署 runbook：

- 第 2、5、8、9、10、11 节无未完成项。
- 第 4、6 节无未完成项。
- 第 12 节的生产切换项由人工完成并记录 Worker version、commit SHA、migration 列表。
- `pnpm check`、E2E、staging 冒烟全绿。

# Creative Workshop 重构 Checklist

更新：2026-11-23。当前核对基线为 `origin/main` 的 `d7deb9d`（含版本备忘 #94、当前订阅推荐资格 #93、政策准入与合集 #95、两阶段预装载／增量工具 #104、五分类 `规则扩展` 与双桶客户端分发 #107、`[工坊]` 标记 #108 及全仓上线前加固 #109）；精确合并、远端预装载与 `staging` 发布证据见 [state.md](state.md)。

状态口径：下节“当前交付与验收门槛”的 `[x]` 表示对应源码、预装载或 `staging` 发布已完成并取得明确范围的验证证据；`[ ]` 表示该项人工验收或正式生产切流尚未完成。**真实生产切换与 `v*` tag 发布仍须用户明确下达上线授权后执行。**

按主题查找收口结论与剩余边缘观察项，见[上线前重构：待核对与收口清单](open-threads.md)。

## 当前交付与验收门槛

- [x] 核心 Worker／Web／Tavern client 源码与上线前安全加固已合入（至 `d7deb9d`，PR #109）：统一冻结送审、安全威胁分级路由、跨站内嵌 OAuth `launch/bind` + `Partitioned` cookie、兼容 TavernHelper 子 iframe 的宿主桥接、安装实例整体预览／确认、玩家改动保护及 `[工坊]` 世界书条目／注册表标记（兼容历史 `[WS]`，PR #108）；详见[上线前加固记录](../../../.agents/notes/implemented/pre-launch-hardening-oauth-bridge-and-cdn.md)。
- [x] PR #89 四普通标签上限、PR #90 结构化分类与显式审阅离线工具、PR #91 预览／焦点／完整发现批次与手动推荐阅读、PR #95 社区低调入口／政策 3 题准入／合集、以及 PR #107 **五分类收敛**（`系统核心`、`角色`、`内容扩展`、`规则扩展`、`体验优化`）与弹性布局重做均已合并。决策依据见[五分类与体验精修记录](../../../.agents/notes/implemented/community-access-collections-and-ux-refinement.md)与[离线切换基础记录](../../../.agents/notes/implemented/six-category-taxonomy-and-reviewed-cutover.md)，现行交互见[使用指南](../../guides/using-workshop.md)。
- [x] 版本绑定的本人体验／评分备忘（[PR #94](https://github.com/The-poem-of-destiny/workshop/pull/94)）与当前订阅才可新增／编辑玩家推荐（[PR #93](https://github.com/The-poem-of-destiny/workshop/pull/93)）已合入并随 `d7deb9d` 部署至 `staging`：无版本旧备忘只读保留且本人可删，退订立即失去推荐新增／编辑资格但保留既有推荐与本人撤回权；详见[版本备忘与推荐决定](../../../.agents/notes/implemented/version-experience-notes-and-recommendations.md)。
- [x] 滚动 `staging` 自动发布全链已在 `d7deb9d` 跑通验收：GitHub Actions `deploy-staging` 完成 98/98 对象只读 schema 核验、`workshop-staging` 部署、双桶客户端发布（`workshop-client-staging` + `workshop-img-staging`）、HTTP smoke 与 `staging-evidence` 归档。
- [x] `staging` 与 `production` 初始五分类 + 98/98 canonical schema D1/R2 预装载已完成：`workshop-staging-migrate-977ebb415bf6`（593 版本、585 条 FTS）与 `workshop-prod`（246/246 批对账导入 + 531 条 `public_cover_replicas`，616 版本、607 条 FTS）均已就绪，`workshop-client-prod`（1,272 对象）、`workshop-img-prod`（531 封面）与 `workshop-backups-prod` 已激活，历史冗余 `workshop-covers-*` 桶与旧候选库已清理。
- [ ] 当前版本真实 Discord 完整登录／准入（含 SillyTavern 内嵌跨站弹窗 `launch/bind`）与真实 SillyTavern + TavernHelper 安装／更新／卸载人工验收（现可直接在 `staging` 执行），见 [user-actions.md](user-actions.md)。
- [ ] 正式上线切换：获授权后对旧站停写、按需执行快照后增量 `delta` 同步（`d1_delta.py` + `delta-withdrawals.json`）、审批受保护 `v*` tag 将 `staging` 已验收产物提升至 `production`、合并角色卡仓库 PR #48／#49 并切换旧站跳转；按[切换手册](../../operations/deployment-safety.md#schema-evolution-and-production-cutover)保留恢复点并核验精确部署版本。
- [ ] 目标环境真实流量下的 Cache API、R2 CDN 命中与 Free 套餐实耗／WAF 阈值验收；方案以 [D-49](decisions.md#d-49-分类-ttl-cache-api)、[D-53](decisions.md#d-53-上线前架构收敛与条款替代汇总)、[缓存设计](../../reference/cache-design.md)和[边缘上线计划](edge-cache-rollout.md)为准。

已合并功能 PR 与数据预装载不包含自动创建 `v*` tag 或擅自执行正式切流。发布按[滚动规则](../../operations/deployment-safety.md#routes)进行；`0001_initial.sql` 只初始化空库。经典界面迁移、双前端开关及每日抽签继续暂缓。

## 本轮工作包（2026-10-26）

以下保留 2026-10-26 依据 [D-40～D-47](decisions.md#d-40-完整替代旧版与完整数据迁移) 划分的工作包编号供历史决策引用交叉核对；后续演进（PR #89～#109）与当前验收门槛均以上节为准：

- [x] W1 统一提交与审核模型（D-43，后续威胁分级细化见 D-53）
- [x] W2 审核独立任务层（D-43／D-46）
- [x] W3 作者／阅读／管理与手机组织（D-46，后续布局与合集演进见 PR #95／#107）
- [x] W4 安装实例与旧数据适配（D-41，后续 `[工坊]` 标记与 TavernHelper 子 iframe 桥接见 PR #108／#109）
- [x] W5 修改 diff 与整体操作（D-42）
- [x] W6 全项目查询与分页（D-44，后续五分类、合集过滤与 FTS 先行优化见 PR #102／#107）
- [x] W7 配套脚本版本推送（D-45）
- [x] W8 存量快照预装载与五分类 98 对象候选对账（`staging` 与 `production` 初始预装载已完成；停写后若有增量写入，归入下项正式切流前执行 `delta`）
- [ ] W9 正式生产切换（D-40）：待上线授权后停写、按需执行最终 `delta`、审批 `v*` tag 发布并验证线上关键路径。

## 历史细项归档说明

2026-10-21～2026-10-26 阶段的早期分节复选框（含已废弃的 `0002–0011` 旧迁移链、一次性票据下载、`reference-sets`、四卡发现区及独立公开资料直写等早期过渡形态）不再代表现行架构或待办，对应历史盘点、审计与对照文档已统一归档至 [`../../archived/refactor-2026-10/`](../../archived/refactor-2026-10/README.md)。当前有效接口与协议契约以 [API 参考](../../reference/worker-api.md) 和 [客户端宿主协议](../../reference/host-protocol.md) 为准。

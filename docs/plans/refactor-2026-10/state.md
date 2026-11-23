# 当前状态（2026-11-23）

本文件区分已合并源码、本地验证、线上 `staging` 实测状态与尚未完成正式切换的 `production` 预装载状态；commit、CI 通过、PR 合并以及 `staging` 部署都不等于 `production` 已正式切换上线。当前行为以 [API 参考](../../reference/worker-api.md)、[使用指南](../../guides/using-workshop.md)、[宿主协议](../../reference/host-protocol.md)及[运行配置](../../reference/runtime-configuration.md)为准。2026 年 10 月重构阶段的设计草稿、时点审计与过程记录已归档至 [`../../archived/refactor-2026-10/`](../../archived/refactor-2026-10/README.md)，不作为当前缺口清单。

## 当前远端环境实况（2026-11-23）

### 1. `staging`（滚动发布全链已跑通并在线运行 `d7deb9d`）

- **GitHub Actions `deploy-staging` 全链验收通过**：基线 `d7deb9d`（PR #109）在 GitHub Actions 依次通过 `Verify live staging schema`（98/98 个 canonical schema 对象完全一致）、`Deploy staging worker`（`workshop-staging`）、`Publish staging client`（同时通过 S3 SigV4 上传至私有桶 `workshop-client-staging` 与公开 CDN 桶 `workshop-img-staging`，并原子更新 `site_settings.client_channels`）、`Smoke test`（健康检查、公开目录、匿名 `/me` 401、Web 入口及客户端字节与频道版本核验），已生成保留 90 天的 `staging-evidence` 验收凭证。
- **线上入口与安全边界**：应用自定义域 `https://workshop-staging.poem-of-destiny.3378469.xyz` 与公开资源 CDN 域 `https://assets-staging.poem-of-destiny.3378469.xyz` 均正常服务；`workshop-staging` 的 `workers.dev` 与 `preview_urls` 已关闭（实测 404）。两个应用自定义域共用的 Free zone 目录宽松限流（60 请求／10 秒）已在边缘实测生效，见[边缘上线记录](edge-cache-rollout.md#2-waf-与速率限制)。
- **数据库与公开图片桶状态**：绑定的 `workshop-staging-migrate-977ebb415bf6` D1（`da75f6bf-1daa-40aa-b4ea-03293d8c6aac`）已对齐五分类与 98/98 个 canonical schema 对象（含 593 个项目版本、585 条 FTS 搜索索引）；`workshop-img-staging` 承载公开封面／画廊／横幅副本与 `staging` 客户端产物。真实 Discord 跨站嵌入登录与真实 SillyTavern 宿主完整旅程现可直接在 `staging` 开展人工验收（见 [user-actions.md](user-actions.md)）。

### 2. `production`（D1/R2 预装载已完成，Worker 尚未执行 `v*` 切换）

- **目标 D1 与 R2 预装载完成**：`workshop-prod` D1（`ebf2963e-dcd7-43db-93b0-4d1cff524656`）已完成 100% 预装载（246/246 批全量导入与独立对账通过，含 531 条 `public_cover_replicas`）并升级对齐五分类与 98/98 个 canonical schema 对象（616 个项目版本、607 条 FTS 搜索索引）。`workshop-client-prod`（1,272 个对象）、`workshop-img-prod`（531 张公开封面，绑定 `https://assets.poem-of-destiny.3378469.xyz`）及长期备份桶 `workshop-backups-prod` 均已就绪。
- **冗余历史资源已清理**：早期试点与过渡阶段的冗余资源 `workshop-covers-staging`、`workshop-covers-prod`（R2 桶）及 `workshop-staging-migrate-f3b98515735f`（D1 库）已于 2026-11-23 删除。
- **尚未执行的正式上线切换**：`production` Worker 尚未通过 `v*` tag 触发受保护发布，应用域 `https://workshop.poem-of-destiny.3378469.xyz` 仍为切流前占位状态；旧线上系统停写后的最终增量 `delta` 同步（若快照后旧站仍有新增写入）、`v*` tag 审批提升、角色卡仓库 PR #48／#49 合并及旧站入口跳转均待用户下达正式上线授权后执行。

## 当前 staging：EDGE-01

- **三类公开图片与客户端双桶架构已收口**：封面（`public_cover_replicas`）、画廊（`public_gallery_replicas`）与站点横幅（`public_banner_replicas`）三张公开副本表及触发器已统一并入上线前 98 对象空库基线 `apps/worker/migrations/0001_initial.sql`（早期临时拆分的 `0002`～`0004` 增量文件已在 PR #104 合并收口）。公开桶统一为 `workshop-img-staging` 与 `workshop-img-prod`。
- **历史边缘与回填验证**：[60 秒 CDN 探针](edge-cache-rollout.md#普通公开封面独立撤回试验)在 NRT 实测 `200 MISS` → `200 HIT`、自然到期与精确 URL purge；`staging` 在线回填 525 个公开项目（513 个封面 `ready`、12 个无封面，零错误），且真实项目公开→私有的下架撤回窗口已实测回到 `404 BYPASS`。本地 D1/R2 另覆盖画廊与横幅的替换、撤回、并发围栏及 `delta-withdrawals.json` 先删源再推进状态的边界。真实生产流量下的多 PoP 命中与额度实耗仍待上线后按 [edge-cache-rollout.md](edge-cache-rollout.md#4-workersd1r2-实耗验收) 核验。

## 当前 main 与已完成范围

当前 `origin/main` 基线为 `d7deb9d`（含 PR #87～#95、#99～#105、#107～#109）。源码合入 `main` 与 `staging` 部署成功**不代表 `production` 已完成正式切换上线**；部署与切换门禁见[发布手册](../../operations/deployment-safety.md)。

- **统一版本、送审与审核安全边界**：统一项目版本、元数据／封面／正文冻结送审、自动与人工审核、报告校验、权限及作者／审核者／owner 工作区已合入。[PR #109](https://github.com/The-poem-of-destiny/workshop/pull/109) 进一步收敛自动发布与人工审核威胁边界：仅数据外带／动态代码执行风险（`M1–M4`）、工坊隔离公约违规（`L1–L7`）及检查未完成项（`FILE`、`CHECKER-LIMIT`、`CHECKER-INTERNAL`）阻断转人工审核，卸载可恢复的语法／死循环／外链提示保持 `warn` 自动发布并透明披露；详见[上线前加固记录](../../../.agents/notes/implemented/pre-launch-hardening-oauth-bridge-and-cdn.md)。
- **跨站内嵌登录、TavernHelper 宿主桥接与双桶客户端分发**：[PR #107](https://github.com/The-poem-of-destiny/workshop/pull/107) 与 [PR #109](https://github.com/The-poem-of-destiny/workshop/pull/109) 落地双桶 R2 CDN 客户端分发（先写私有桶与公开 CDN 桶的版本化 `immutable` 对象及 300s 频道对象，再以 `json_set` 原子更新 `site_settings.client_channels`）、CHIPS 分区环境下的跨站嵌入 OAuth 启动绑定（`/api/v1/auth/flows/:id/launch` + `POST /api/v1/auth/flows/:id/bind` + `cw_oauth_binding_p` `Partitioned` cookie）以及兼容 TavernHelper 同源子 iframe 的宿主桥接校验（`isTrustedHostSource`）。
- **五分类体系、`[工坊]` 标记与两阶段预装载／增量迁移工具**：[PR #89](https://github.com/The-poem-of-destiny/workshop/pull/89) 四普通标签展示上限、[PR #90](https://github.com/The-poem-of-destiny/workshop/pull/90) 结构化分类与离线审阅对账工具、[PR #104](https://github.com/The-poem-of-destiny/workshop/pull/104) 98 对象基线收口与绑定目标库 `preload`／停写增量 `delta` 工具、[PR #107](https://github.com/The-poem-of-destiny/workshop/pull/107) **五分类收敛**（`系统核心`、`角色`、`内容扩展`、`规则扩展`、`体验优化`）、[PR #108](https://github.com/The-poem-of-destiny/workshop/pull/108) `[工坊]` 世界书与注册表标记（兼容读取历史 `[WS]`）及 [PR #109](https://github.com/The-poem-of-destiny/workshop/pull/109) 的 FTS `char(0)` 净化与备份校验加固均已合入。
- **社区政策准入、合集、个人备忘与界面精修**：[PR #91](https://github.com/The-poem-of-destiny/workshop/pull/91) 完整发现批次与手动推荐阅读、[PR #93](https://github.com/The-poem-of-destiny/workshop/pull/93) 当前订阅玩家推荐资格、[PR #94](https://github.com/The-poem-of-destiny/workshop/pull/94) 个人版本体验备忘（无版本历史旧备忘只读保留）、[PR #95](https://github.com/The-poem-of-destiny/workshop/pull/95)／[PR #107](https://github.com/The-poem-of-destiny/workshop/pull/107) 低调 Discord 社区引导、使用政策 3 题单选准入、合集与作者展示页、2K／带鱼屏弹性卡片网格以及 [PR #105](https://github.com/The-poem-of-destiny/workshop/pull/105) `503 quota_exceeded` 配额耗尽倒计时提示均已合入并部署至 `staging`。详见[社区准入、合集与体验精修记录](../../../.agents/notes/implemented/community-access-collections-and-ux-refinement.md)、[版本备忘与推荐记录](../../../.agents/notes/implemented/version-experience-notes-and-recommendations.md)与[视觉方向记录](../../../.agents/notes/implemented/new-ui-visual-direction.md)。经典界面迁移与双前端开关继续暂缓。

## 证据与边界

| 层次 | 已有证据 | 不能推导的结论 |
| --- | --- | --- |
| `main` 全链路门禁与 CI | `d7deb9d`（PR #109）通过 `pnpm check`（含严格 Knip、架构／数据边界、Biome 零警告、全包类型与单测、98 对象 schema 检查、7 套 Python 迁移与 `delta` 测试、备份校验、bundle 预算）、`pnpm e2e:local` 与 `secrets` 门禁 | 本地与 CI 测试不替代真实 Discord 账号准入、真实 SillyTavern 宿主环境或生产线上流量 |
| `staging` 滚动自动发布 | `d7deb9d` 的 `deploy-staging` 工作流跑通 98/98 schema 只读核验、Worker 部署、双桶客户端发布、HTTP smoke 及 `staging-evidence` 归档；`workshop-staging-migrate-977ebb415bf6` 含 593 版本与 585 条 FTS 记录 | 不代表已完成真实 SillyTavern 内嵌跨站 OAuth／安装人工验收，也不代表 `production` Worker 已发布 |
| `production` 预装载状态 | `workshop-prod` D1 已完成 246/246 批对账导入 + 531 条 `public_cover_replicas` 并升级至五分类 98/98 schema（616 版本、607 条 FTS）；`workshop-client-prod`（1,272 对象）与 `workshop-img-prod`（531 封面）就绪 | 预装载不等于正式切换：旧站停写后的最终 `delta` 补齐（如有新写入）及 `v*` tag 受保护部署尚未执行 |
| 边缘缓存与限流 | 应用域按 [Cache API 设计](../../reference/cache-design.md) 采用分类 TTL、各 PoP 独立缓存；`staging` 已实测目录 60/10s 限流、R2 CDN 命中与撤回 `404 BYPASS` | 单 PoP 探针不构成全球即时失效承诺，亦未替代正式业务流量下的多日额度对账 |

## 当前待交付与发布门槛

- **真实宿主与 Discord 人工验收（可在 `staging` 立即执行）**：在真实 SillyTavern + TavernHelper 环境及真实 Discord 账号下核验跨站内嵌登录（`/flows/:id/launch` + `bind` + `Partitioned` cookie）、公会／身份组正反例、政策 3 题准入，以及世界书／正则安装、更新、卸载与旧身份转换，详见 [user-actions.md](user-actions.md)。
- **生产最终停写 `delta` 与 `v*` tag 受保护切换（待上线授权）**：获正式切换授权后，对旧系统停写并检查快照后是否存在增量写入（按需执行 `d1_delta.py` 与 `delta-withdrawals.json`），创建受保护 `v*` tag 将 `staging` 已验收的精确产物提升至 `production`，合并角色卡仓库 PR #48／#49 并切换旧入口跳转。见[发布手册](../../operations/deployment-safety.md#release-decision-and-artifact)。
- **上线后边缘实耗与限流观察**：在真实流量下核验 Workers／D1／R2 额度表现与 WAF 阈值，确认生产 `workers.dev` 与 `preview_urls` 关闭生效，详见 [edge-cache-rollout.md](edge-cache-rollout.md#4-workersd1r2-实耗验收)。

当前可执行与人工验收边界见 [Checklist](checklist.md) 和 [用户事项](user-actions.md)。只读 legacy 结构参考固定为 `worktrees/workshop-legacy` 的 `15303df5e3b30aa7f3fc924296ae57497a7ad09a`；2026 年 10 月早期阶段性验证记录见 [`../../archived/refactor-2026-10/`](../../archived/refactor-2026-10/README.md)。

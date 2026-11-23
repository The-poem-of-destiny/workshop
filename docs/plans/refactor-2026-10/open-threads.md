# 上线前重构：待核对与收口清单

这是选下一块工作的入口，不是排期，也不是上线授权。按主题选一组即可；只有真实依赖用「依赖」标出。未勾选表示问题仍需真实环境验收或上线切流，**不代表源码尚未实现**。现行合同见[参考文档](../../reference/worker-api.md)，已采纳决定见[决策记录](decisions.md)，交付与上线门槛仍归 [Checklist](checklist.md) 和[用户事项](user-actions.md)。

每条有固定 ID。核对后注明结果：**保留并补齐／重做／移除／明确暂缓**，链接决定、实现或验收证据；已另有清单的细项只链接，不重复打勾。

## API 与业务行为

- [x] **API-01 · 按消费者收口接口。** 发现栏和迁移验收统一读 `/home` 的 `discovery`，移除独立 `/projects/discovery`；列表与批查保留。`/api/v1/client/version` 用于发版核对 D1 频道记录和构建清单，ST 启动仍读 `/client/compatibility`。旧 `/test-dist/CreativeWorkshop/index.js` 保留给仓外已有导入，不恢复旧 API。已合入并在 `staging`（`d7deb9d`）部署验收；待随首次 `v*` tag 提升至 `production`。见 [API 参考](../../reference/worker-api.md)、[发版验收](../../operations/deployment-safety.md#smoke-assertions)。
- [x] **API-02 · 公开读取只解析一次。** [网关](../../../apps/worker/src/cache/public-cache.ts)生成公开读取描述，经 [data client](../../../apps/worker/src/data-client.ts)交给[投影](../../../apps/worker/src/data/public-projections.ts)。保留既有缓存键、TTL、HEAD 及条件响应。已合入并在 `staging`（`d7deb9d`）部署验收；待随首次 `v*` tag 提升至 `production`。
- [x] **API-03 · 下载与安装重试绑定原发布版。** 原版仍可取时重试不重复计数；原版不可取时返回 409，不自动切换新版。见[合同](../../reference/worker-api.md#发现项目和下载)与[本地 HTTP 回归](../../../apps/worker/test/read-path.test.ts)。已合入并在 `staging`（`d7deb9d`）部署验收；待随首次 `v*` tag 提升至 `production`。
- [x] **API-04 · 整单替换合集。** 资格、容量检查与关系替换在同一个 D1 batch。见[实现](../../../apps/worker/src/storage/collections.ts)与[回归](../../../apps/worker/test/policy-and-collections.test.ts)。已合入并在 `staging`（`d7deb9d`）部署验收；待随首次 `v*` tag 提升至 `production`。
- [x] **API-05 · 浏览与安装门禁分离。** 版本不符、频道未发布或探测失败仍可浏览；未确认兼容时拒绝宿主写入，同时兼容 TavernHelper 同源子 iframe 桥接（`isTrustedHostSource`）。见[宿主协议](../../reference/host-protocol.md)与[上线前加固记录](../../../.agents/notes/implemented/pre-launch-hardening-oauth-bridge-and-cdn.md)。已合入并在 `staging`（`d7deb9d`）部署验收；待随首次 `v*` tag 提升至 `production`，真实 SillyTavern 宿主验收归 REL-04。

## 日常发布与数据切换

- [x] **REL-01 · 验收滚动 staging 发版。** 已在 `d7deb9d`（PR #109）跑通 GitHub Actions `deploy-staging` 端到端验收：`.github/scripts/verify-release-schema.py staging` 只读核验线上 D1 98/98 个 canonical schema 对象、部署 `workshop-staging`、向 `workshop-client-staging` 与 `workshop-img-staging` 双桶发布客户端并原子更新 `client_channels`、完成 HTTP smoke 并产出 90 天 `staging-evidence` 凭证。见[发布手册](../../operations/deployment-safety.md#routes)。
- [x] **REL-02 · 保留运维控制，只停写、不停纯读。** 既有 `close/open/status` 协议不变；纯读不经过协调器，响应流不计入排空，可能写入的请求及后台任务受控，迁移 CLI 用独立状态请求核验排空。见[维护屏障](../../operations/deployment-safety.md#maintenance-barrier)。已合入并在 `staging`（`d7deb9d`）部署验收；待随首次 `v*` tag 提升至 `production`。
- [ ] **REL-03 · 实际执行首次 production 切换。** [production workflow](../../../.github/workflows/deploy-production.yml) 已接通受保护的 `v*` tag 提升（只用 `staging` 验收通过的同一产物）。`workshop-prod` D1（246/246 批 + 531 条公开封面副本，五分类 98/98 schema，616 版本）、`workshop-client-prod`（1,272 对象）、`workshop-img-prod`（531 封面）与 `workshop-backups-prod` 已完成预装载；剩余旧站停写后的最终 `delta` 补齐（如有新写入）及受保护 `v*` tag 审批切流待上线授权后执行。见[切换与恢复](../../operations/deployment-safety.md#schema-evolution-and-production-cutover)。
- [ ] **REL-04 · 收口实际切换与真实旅程证据。** `staging`（`d7deb9d`）已在线就绪，待用真实 Discord 与真实 SillyTavern + TavernHelper 完成跨站内嵌登录、准入与安装／更新／卸载产品验收，并在获批后完成 `production` 最终切流。具体人工步骤统一由[用户事项](user-actions.md#2-必须保留的真实环境门槛)跟踪。

## 边缘读取、公开资源与成本

- [ ] **EDGE-01 · 可撤回公开图片与公开客户端的 R2 CDN 分发验收。** 见 [D-51](decisions.md#d-51-普通公开封面可短暂陈旧)、[D-52](decisions.md#d-52-公开图片桶覆盖封面画廊和横幅) 与 [D-53](decisions.md#d-53-上线前架构收敛与条款替代汇总)。三类公开图片副本表已并入 98 对象基线 `0001_initial.sql`，现行公开桶为 `workshop-img-staging`（`assets-staging.poem-of-destiny.3378469.xyz`）与 `workshop-img-prod`（`assets.poem-of-destiny.3378469.xyz`，已预装载 531 张封面；早期试点桶 `workshop-covers-*` 已删除），同时镜像版本化与频道客户端 bundle。`staging` 已实测命中、自然到期与下架 `404 BYPASS`；待完成 `staging` 真实作者并发／画廊／横幅线上操作核验及 `production` 切流后线上验证。
- [ ] **EDGE-02 · 验证封面 CPU 与目录实耗改善。** 公开封面迁至 `workshop-img-*` CDN 直出及目录 FTS 先行优化已部署至 `staging`（`d7deb9d`）；待在真实浏览负载与 `production` 切流后对照冷／暖读、Worker CPU、D1 `rows_read` 与 R2 Class A/B 实耗。入口：[实耗计划及目录测量](edge-cache-rollout.md#4-workersd1r2-实耗验收)、[现行入口](../../../apps/worker/src/index.ts)。
- [ ] **EDGE-03 · 根据真实流量收紧防刷并补边缘验收。** 两应用自定义域的宽松限流（60 请求／10 秒）已上线并实测，见[规则和证据](edge-cache-rollout.md#2-waf-与速率限制)。`wrangler.jsonc` 已为 `production` 配置 `workers_dev: false, preview_urls: false`；首次 `v*` 生产部署后须实测替代入口已关闭，并结合真实流量峰值、共享 IP 与 429 观测评估后续阈值。其他边缘验收见[计划](edge-cache-rollout.md)。

日常发布、产品 API、资源分发都可以单独推进。遇到必须一起改的契约，先记住影响面，再在同一切片内改完调用方和验证；不为保持旧实现形状而规定额外过渡阶段。

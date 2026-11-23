# 上线前重构：待核对与收口清单

这是选下一块工作的入口，不是排期，也不是上线授权。按主题选一组即可；只有真实依赖用「依赖」标出。未勾选表示问题仍需判断、实现或验收，**不代表已经认定是缺陷**。现行合同见[参考文档](../../reference/worker-api.md)，已采纳决定见[决策记录](decisions.md)，交付与上线门槛仍归 [Checklist](checklist.md) 和[用户事项](user-actions.md)。

每条有固定 ID。核对后注明结果：**保留并补齐／重做／移除／明确暂缓**，链接决定、实现或验收证据；已另有清单的细项只链接，不重复打勾。找不到仓内调用方时，先查原意、目标使用者、未完成的接入和外部契约，再判断价值。已有调用也不代表现有形态值得保留。

## API 与业务行为

- [x] **API-01 · 按消费者收口接口。** 发现栏和迁移验收统一读 `/home` 的 `discovery`，移除独立 `/projects/discovery`；列表与批查保留。`/api/v1/client/version` 用于 staging 发版核对 D1 频道记录和构建清单，ST 启动仍读 `/client/compatibility`。旧 `/test-dist/CreativeWorkshop/index.js` 保留给仓外已有导入，不恢复旧 API。Worker 30 项、类型检查及本地 release smoke 判定通过；应用和工作流未部署。见 [API 参考](../../reference/worker-api.md)、[发版验收](../../operations/deployment-safety.md#smoke-assertions)。
- [x] **API-02 · 公开读取只解析一次。** [网关](../../../apps/worker/src/cache/public-cache.ts)生成公开读取描述，经 [data client](../../../apps/worker/src/data-client.ts)交给[投影](../../../apps/worker/src/data/public-projections.ts)。保留既有缓存键、TTL、HEAD 及条件响应。数据边界、Worker 类型、读路径 24 项和完整本地浏览器 E2E 25 项通过；未部署。
- [x] **API-03 · 下载与安装重试绑定原发布版。** 原版仍可取时重试不重复计数；原版不可取时返回 409，不自动切换新版。见[合同](../../reference/worker-api.md#发现项目和下载)与[本地 HTTP 回归](../../../apps/worker/test/read-path.test.ts)。未部署。
- [x] **API-04 · 整单替换合集。** 资格、容量检查与关系替换在同一个 D1 batch。Workerd 本地 6 项通过，其中 4 项覆盖目标删除、404 优先、并发替换和容量抢占。见[实现](../../../apps/worker/src/storage/collections.ts)与[回归](../../../apps/worker/test/policy-and-collections.test.ts)。未部署。
- [x] **API-05 · 浏览与安装门禁分离。** 版本不符、频道未发布或探测失败仍可浏览；未确认兼容时拒绝宿主写入。旧桥接缺少状态时不开放写入。Worker 30 项通过，Tavern 客户端类型与构建、Web 构建及两侧本地 Chromium 验证通过。见[宿主协议](../../reference/host-protocol.md)；未部署，真实 SillyTavern 验收仍归 REL-04。

## 日常发布与数据切换

- [ ] **REL-01 · 验收滚动 staging 发版。** 本地工作流已改为当前 `main` 通过 CI 后按应用变化发版，实查目标 D1，不重写密钥；过期或不完整的发布不当作已验收基线。尚未提交或在 GitHub／Cloudflare 跑通新工作流。见[发布手册](../../operations/deployment-safety.md#routes)。
- [x] **REL-02 · 保留运维控制，只停写、不停纯读。** 既有 `close/open/status` 协议不变；已确认纯读不经过协调器，响应流不计入排空，可能写入的请求及后台任务仍受控。迁移 CLI 用独立状态请求核验排空，外部写入方仍须单独停止。维护测试 14 项、目录测试 13 项、迁移 CLI 测试 26 项通过。见[维护屏障](../../operations/deployment-safety.md#maintenance-barrier)。本地验收，未部署。
- [ ] **REL-03 · 实际执行首次 production 切换。** [production workflow](../../../.github/workflows/deploy-production.yml) 本地已接通受保护的 tag 提升，只用 staging 实际验收的同一产物。真实生产授权、配置、目标数据和恢复点仍未验收，不以完整恢复演练或独立全量对账阻塞。见[切换与恢复](../../operations/deployment-safety.md#schema-evolution-and-production-cutover)。
- [ ] **REL-04 · 收口实际切换与真实旅程证据。** 明确当前 staging 快照／候选与 production 首次切换各自要求，用真实 Discord 和真实 ST 完成产品验收。已有授权、账号、宿主和真实数据步骤仅由[用户事项](user-actions.md#2-必须保留的真实环境门槛)跟踪；不把本地模拟、旧版演练或 CI 当成这些门槛已经通过。

## 边缘读取、公开资源与成本

- [ ] **EDGE-01 · 定义可撤回图片的 R2 分发。** 方向是独立公开副本和 CDN，不公开私有桶；现有[长期不可变 R2 试点](edge-cache-rollout.md#3-r2-cdn200负缓存和防盗链)不包含可撤回封面，不能套用它的长 TTL。先明确发布／下架期间副本和引用的状态，验收删除公开副本后清精确 URL、过期不返回旧图、私有资源不泄露。已下载或浏览器已缓存的副本不可召回。**依赖：**新分发与撤回已实测、消费者已切换后，再决定移除旧 Worker 路由。
  - **已决定并验证 staging CDN：**允许普通封面短暂陈旧，见 [D-51](decisions.md#d-51-普通公开封面可短暂陈旧)。[60 秒探针](edge-cache-rollout.md#普通公开封面独立撤回试验)在 NRT 实测命中、自然到期与精确 purge；未切换业务消费者或修改 production。
  - **实现验收：**复制必须绑定发布代际，撤回须先处理可能晚到的复制，避免删后复活。分别记录源端已删、purge 已接受、抽样 PoP 已验证；不得将任一证据当作全球时限。旧不可变试点不能提供这条路径的验收证据。
- [ ] **EDGE-02 · 验证封面 CPU 实际改善。** staging 有精确请求证据把 `exceededCpu` 定位到封面 GET，不是搜索 API；本地移除逐块转发不等于线上改善。若先上线流转发修正，或直接切新版分发，都在相同视口与操作下复测冷／暖、并发、错误率、Worker CPU 和 R2 源读。与目录 SQL 的改善分开归因。入口：[实耗计划及目录测量](edge-cache-rollout.md#4-workersd1r2-实耗验收)、[现行入口](../../../apps/worker/src/index.ts)。
- [ ] **EDGE-03 · 根据真实流量收紧防刷并补边缘验收。** 两应用自定义域的宽松限流已上线并实测，见[规则和证据](edge-cache-rollout.md#2-waf-与速率限制)。上线后先看正常峰值、共享 IP、客户端重试和 429，再定阈值；不要用合成压测或单个机房替代实际流量。首次 production 业务上线前核对正式客户端 origin、关闭可绕过 WAF 的替代入口并复测。其他边缘验收见[计划](edge-cache-rollout.md)。

日常发布、产品 API、资源分发都可以单独推进。遇到必须一起改的契约，先记住影响面，再在同一切片内改完调用方和验证；不为保持旧实现形状而规定额外过渡阶段。

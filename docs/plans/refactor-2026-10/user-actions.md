# 需要用户提供或人工验收的事项

更新：2026-11-23。源码核对基线为 `origin/main` 的 `d7deb9d`（含版本备忘 #94、当前订阅推荐资格 #93、政策准入与合集 #95、两阶段预装载／增量工具 #104、五分类 `规则扩展` 与双桶客户端分发 #107、`[工坊]` 标记 #108 及全仓上线前加固 #109）；合并、CI、`staging` 滚动发版与 `production` 预装载状态见 [state.md](state.md)。本页只列真实账号／宿主验收与最终生产切流必须人工参与的门槛。

**当前远端进度摘要：**
- **`staging` 已在 `d7deb9d` 在线就绪**：`https://workshop-staging.poem-of-destiny.3378469.xyz` 与 `https://assets-staging.poem-of-destiny.3378469.xyz` 已通过 `deploy-staging` 全链部署并完成双桶客户端发布、98/98 schema 核验及 HTTP smoke。下方第 3 节的真实 Discord 与真实 SillyTavern 旅程 `A`／`B`／`C` **现可直接在 `staging` 执行验收**。
- **`production` 预装载已完成，待上线切流授权**：`workshop-prod` D1（246/246 批全量对账 + 531 条公开封面副本，五分类 98/98 schema，616 版本）、`workshop-client-prod`（1,272 对象）、`workshop-img-prod`（531 封面）与 `workshop-backups-prod` 已全部就绪；仅剩旧站停写 + 最终增量 `delta`（若快照后旧站有新写入）+ 受保护 `v*` tag 审批部署 + 角色卡仓库 PR #48／#49 合并 + 旧站跳转待正式上线时执行。

## 1. 凭据与环境：发布前按目标环境核对

变量定义和安全默认值以[运行配置](../../reference/runtime-configuration.md)为准，操作流程以[部署安全规则](../../operations/deployment-safety.md)为准。

| 需要什么 | 用途与边界 |
| --- | --- |
| Discord Application、`DISCORD_CLIENT_ID`／`DISCORD_CLIENT_SECRET`、回调 URI | OAuth 授权与回调；每个实际公开 origin（`staging` 与 `production`）单独登记回调 `/api/v1/auth/callback` |
| `DISCORD_ALLOWED_GUILD_IDS`、`DISCORD_GUILD_ROLE_IDS` | 公会／身份组准入；准备满足条件的正例账号及不满足任一允许路径的拒绝账号 |
| `PUBLIC_ORIGIN`、`ALLOWED_ORIGINS`、`PUBLIC_ASSETS_BASE_URL`、`SESSION_HASH_SECRET`、`MAINTENANCE_TOKEN` | 请求、CDN 资源、会话与维护屏障边界；`production` 独立使用专用密钥，不复用 `staging` |
| GitHub `production` 环境审批与专用 CI 凭据 | 仅在获授权的 `v*` tag 提升时审批放行；不得复制本机 `.env` 或个人 token 到 CI |
| 旧站停写窗口、快照后增量核查与 D1 Time Travel／R2 恢复点 | 正式切换前提；切流前确认是否需要运行 `d1_delta.py` 同步快照后的新增写入 |

凭据、Cookie、token、OAuth code 不得写入仓库、测试、提交信息或聊天。本地 `preview:debug` 使用隔离的合成账号和短期会话，不替代真实 Discord OAuth／公会／身份组或跨站浏览器分区环境验收。

## 2. 必须保留的真实环境门槛

| ID | 旅程 | 已有证据与尚缺证据 |
| --- | --- | --- |
| M-01 | Discord 登录：普通浏览器、SillyTavern 跨站内嵌弹窗（`launch/bind` + `Partitioned` cookie）、设备码、刷新与退出 | 本地／workerd 已覆盖 `/flows/:id/launch`、`POST /flows/:id/bind`、`cw_oauth_binding_p` 分区 cookie 与错误回传；需在 `staging` 用真实 Discord 账号及真实跨站嵌入酒馆环境验收完整往返 |
| M-02／M-07 | 公会／身份组准入正例、拒绝路径与低调社区引导 | 代码级边界与回调邀请卡片已覆盖；需用真实账号验证允许路径及不满足任一路径时的拒绝提示与社区链接引导 |
| M-03 | 真实 SillyTavern + TavernHelper 连接与安装世界书／正则 | 已实现兼容 TavernHelper 同源子 iframe 的 `isTrustedHostSource` 桥接校验（`event.source.parent === window.parent`）及 `[工坊]` 标记；需在真实 ST 环境验证桥接握手与实际写入 |
| M-04 | 真实 ST 更新、卸载、旧 `[WS]`／旧身份转换和失败后重扫 | 核心实例扫描、整体预览／确认与玩家改动保护已实现；仍须真实宿主确认实际保存、角色边界及部分写入提示 |
| M-05 | 生产停写与快照后增量 `delta` 同步（如适用） | `workshop-prod` D1/R2 初始五分类 98/98 预装载已完成；正式切流时须对旧站停写，若快照后有新写入则运行 `d1_delta.py` 与 `delta-withdrawals.json` 补齐并复核 |
| M-06 | 生产首次 `v*` tag 切换与外围联动 | 须另行授权创建 `v*` tag 并在 GitHub 审批提升 `staging` 已验收产物，核验精确部署版本、合并角色卡仓库 PR #48／#49 并切换旧站跳转 |
| M-08 | 目标环境 Cache API、R2 CDN 与真实流量防刷／实耗验收 | `staging` 已完成单 PoP 探针与限流实测；上线后按[缓存设计](../../reference/cache-design.md)和[边缘上线计划](edge-cache-rollout.md)核验真实流量指标与生产替代入口关闭状态 |

## 3. 真实账号与宿主验收清单（现可在 `staging` 执行）

先确认目标环境为 `staging`（`https://workshop-staging.poem-of-destiny.3378469.xyz`，客户端频道 `staging`），再使用专门测试角色及新建合成项目；不要修改导入的真实作品或覆盖日常游玩角色。

### A. 页面、跨站嵌入登录与准入

- [ ] 桌面（含 1080p／2K／宽屏）与手机检查全宽聚光灯发现舞台、五分类单选与「含包含内容」多选 AND 筛选、分组标签、搜索、排序、合集与作者展示页、详情阅读、返回焦点与无横向溢出。
- [ ] 普通浏览器完成 Discord 授权、刷新、退出，再尝试需登录操作；没有授权循环或退出后继续写入。
- [ ] **在真实跨站 SillyTavern 嵌入 iframe 内验证弹窗／嵌入登录与设备码兜底**：不依赖顶层普通浏览器已有会话，确认弹窗经 `/api/v1/auth/flows/:id/launch` 与 `POST /api/v1/auth/flows/:id/bind` 正常写入顶层绑定 cookie、完成 Discord 回调并结合 iframe 侧 `cw_oauth_binding_p`（`SameSite=None; Secure; Partitioned`）成功兑换会话。
- [ ] 用满足指定允许公会／身份组的账号验证正例；用不满足任一允许路径的账号验证拒绝提示及低调 Discord 社区服务器邀请卡片展示。
- [ ] 验证新登录账号首次触发使用政策勾选与 **3 道单选题准入**：未通过前无法获取下载／预览／互动／创作权限；全对通过后立即解锁，切换账号后准入状态、订阅、个人版本备忘、本人推荐与合集互不串号。

### B. 作者、审核者与 owner

- [ ] 新建测试项目，上传世界书／正则／封面／画廊附图，检查本地浏览器 checker、统一冻结送审、「撤回审核并继续修改」一键回退及底部折叠防误删标题确认；确认保存后的新世界书条目带 `[工坊]` 前缀且冻结快照不可原地篡改。
- [ ] 在具备审核／owner 权限的测试账号下验证审核队列、完整内容与 diff、批准／拒绝理由、项目索引下架／恢复公开及站点社区邀请链接配置。

### C. 真实 SillyTavern + TavernHelper 安装／更新／卸载

先备份测试角色与世界书，加载 `staging` 渠道客户端脚本并确认服务地址指向 `staging`。操作边界见[宿主协议](../../reference/host-protocol.md)。

- [ ] **验证 TavernHelper 子 iframe 宿主桥接握手**：打开内嵌工坊面板后正常收到 `cw:context`（识别当前角色、可用世界书与已安装实例，不因 TavernHelper 运行在子 iframe 中而超时失联）。
- [ ] 选择目标安装实例并先预览、后确认，验证世界书条目与 `[工坊]创意工坊项目注册表` 实际写入且重开面板后可准确扫描识别。
- [ ] 手工修改一条已安装内容后升级新版本，检查整体更新 diff、取消零写入与确认整体替换（不静默覆盖玩家修改）。
- [ ] 卸载前检查完整实例预览与确认，确认无关世界书／正则及其他实例不受影响；用专门副本验证历史 `[WS]`／旧身份识别与一键转换、身份存疑不自动认领及其他角色正则明确标记未扫描。

### 反馈与证据边界

记录检查项、精确环境／版本、浏览器或 SillyTavern／TavernHelper 版本、非敏感准入条件、步骤与结果；不要发送任何凭据、token 或 cookie。

## 4. 正式生产切换清单（待 `staging` 人工验收通过并获上线授权后执行）

- [ ] 确认旧站停写时间窗，检查预装载快照之后旧站是否有新增写入；若有则运行离线审阅、生成并应用经自校验的 `d1_delta.py` 增量批次与 `delta-withdrawals.json` 公开图撤回，抽查关键计数与 R2 对象。
- [ ] 核对 `production` 专用 Discord OAuth 回调（`https://workshop.poem-of-destiny.3378469.xyz/api/v1/auth/callback`）、`SESSION_HASH_SECRET`、`MAINTENANCE_TOKEN`、CI 凭据及 `wrangler.jsonc` 中的 `workshop-prod` / `workshop-client-prod` / `workshop-img-prod` 绑定。
- [ ] 选定已在 `staging` 完成验收并保有有效 `staging-evidence` 的精确 `main` commit，创建 `v*` tag 并在 GitHub `production` 环境审批放行，按[部署安全手册](../../operations/deployment-safety.md)完成切流。
- [ ] 核验线上 Worker version、`stable` 客户端双桶产物与 D1 频道记录、98/98 schema、`workers.dev`／`preview_urls` 关闭状态（404）及核心读写冒烟；随后合并角色卡仓库 PR #48／#49 并切换旧站入口跳转。

## 5. 不属于当前人工阻塞的事项

- 版本体验备忘（#94）、当前订阅推荐资格（#93）、政策准入与合集（#95）、两阶段预装载／增量工具（#104）、五分类 `规则扩展` 与双桶客户端分发（#107）、`[工坊]` 标记（#108）及跨站 OAuth／TavernHelper 桥接／安全门禁加固（#109）均已合入 `main` 并在 `staging`（`d7deb9d`）部署就绪，不是待编码阻塞项。设计依据见 [`.agents/notes/implemented/`](../../../.agents/notes/README.md)。
- 经典界面迁移／双前端开关与每日抽签（Q-10）继续暂缓，不阻塞正式上线。

## 6. 已有证据，无需重复旧故障排障

当前 `main` 检查门禁、`d7deb9d` 的 `deploy-staging` 全绿记录以及 `staging`／`production` D1/R2 预装载证据统一见 [state.md](state.md#证据与边界)。历史 R2 S3 SigV4 上传、冒烟 `pipefail` 及早期试点桶清理均已收口，无需按早期故障重排权限。

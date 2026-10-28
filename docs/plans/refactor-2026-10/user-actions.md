# 需要用户提供或人工验收的事项

更新：2026-10-23（staging 已部署；production 未发布）

用途：集中列出需要用户参与的检查、预期结果与尚未实现的功能。**现在先做第 5 节的 staging 验收；第 6 节仅在准备生产发布时执行。** 部署记录见 [state.md 的发布记录](state.md#合并部署与客户端发布2026-10-22)，运维方法见 [deployment-safety.md](../../operations/deployment-safety.md)。

## 1. 凭据与环境

| ID | 需要什么 | 用途 | 设置位置 | 当前状态 |
|---|---|---|---|---|
| U-01 | Discord Application `client_id` | 生成 OAuth 授权 URL | Worker 变量 `DISCORD_CLIENT_ID` | staging 已配置 `1562466173268926575` |
| U-02 | Discord Application `client_secret` | 回调换取 Discord token | Worker secret `DISCORD_CLIENT_SECRET` | staging 已设置；production 未设置 |
| U-03 | 允许的 Discord Guild ID 列表 | 公会准入校验 | `DISCORD_ALLOWED_GUILD_IDS` | staging 已配置 `1417861565679669272,1134557553011998840` |
| U-04 | 允许的工坊 Origin 列表 | `/auth/flows` Origin 白名单 | `ALLOWED_ORIGINS` | staging 已配置 |
| U-05 | 生产迁移/切换授权 | 把当前重构版本部署到 production | 人工审批 / production environment | 发布流程、备份与回滚已设计；生产资源已存在；未授权执行迁移与切换 |
| U-06 | `CLOUDFLARE_ZONE_ID`、`WORKSHOP_PUBLIC_URL` | 发布新客户端后的指针缓存 purge | 发布脚本环境变量 | 当前 workers.dev 环境未配置，脚本跳过 purge；不据此宣称全球缓存已验证 |
| U-07 | GitHub Actions secret/variable | 让 staging/production workflow 真正运行 | GitHub repo settings | staging 已验证；production 尚未运行 |
| U-08 | 允许 `main` 部署到 staging 环境 | staging CI 的 deploy job 只允许 `main` | GitHub Environment `staging` branch policy | 已配置；本次最后验证的完整部署为 `39807450550`（commit `7b0719e`），全部成功 |
| U-09 | `SESSION_HASH_SECRET` | session token HMAC | Worker secret | staging 已设置；生产需设置 |
| U-10 | 生产发布使用的 `v*` tag | 允许 deploy-production 从 tag 进入 production environment | Git tag + GitHub Environment `production`（只允许 `v*`，1 名 reviewer） | 仅发布 production 时需要；当前无 tag，Actions 未运行 |
| U-11 | 指定 Guild 的允许身份组 ID | 登录时额外校验身份组 | `DISCORD_GUILD_ROLE_IDS` | staging 已配置：类脑 `1134557553011998840` 需要“已验证”身份组 `1335363403870502912`；鸽子窝 `1417861565679669272` 仍只校验公会 |
| U-12 | Discord OAuth2 Redirect URI | 授权后返回对应 Worker | Discord Developer Portal → Application → OAuth2 → Redirects | 需人工核对登记；代码只证明生成的地址，不能证明 Discord 后台已保存 |

注意：凭据不得写入仓库、文档、测试或提交信息；只通过 `wrangler secret put` 或 GitHub Secrets 设置。

`DISCORD_GUILD_ROLE_IDS` 格式为 `guildId:roleId[,roleId][;guildId:roleId...]`。只有列出的 Guild 需要身份组；同一 Guild 可配置多个允许身份组，用户命中任意一个即可。未列出的 Guild 仍只校验公会。配置身份组后，OAuth 会额外请求 `guilds.members.read`。

U-12 的完整回调地址：

- staging：`https://workshop-staging.poem-of-destiny.workers.dev/api/v1/auth/callback`
- production：`https://workshop.poem-of-destiny.workers.dev/api/v1/auth/callback`

可以共用一个 Discord Application 并登记两个 Redirect URI，也可以分别建立 Application；共用时两边使用同一 Client ID/Secret，但 Worker secret 必须按环境单独设置。`PUBLIC_ORIGIN`、`ALLOWED_ORIGINS`、公会/身份组准入和 `SESSION_HASH_SECRET` 也按环境配置；会话密钥应独立生成。production 当前 Client ID 和公会白名单仍为空，且尚未发布当前版本，不能只登记回调就视为生产登录可用。域名切换后需要同步修改这些 origin 和 Redirect URI。

本地 `pnpm preview:debug` 使用隔离数据库中的短期会话切换界面，不需要 Discord 回调，也不证明真实 OAuth 链路已通过。

## 2. 需要决策的事项

| ID | 问题 | 影响 | 不能自行选择的原因 |
|---|---|---|---|
| Q-10 | 每日抽签是否保留 | G5、W24、迁移范围 | 已暂缓（不阻塞当前开发）；入口收起，接口与表暂留，不迁移抽签数据 |

Q-05 已定：安装状态以本地世界书为准，订阅/下载/安装分离。见 `decisions.md` D-35。
Q-06 已定：审核台拉 pending，checking 只显示计数；响应一次返回 counts，使用 keyset cursor。见 `decisions.md` D-36。

## 3. 必须人工验收的旅程

这些不是“代码没写完”，而是必须有真实 Discord 账号、真实 SillyTavern 或生产授权才能证明。能自动化的部分已经用本地测试覆盖；没有真实输入时不会标记为已验收。

| ID | 旅程 | 前置条件 | 当前自动验证 |
|---|---|---|---|
| M-01 | Discord 登录：浏览器 / 嵌入 / 设备码 | U-01、U-02、U-03 已配置；需要一个真实 Discord 账号 | callback/redeem/device/state/TTL/guild 拒绝的本地负例已覆盖；真实授权尚未执行 |
| M-02 | 公会准入正例 | U-03 的真实 Guild ID + 测试账号 | 公会拒绝路径已覆盖；正例待真实账号 |
| M-07 | 身份组准入正例/负例 | U-11 的真实 Role ID + 测试账号 | 身份组命中/缺失/多 Guild 回退的本地负例已覆盖；真实账号待验收 |
| M-03 | SillyTavern 安装世界书 + 正则 | 运行中的 ST、许可、测试角色 | 客户端纯逻辑与 build 已测；真实 ST 未跑 |
| M-04 | 更新保留玩家改动、卸载、现有修复安装 | M-03 | 已实现路径待真实 ST 验收；逐条目选择 UI、独立修复中心与跨角色转移属于代码缺口，不作为人工验收前置条件 |
| M-05 | 真实数据迁移彩排 | 目标环境授权、必要时停写窗口 | 9 个真实备份项目已完成本地彩排与 staging 导入；不代表生产迁移已验收 |
| M-06 | 生产切换与回滚演练 | U-05、人工审批、停写窗口 | 生产未执行；备份可恢复性、迁移和回滚须作为发布门禁 |

## 4. C 类客户端缺口及原因

| Feature | 状态 | 原因 / 需要什么 |
|---|---|---|
| C2 首次使用免责声明 | ✅ 本轮已实现 | 首次打开显示说明，确认后才写入 `cw_agreement_accepted` |
| C3 自定义服务地址 | ✅ 本轮已实现 | 右下角设置按钮可修改 origin，保存到脚本变量；非法协议回退默认地址 |
| C8 选择性更新 | ◐ | 当前更新按条目 hash 保留玩家修改；逐条目选择 UI 尚缺，是代码工作，不能由人工验收代替 |
| C11 原版冲突 fail-closed | ◐ | 外部官方 baseline 的完整覆盖仍需单独核验；不以玩家修改保留或本地负例推定真实原版全部兼容 |
| C14 DLC 修复 | ◐ | 有“修复安装”重放入口；独立候选扫描／解析／重建中心尚缺 |
| C16 更新中心 | ❌ | 服务端待更新接口、负缓存与客户端 UI 尚缺，是代码工作 |
| C18 旧路径 shim | ✅ 已实现（保留窗口） | `/test-dist/CreativeWorkshop/index.js` 返回迁移提示并加载 `/client/stable/index.js`；旧 API 映射未做，窗口到期后删除 |
| C19 跨角色转移 | ❌ | 需要 ST 世界书/角色绑定 API；Q-05 已定，以本地条目状态为准 |
| C20 正则身份迁移 | ❌ | 依赖旧格式真实样本；当前只做新格式安装 |

## 5. 现在请检查：staging 验收

使用已部署的 staging 页面，不使用 production；地址从 GitHub `staging` environment 的 `STAGING_URL` 取得。用专门的测试角色和新建测试项目验证写入，不修改导入的真实项目，也不为测试覆盖现有角色数据。截图仅为历史内部证据，不需要你逐张签字。

### A. 页面与真实数据

- [ ] 桌面和手机打开列表，确认封面、中文标题、作者、标签、说明可读；无横向溢出、截断主要按钮或重叠。当前导入样例为 9 个项目；数量是本次样例证据，不是以后必须固定的值。
- [ ] 尝试搜索、筛选、排序、打开详情、关闭后重新打开另一项：结果与条件一致，没有上一项内容残留。
- [ ] 详情检查长说明、封面放大、Discord 链接和操作区；桌面／移动布局可用。用 Tab、Escape 操作，确认弹窗可关闭、焦点不丢失。

### B. 真实 Discord 登录与准入（M-01／M-02／M-07）

- [ ] 普通浏览器完成授权、返回工坊、刷新页面和退出；没有授权循环或退出后仍可执行需登录操作。
- [ ] 在 SillyTavern 嵌入界面验证提供的登录／设备码流程；返回后应显示正确账号，不依赖普通浏览器中碰巧已有的登录状态。
- [ ] 鸽子窝成员可登录；类脑成员有“已验证”身份组时可登录。拒绝用例必须使用不属于其他允许公会、且不满足任一准入路径的账号，预期明确拒绝。只缺类脑身份组、但属于鸽子窝的账号仍可能合法通过，不应误报。
- [ ] 如有两个可用账号，切换后点赞、订阅和作者内容属于当前账号，不显示上一账号的个人状态。

### C. 点赞、订阅与作者／审核流程

- [ ] 登录后在详情点赞／订阅，再取消并刷新：按钮和个人列表保持一致，加载中不能误操作。
- [ ] 用新建测试项目走保存草稿、上传、提交；提交后的快照不可编辑，可创建新版本。若有 reviewer／owner 账号，再验证审核通过／拒绝，以及作者看到的结果。
- [ ] 若可使用作者账号：修改公开展示说明／封面，确认公开详情随之更新，待审版本不被悄悄改写；未保存输入不因后台刷新丢失。没有对应角色时记录“未验收”，不要求临时授予生产权限。

### D. 真实 SillyTavern 安装／更新／卸载（M-03／M-04）

先备份测试角色的世界书与 Regex。使用 **staging 渠道脚本**并在客户端设置中确认服务地址为 staging，不能只换页面地址却仍使用 stable 渠道。角色绑定的世界书、脚本登记和实际条目是验收依据，订阅或下载不等于安装成功。

- [ ] 首次打开的免责声明可确认，工坊能打开，登录成功后安装一个测试项目；世界书和 Regex 实际写入当前测试角色，刷新或重新打开后仍在。
- [ ] 修改一条已安装内容，再安装已准备的新版本：未修改内容按新版本更新，玩家修改不被静默覆盖，详情扫描状态与实际内容一致。
- [ ] 卸载测试项目：项目安装的未修改内容移除，玩家修改按提示保留／确认处理，角色自身的无关条目和 Regex 不被删除。
- [ ] 在测试副本中制造缺失条目，验证现有“修复安装”入口及扫描提示；这不代表独立修复中心、跨角色转移或旧正则迁移已实现。

### 验收反馈怎么记

以上复选框默认未勾选，CI 或本地 E2E 通过不能代替真实账号／ST 验收。反馈时写：检查项、浏览器或 ST 环境、账号所属公会／身份组（不含凭据）、操作步骤、预期／实际、可见错误。不要发送 token、Cookie 或授权码。无法准备新版本／审核角色等前置条件时，保留未验收，不勉强在真实项目上测试。

## 6. 仅生产发布前需要检查

- [ ] 核对 production 专用 OAuth／session secrets、回调、允许 Origin、公会／身份组规则，以及 GitHub production environment 的凭据；不得复制本机个人 token。
- [ ] 确认目标为 `workshop-prod` D1 和 `workshop-client-prod` R2，不是 staging；生产凭据的 S3 发布能力尚未在本次 staging 发布中得到证明。
- [ ] 按 [部署 runbook](../../operations/deployment-safety.md) 验证备份与恢复、迁移影响、停写安排和回滚条件，再授权生产切换。生产备份上传仍是 Wrangler REST 路径，不能用客户端 S3 上传成功代替该路径的权限验证。
- [ ] 选定已通过 CI／staging 的 main commit，明确同意发布后才创建受保护的 `v*` tag 并人工审批；不要为了检查凭据而创建发布 tag。
- [ ] 发布后核对精确 Worker 版本、客户端渠道 revision／实际 SHA、登录和关键旅程。Workers Cache production 保持关闭；若以后开启，需另做 hosted HIT、隔离／失效等验证，依据 D-38，不再要求接受已被取代的 D-37。

## 7. 不应交给你“验收通过”的未实现项

逐条选择更新 UI、独立 DLC 修复中心、更新中心、跨角色转移、旧正则身份迁移仍是部分／未实现功能（见第 4 节和 [features.md](features.md)），不是缺少你勾选就能完成。每日抽签继续暂缓。需要代码工作的缺口不能算作用户阻塞。

## 8. 已有证据，不需要你重复排障

| 证据 | 本次记录 |
|---|---|
| staging 完整部署 | [run 39807450550](https://github.com/The-poem-of-destiny/workshop/actions/runs/39807450550)，commit `7b0719e`；build／migration／Worker／客户端发布／smoke 全通过 |
| staging Worker | 本次部署记录版本 `3e3f7d8b-995d-4d32-89a2-bb0d7174aff0`，不是实时查询结果 |
| staging 客户端 | `/client/staging/index.js` 与 `/api/v1/client/version?channel=staging` 的 revision／实际 SHA 已比对一致 |
| R2 发布故障 | 已改用 S3 SigV4 并由 CI 成功发布；不需要为此前 REST 403 再扩大权限或更换 secret |
| 本地运行路径 | Worker 85/85、完整检查与本地 E2E 21/21；不代替上述真实 Discord／ST 人工验收 |

这份文档更新本身不创建 commit／PR、不触发部署；后续 staging 发布继续走 main CI，不从特性分支手动部署。

# 需要用户提供或人工验收的事项

更新：2026-10-22（本地验证；未部署 production）

用途：把“代码已经做到边界，但必须由用户提供凭据、决策或真实环境”的事项集中列出。未完成项不伪装为已完成。

## 1. 凭据与环境

| ID | 需要什么 | 用途 | 设置位置 | 当前状态 |
|---|---|---|---|---|
| U-01 | Discord Application `client_id` | 生成 OAuth 授权 URL | Worker 变量 `DISCORD_CLIENT_ID` | staging 已配置 `1562466173268926575` |
| U-02 | Discord Application `client_secret` | 回调换取 Discord token | Worker secret `DISCORD_CLIENT_SECRET` | staging 已设置；production 未设置 |
| U-03 | 允许的 Discord Guild ID 列表 | 公会准入校验 | `DISCORD_ALLOWED_GUILD_IDS` | staging 已配置 `1417861565679669272,1134557553011998840` |
| U-04 | 允许的工坊 Origin 列表 | `/auth/flows` Origin 白名单 | `ALLOWED_ORIGINS` | staging 已配置 |
| U-05 | 生产迁移/切换授权 | 把当前重构版本部署到 production | 人工审批 / production environment | 发布流程、备份与回滚已设计；生产资源已存在；未授权执行迁移与切换 |
| U-06 | `CLOUDFLARE_ZONE_ID`、`WORKSHOP_PUBLIC_URL` | 发布新客户端后立即刷新指针缓存 | 发布脚本环境变量 | 暂不配置；当前使用 workers.dev，跳过 purge，等待 CDN 约 300 秒过期 |
| U-07 | GitHub Actions secret/variable | 让 staging/production workflow 真正运行 | GitHub repo settings | staging 已验证；production 尚未运行 |
| U-08 | 允许 `main` 部署到 staging 环境 | staging CI 的 deploy job 只允许 `main` | GitHub Environment `staging` branch policy | ✅ 已配置；最新 `deploy-staging` 39619370797 成功（commit `9455c62`） |
| U-09 | `SESSION_HASH_SECRET` | session token HMAC | Worker secret | staging 已设置；生产需设置 |
| U-10 | 生产发布使用的 `v*` tag | 允许 deploy-production 从 tag 进入 production environment | Git tag + GitHub Environment `production`（只允许 `v*`，1 名 reviewer） | 仅发布 production 时需要；当前无 tag，Actions 未运行 |
| U-11 | 指定 Guild 的允许身份组 ID | 登录时额外校验身份组 | `DISCORD_GUILD_ROLE_IDS` | staging 已配置：类脑 `1134557553011998840` 需要“已验证”身份组 `1335363403870502912`；鸽子窝 `1417861565679669272` 仍只校验公会 |

注意：凭据不得写入仓库、文档、测试或提交信息；只通过 `wrangler secret put` 或 GitHub Secrets 设置。

`DISCORD_GUILD_ROLE_IDS` 格式为 `guildId:roleId[,roleId][;guildId:roleId...]`。只有列出的 Guild 需要身份组；同一 Guild 可配置多个允许身份组，用户命中任意一个即可。未列出的 Guild 仍只校验公会。配置身份组后，OAuth 会额外请求 `guilds.members.read`。

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
| M-04 | 更新保留玩家改动、卸载恢复、损坏修复、跨角色转移 | M-03 | 安装/更新保留修改、卸载保留世界书/正则修改已实现；修复/转移/选择性更新未完成；Q-05 已定 |
| M-05 | 真实数据迁移彩排 | U-05、停写窗口 | 本地 synthetic/SQL 转换与 R2 适配器已测；抽签数据暂不迁移 |
| M-06 | 生产切换与回滚演练 | U-05、人工审批、旧库只读窗口 | 仅本地演练；生产未执行 |

## 4. C 类客户端缺口及原因

| Feature | 状态 | 原因 / 需要什么 |
|---|---|---|
| C2 首次使用免责声明 | ✅ 本轮已实现 | 首次打开显示说明，确认后才写入 `cw_agreement_accepted` |
| C3 自定义服务地址 | ✅ 本轮已实现 | 右下角设置按钮可修改 origin，保存到脚本变量；非法协议回退默认地址 |
| C8 选择性更新 | ◐ | 当前更新按条目 hash 保留玩家修改，但没有逐条目选择 UI；需要真实 ST 交互与冲突 UX |
| C11 原版冲突 fail-closed | ◐ | 玩家修改会保留；官方同名/基线指纹冲突尚未 fail closed，依赖 baseline 数据 |
| C14 DLC 修复 | ❌ | 需要扫描/解析/重建候选；Q-05 已定，可按本地权威记录实现 |
| C16 更新中心 | ❌ | 依赖服务端“待更新”接口、6h 负缓存和真实 ST 环境 |
| C18 旧路径 shim | ✅ 已实现（保留窗口） | `/test-dist/CreativeWorkshop/index.js` 返回迁移提示并加载 `/client/stable/index.js`；旧 API 映射未做，窗口到期后删除 |
| C19 跨角色转移 | ❌ | 需要 ST 世界书/角色绑定 API；Q-05 已定，以本地条目状态为准 |
| C20 正则身份迁移 | ❌ | 依赖旧格式真实样本；当前只做新格式安装 |

## 5. 本轮新增人工验收

- 视觉签收：`docs/plans/refactor-2026-10/screenshots/` 下 7 张桌面/移动截图已生成，需你用真实数据确认版式、字体与颜色。
- 真实客户端：新的获取协议 `/api/v1/projects/:id/acquisitions` 已替代内联 `/install`；客户端已上报本地扫描状态（clean/localChanged/scanIncomplete），需在真实 ST 中确认安装票据、更新与卸载保留修改。
- 生产缓存：D-37 明确只保留公开投影 30 秒 Workers Cache；tag purge 与生产缓存实测仍未验收。

## 6. 我还需要你做什么

Discord staging 已配置完成，不需要再提供 Client ID、Client Secret、Guild ID 或 Role ID。

剩余需要你参与的输入：

1. 用真实 Discord 账号完成 M-01/M-02/M-07：
   - 鸽子窝账号应能登录；
   - 类脑账号有“已验证”身份组时应能登录；
   - 类脑账号没有“已验证”身份组时应被拒绝。
2. 提供一个可运行的 SillyTavern 实例与测试角色，完成 M-03/M-04。
3. 若要跑真实迁移：授权 production 迁移/切换，并提供停写窗口。
4. 暂不配置客户端缓存 purge；workers.dev 下跳过，等待指针缓存自然过期。
5. 若要发布 production：设置 production 的 `DISCORD_CLIENT_SECRET` 与 `SESSION_HASH_SECRET`，创建 `v*` tag 并走人工审批。
6. 确认是否接受 D-37 的缓存阶段；如果不接受，需要提供 staging zone/token 以完成 tag purge 实测。

staging 部署规则：`main` 的 `ci` 成功后自动触发 `deploy-staging`；后续部署继续走 `main`，不从特性分支手动部署。

### 已执行的 CI 证据

| Run | 结果 |
|---|---|
| `ci` 39619178757 | ✅ `main` 上 check + e2e 成功（commit `9455c62`） |
| `deploy-staging` 39619370797 | ✅ changes/build/deploy/smoke 成功（commit `9455c62`） |
| staging 当前版本 | ✅ Worker `d43d6b00-ac2d-4ffe-8c21-007edf69e01e`（commit `9455c62`） |
| staging OAuth | ✅ `client_id=1562466173268926575`；`scope=identify guilds guilds.members.read`；回调地址正确 |
| production 当前版本 | ⚠️ 活跃版本 `c6c81138-dbcf-48aa-b925-4f195e8ef85e`（2026-10-21 secret change；代码仍是旧版 `5d2edd06...`，不是当前重构版本） |
| 客户端 stable | ✅ 0.1.3；staging 的 `/client/stable/index.js` 可访问 |

没有这些输入时，代码侧仍可继续做不依赖凭据/决策的部分，但不会把上述旅程标记为已验收。

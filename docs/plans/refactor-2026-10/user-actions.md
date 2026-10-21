# 需要用户提供或人工验收的事项

更新：2026-10-21  
用途：把“代码已经做到边界，但必须由用户提供凭据、决策或真实环境”的事项集中列出。未完成项不伪装为已完成。

## 1. 凭据与环境

| ID | 需要什么 | 用途 | 设置位置 | 当前状态 |
|---|---|---|---|---|
| U-01 | Discord Application `client_id` | 生成 OAuth 授权 URL | Worker 变量 `DISCORD_CLIENT_ID` | staging 为空 |
| U-02 | Discord Application `client_secret` | 回调换取 Discord token | Worker secret `DISCORD_CLIENT_SECRET` | 未设置 |
| U-03 | 允许的 Discord Guild ID 列表 | 公会准入校验 | `DISCORD_ALLOWED_GUILD_IDS` | staging 为空；仅负例可测 |
| U-04 | 允许的工坊 Origin 列表 | `/auth/flows` Origin 白名单 | `ALLOWED_ORIGINS` | staging 已配置 |
| U-05 | 生产 Cloudflare 账号、D1、R2 目标 | 真实迁移与生产部署 | CI environment / wrangler env | 未授权 |
| U-06 | `CLOUDFLARE_ZONE_ID`、`CLOUDFLARE_API_TOKEN`、`WORKSHOP_PUBLIC_URL` | 客户端 channel 指针 purge | 发布脚本环境变量 | 未设置；当前 publish 会跳过 purge |
| U-09 | `SESSION_HASH_SECRET` | session token HMAC | Worker secret | staging 已设置；生产需设置 |
| U-07 | GitHub Actions secret/variable | 让 staging/production workflow 真正运行 | GitHub repo settings | 未验证 |
| U-08 | 允许 `refactor/2026-10` 部署到 staging 环境 | staging CI 的 deploy job 当前只允许 `main` | GitHub Environment `staging` branch policy | **阻塞**：run 39582600843 build 成功，deploy 被拒绝 |
| U-10 | 生产发布使用的 `v*` tag | 允许 deploy-production 的 workflow_dispatch 进入 production environment | Git tag + GitHub Environment `production`（只允许 `v*`，1 名 reviewer） | 无 `v*` tag；production Actions 尚未运行 |

注意：凭据不得写入仓库、文档、测试或提交信息；只通过 `wrangler secret put` 或 GitHub Secrets 设置。

## 2. 需要决策的事项

| ID | 问题 | 影响 | 不能自行选择的原因 |
|---|---|---|---|
| Q-05 | 安装状态权威记录：D1 行 / 条目内单一记录 / registry 降级为缓存 | C11/C12/C14/C19、W12 的扫描/修复/转移 | 三条路线对离线、换角色、损坏恢复的语义不同，属于技术决策 |
| Q-06 | 审核队列读取契约：稳定 cursor / 短期 snapshot | W11/W20 队列分页、W24 | 并发提交下的无遗漏/无重复语义不同 |
| Q-10 | 每日抽签是否保留 | G5、W24、迁移范围 | 产品决策；当前入口已收起，接口与表暂留 |

## 3. 必须人工验收的旅程

| ID | 旅程 | 前置条件 | 当前自动验证 |
|---|---|---|---|
| M-01 | Discord 登录：浏览器 / 嵌入 / 设备码 | U-01、U-02、U-03、可用 Discord 应用 | callback/redeem/device/state/TTL/guild 拒绝的本地负例已覆盖 |
| M-02 | 公会准入正例 | U-03 的真实 Guild ID + 测试账号 | 仅拒绝路径 |
| M-03 | SillyTavern 安装世界书 + 正则 | 运行中的 ST、许可、测试角色 | 客户端纯逻辑与 build 已测；真实 ST 未跑 |
| M-04 | 更新保留玩家改动、卸载恢复、损坏修复、跨角色转移 | M-03 + Q-05 | 安装/卸载核心逻辑已有；修复/转移/选择性更新未完成 |
| M-05 | 真实数据迁移彩排 | U-05、Q-10、停写窗口 | 本地 synthetic/SQL 转换与 R2 适配器已测 |
| M-06 | 生产切换与回滚演练 | U-05、人工审批、旧库只读窗口 | 仅本地演练；生产未执行 |

## 4. C 类客户端缺口及原因

| Feature | 状态 | 原因 / 需要什么 |
|---|---|---|
| C2 首次使用免责声明 | ✅ 本轮已实现 | 首次打开显示说明，确认后才写入 `cw_agreement_accepted` |
| C3 自定义服务地址 | ✅ 本轮已实现 | 右下角设置按钮可修改 origin，保存到脚本变量；非法协议回退默认地址 |
| C8 选择性更新 | ◐ | 当前更新按条目 hash 保留玩家修改，但没有逐条目选择 UI；需要真实 ST 交互与冲突 UX |
| C11 原版冲突 fail-closed | ◐ | 玩家修改会保留；官方同名/基线指纹冲突尚未 fail closed，依赖 baseline 数据与 Q-05 |
| C14 DLC 修复 | ❌ | 需要扫描/解析/重建候选，并确定权威安装状态（Q-05） |
| C16 更新中心 | ❌ | 依赖服务端“待更新”接口、6h 负缓存和真实 ST 环境 |
| C18 旧路径 shim | ❌ | D-33 要求保留一个周期；需要确定旧客户端下线日期，当前不伪造兼容层 |
| C19 跨角色转移 | ❌ | 需要 ST 世界书/角色绑定 API 与 Q-05 的权威状态 |
| C20 正则身份迁移 | ❌ | 依赖旧格式真实样本；当前只做新格式安装 |

## 5. 我需要你做什么

最小可继续验收的输入：

1. 在 staging 设置 `DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET`、`DISCORD_ALLOWED_GUILD_IDS`。
2. 提供一个允许公会内的测试 Discord 账号，完成 M-01/M-02。
3. 提供一个可运行的 SillyTavern 实例与测试角色，完成 M-03/M-04。
4. 对 Q-05、Q-06、Q-10 给出选择；未决前相应代码保持 BLOCKED。
5. 若要跑真实迁移：提供目标 Cloudflare 账号/D1/R2 与停写窗口授权。
6. 若要测 purge：提供 zone ID、API token 和公开 URL。
7. 若要跑 staging CI 的 deploy job：把 `refactor/2026-10` 加入 GitHub Environment `staging` 的 allowed branches，或将分支合入 `main`。当前环境只允许 `main`。

### 已执行的 CI 证据

| Run | 结果 |
|---|---|
| `refactor-ci` 39587965049 | ✅ check + e2e 成功（commit `8d645a2`） |
| `deploy-staging` 39582600843 | ◐ build 成功；deploy 因 environment branch policy 拒绝（`refactor/2026-10`，commit `740063b`） |
| `deploy-staging` 39466481870 | ✅ `main` 上最后一次成功部署（commit `4fdf71a`） |
| 本地 staging 部署 | ✅ Worker `7625ef0a-5ff6-4c19-9d6a-479ee44c47a1`（commit `e04e43a`），覆盖了此前 Actions 部署 |
| production 当前版本 | ⚠️ 旧 Worker `5d2edd06-ac64-43b4-95fc-954fbccb0683`（2026-10-20），不是当前重构版本 |
| 客户端 staging stable | ✅ 0.1.3 `5e1c4a4a...`，含免责声明/服务地址/基线 fail-closed |
| OAuth 浏览器绑定 | ✅ staging：无 cookie 404、带 cookie 200 |

没有这些输入时，代码侧仍可继续做不依赖凭据/决策的部分，但不会把上述旅程标记为已验收。

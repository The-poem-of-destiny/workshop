# Worker 运行配置参考

本文描述仓库中当前的 Worker 配置和代码行为，不代表远端实际部署状态。接口及认证流程见 [Worker API 参考](worker-api.md)；发布、迁移、回滚与操作授权见 [部署安全手册](../operations/deployment-safety.md)。配置权威为 [`wrangler.jsonc`](../../apps/worker/wrangler.jsonc)、[`Env`](../../apps/worker/src/env.ts) 及其使用代码。

## 环境与 bindings

| 配置 | 顶层默认 | staging | production |
|---|---|---|---|
| Worker 名称 | `workshop` | `workshop-staging` | `workshop` |
| `DB` D1 | `workshop-staging-migrate-977ebb415bf6` | `workshop-staging-migrate-977ebb415bf6` | `workshop-prod` |
| `R2` | `workshop-client-staging` | `workshop-client-staging` | `workshop-client-prod` |
| `PUBLIC_COVERS` R2 | 未声明 | `workshop-img-staging` | `workshop-img-prod` |
| `ALLOWED_ORIGINS` | `http://localhost:8787,http://127.0.0.1:8787` | `https://workshop-staging.poem-of-destiny.3378469.xyz` | `https://workshop.poem-of-destiny.3378469.xyz` |
| `PUBLIC_ORIGIN` | `http://localhost:8787` | `https://workshop-staging.poem-of-destiny.3378469.xyz` | `https://workshop.poem-of-destiny.3378469.xyz` |
| `PUBLIC_ASSETS_BASE_URL` | 未设置 | `https://assets-staging.poem-of-destiny.3378469.xyz` | `https://assets.poem-of-destiny.3378469.xyz` |
| `DISCORD_CLIENT_ID` | `1562466173268926575` | `1562466173268926575` | `1562466173268926575` |
| `DISCORD_ALLOWED_GUILD_IDS` | `1417861565679669272,1134557553011998840` | 同顶层 | 同顶层 |
| `DISCORD_GUILD_ROLE_IDS` | `1134557553011998840:1335363403870502912` | 同顶层 | 同顶层 |

`staging` 与 `production` 在 `wrangler.jsonc` 中均配置 `workers_dev: false`、`preview_urls: false`，仅通过各自应用自定义域访问；迁移控制 CLI 也使用受保护自定义域。两个应用自定义域共用同一条 Free zone 边缘速率限制规则：对 `/api/v1/home` 和 `/api/v1/projects`（含尾部 `/`，不区分方法与查询参数），按同一来源 IP、同一 Cloudflare 机房合并计数 **60 请求／10 秒**，超限返回边缘 429 并阻断 10 秒（两应用域共享计数，其他子域经 Custom Rule 跳过 `http_ratelimit`，不充当全局应用配额或鉴权；任何未关闭的绕过该 zone 的替代入口不受此规则覆盖）。上线与实测记录见[边缘上线计划](../plans/refactor-2026-10/edge-cache-rollout.md#2-waf-与速率限制)。

Tavern 客户端构建默认打开 `https://workshop.poem-of-destiny.3378469.xyz`。构建时可用 `CW_DEFAULT_ORIGIN` 覆盖默认值；用户已保存的 `cw_worker_origin` 设置继续优先，不会随新构建改写。

### 本体前端联调

只在本体开发配置使用这一对入口：

| 配置 | 值 |
| --- | --- |
| Workshop API origin | `https://workshop-staging.poem-of-destiny.3378469.xyz` |
| 客户端脚本 | `https://assets-staging.poem-of-destiny.3378469.xyz/client/staging/index.js` |

脚本使用 `staging` 频道，不用 `stable`。在独立的 SillyTavern 测试配置中确认已保存的 `cw_worker_origin` 也指向 staging。先检查目录 `GET /api/v1/projects?limit=1` 与脚本均返回 `200`；登录、订阅和安装使用测试账号及测试项目，不修改导入的真实作品。

顶层配置声明 `ASSETS` 静态资源绑定，目录为 `./web/dist`，`run_worker_first` 仅包含 `["/", "/index.html"]`（用于在配置有效 HTTPS `PUBLIC_ASSETS_BASE_URL` 时将对应公开资源源追加进 HTML 的 `Content-Security-Policy` `img-src`；`/assets/*` 带一年 `immutable` 与 `nosniff` 响应头，`/api/*` 与 `/client/*` 无静态文件命中故直接进入 Worker）；`CONTENT_SERVICE` 是 `ContentService` Durable Object，使用 SQLite 类迁移 `v1`；`WRITE_BARRIER` 是 `WriteBarrier` Durable Object，使用 SQLite 类迁移 `v2`，各环境均声明绑定。`PUBLIC_COVERS` 与 `PUBLIC_ASSETS_BASE_URL` 同时配置时启用公开封面、画廊与横幅的独立 R2 副本分发，未配置时回退至 Worker 受控资源路径。D1 迁移目录为 `./migrations`，定时触发为每分钟。具体环境的资源、部署配置和最终绑定应在授权部署时核实，不能仅凭表中仓库值推断线上状态。

## 变量、secret 与认证

- `ALLOWED_ORIGINS` 是逗号分隔、去除空白后的精确 origin 列表。API CORS 的预检对不允许的 origin 返回 403；创建 OAuth flow 与 `/bind` 也要求请求有匹配的 `Origin`。它不是通配符列表。
- `PUBLIC_ORIGIN` 用于生成 OAuth 回调地址 `<PUBLIC_ORIGIN>/api/v1/auth/callback`，末尾斜杠会移除；变量未定义时回退到请求 origin。应与 Discord 应用登记的回调地址及部署工作流校验的公开地址一致（GitHub `production` environment 的 `PRODUCTION_URL` 须等于 `<PUBLIC_ORIGIN>/`），完整 OAuth 登录还要求远端 `DISCORD_CLIENT_SECRET` 与已发布 Worker 配置匹配。
- `DISCORD_CLIENT_ID` 是 OAuth 应用 ID；`DISCORD_CLIENT_SECRET` 是服务端 secret，不写入 `vars` 或仓库。缺少 ID 时 flow 创建会返回本地 pending 地址而不是 Discord 授权地址；兑换授权码要求 ID 和 secret，缺失会失败。
- `DISCORD_ALLOWED_GUILD_IDS` 是逗号分隔的公会 ID；登录时必须至少属于其中一个，空列表会拒绝。`DISCORD_GUILD_ROLE_IDS` 格式为 `公会ID:角色ID,角色ID;公会ID:角色ID`，公会及角色 ID 必须为 17 至 20 位数字；同公会条目合并，满足任一指定角色即可。未列角色要求的允许公会只检查成员资格。空角色配置表示不要求角色；非空配置格式无效会在创建 flow 和兑换时失败。顶层、staging 与 production 中 `1417861565679669272` 只检查公会，`1134557553011998840` 要求角色 `1335363403870502912`。OAuth 固定请求 `identify`、`guilds`，配置角色要求时另请求 `guilds.members.read`。
- `SESSION_HASH_SECRET` 是会话令牌存储哈希的服务端 secret；存在时使用 HMAC-SHA-256，缺失时代码退回普通 SHA-256。配置或轮换 secret 会改变令牌哈希，已有会话可能失效，应事先安排重新登录。不要把缺省行为当作生产安全配置。
- `TURNSTILE_SITE_KEY`（公开变量，见 `wrangler.jsonc`）与 `TURNSTILE_SECRET_KEY`（服务端 secret，通过 `wrangler secret put` 按环境录入）：两者同时非空时启用 Cloudflare Turnstile 人机校验，保护世界书/正则预览与下载获取接口；任一缺失时自动关闭，不影响本地开发与 E2E。
- `MAINTENANCE_TOKEN` 是独立的运维 secret，按环境配置；不是用户会话或 Cloudflare API token。缺失时维护接口拒绝访问。维护关闭或协调器不可用时，静态资源、规范公开缓存读取以及经核实的纯读路径（`/api/v1/health`、客户端版本与兼容性查询、客户端脚本分发、伴随脚本版本读取、公开横幅图片）保持可用；所有可能写入的请求（含可能续期会话的鉴权读、可能使 OAuth flow 过期的状态查询、公开图片回填接口与未知路径）、定时任务及内容检查任务均阻断并返回 503 `maintenance`；绕过 Worker 的外部工具不受此绑定保护。排空与重新开放流程见[部署安全手册](../operations/deployment-safety.md#maintenance-barrier)。
- `APP_VERSION` 缺省为 `dev`，用于 health 响应。`LOG_SAMPLE_RATE` 缺省 `0.1`，非有限数或不大于 0 时不采样非 5xx，大于 1 按 1 处理；5xx 始终记录。

OAuth flow 的有效期为 10 分钟，使用 state、PKCE，并设置浏览器绑定 cookie：HTTP 下设置 `cw_oauth_binding`（`SameSite=Lax`），HTTPS 下同时设置 `__Host-cw_oauth_binding`（`SameSite=Lax; Secure`）与分区 cookie `cw_oauth_binding_p`（`Path=/api/v1/auth; HttpOnly; Max-Age=600; SameSite=None; Secure; Partitioned`）；跨站嵌入 HTTPS 流程通过弹窗打开 `GET /api/v1/auth/flows/:id/launch` 并调用 `POST /api/v1/auth/flows/:id/bind` 写入包括 `cw_oauth_binding_p` 在内的绑定 cookie。device 和 embed 的状态查询、回调及兑换检查上述绑定 cookie；browser 模式的状态查询和回调不检查绑定 cookie，不应将该绑定保证推广到 browser。服务端保管 secret、授权码、会话令牌和 cookie，不应将其写入日志、文档或工单。Cloudflare 部署凭据与运行时 OAuth/session secret 是不同凭据；CI 使用专用凭据，不得复制个人 token。上述名称不证明远端 secret 存在或值正确。

### Cloudflare 运维凭据来源

- GitHub Actions 的 `staging`、`production` environment 各自配置专用 secret `CLOUDFLARE_API_TOKEN`，对应部署工作流使用它并从 environment variable `CLOUDFLARE_ACCOUNT_ID` 读取账号。凭据存在不代表任意维护动作已有工作流实现，也不等于生产操作已授权；执行前须核实目标环境、资源身份及实际权限。
- 获用户明确授权后，本地导入、迁移和重建可从本地私有环境传入凭据（迁移工具本身不自动读取 `.env`，具体变量优先级见[数据迁移手册](../operations/legacy-data-migration.md#credential-lookup-and-authorized-staging-candidate)），仅在内存中传给明确目标的工具；不得打印、复制进其他文件、上传为 GitHub secret 或部署为 Worker secret；CI 继续使用其专用凭据。
- 平台 API token 与应用 `MAINTENANCE_TOKEN` 分工不同。需要关写排空时，可用已授权的平台凭据设置独立随机的维护 secret，再调用维护接口并确认排空；不得把个人平台 token 本身设为应用维护 secret。GitHub secret 不能通过 API 读回值，本地操作也不依赖取回 Actions 凭据。
- 本地 `.env` 分别使用 `STAGING_MAINTENANCE_TOKEN`、`PRODUCTION_MAINTENANCE_TOKEN` 保存不同的随机密码；文件权限为 `0600`，不得提交。Worker 内使用同名 `MAINTENANCE_TOKEN` secret，由环境隔离。日常发版不读取 GitHub 中的维护密码，不写入或轮换 Worker secret；授权运维时单独配置。production workflow 只检查 Worker 上需要的 secret 名称，不读取值。

会话沿用 30 天滑动有效期，每 24 小时最多续期一次；每次解析从当前 users 读取角色并检查撤销／过期，续期以原 session_version 和未撤销／未过期条件做原子更新，不复活已撤销会话。下载打开对象后再次鉴权。Discord 公会资格在 OAuth 登录时验证；当前不保存 provider access token，因此没有后台持续刷新资格的能力，用户离开公会不会自动触发本地撤销。管理员角色调整和本地会话撤销即时影响后续鉴权；重新登录重新验证公会。这个边界不是持续资格保证。

## 配置校验边界

仓库不是集中式启动配置校验器：来源、公会和角色按使用时解析；角色格式有上述检查，公会允许列表本身只是分割字符串。`PUBLIC_ORIGIN` 的缺省回退、空 client ID 的 pending 地址、无 session secret 的 SHA-256 回退都可能使配置缺陷不表现为启动失败。`GET /api/v1/health` 只报告 `DB`、`R2`、`ASSETS` 绑定是否存在及版本，不验证访问权限、OAuth 配置、secret、回调、角色或缓存命中。发布前应在获授权的目标环境分别确认资源绑定、回调登记、来源、公会和角色策略，以及真实登录和受保护操作；不要读取或打印 secret 值。部署检查及恢复限制见[部署安全手册](../operations/deployment-safety.md)。

## 公开缓存和私有绕过

同一 Worker 导出 default、`DataService` 和 `CachedReads`，具名入口共享 Worker bindings，不构成平台权限隔离。`Env` 不暴露 DB/R2；数据实现使用 `DataEnv`，网关与 DO 经类型化 `ctx.exports` / `state.exports` 调用。`pnpm --filter @workshop/worker check:data-boundary` 检查生产导入和存储访问边界。

所有环境停用 Workers Cache，公开白名单读取和获准的不可变内容使用 Cache API，缓存按 PoP 独立，不是全球共享缓存。`VERSION_METADATA` 用于按部署版本隔离；绑定缺失时绕过 Cache API。内部可变公开投影保存生成时的绝对过期时间，外层只使用剩余期限，避免内外 TTL 叠加；失败、部分成功和私有结果禁止公开缓存。代码响应头和配置不等于线上已经部署或命中。

TTL 以秒为单位集中配置，必须是十进制非负整数且不超过 31536000；未设置时使用下列默认值，设为 `0`、非法值或超限时禁用对应缓存并对外 `no-store`。TTL 变更时缓存键隔离。顶层、staging 和 production 可在各自的 `vars` 覆盖；Wrangler 环境变量不继承。

| 变量 | 默认秒数 | 分类 |
| --- | ---: | --- |
| `CACHE_TTL_PUBLIC_SECONDS` | 60 | 项目列表、详情、batch、entries，首页、发现、推荐、合集、作者主页和公开图片 |
| `CACHE_TTL_REFERENCE_SECONDS` | 300 | 站点信息 `/api/v1/site` |
| `CACHE_TTL_IMMUTABLE_SECONDS` | 31536000 | 版本化 client/checker 对外 immutable |
| `CACHE_TTL_INTERNAL_SECONDS` | 86400 | 授权后的预览及不可变对象内部缓存 |

完整请求流程和逐接口策略见 [API 缓存设计与路由清单](cache-design.md)。浏览器 HTTP 缓存可先于网络请求命中；预览及受保护对象每次读取前仍须实时鉴权。

## 失效与撤回

不使用全球主动 purge，也不恢复 epoch。写入或撤回后，不同 PoP 的旧公开条目可能保留至各自到期；在途请求可能在变更后填入旧数据，浏览器缓存或已保存字节也无法由服务端收回。因此分类 TTL 不是全球撤回时限。固定版本 immutable 资源还有更长的客户端留存风险。客户端发布脚本按“私有与公开 R2 版本化对象 → 私有与公开 R2 频道入口对象 → D1 `site_settings.client_channels` 原子 `json_set` 更新”顺序写入，不执行全球缓存主动清除，其非原子边界与详情见[部署安全手册](../operations/deployment-safety.md#client-artifact-publishing)。

## 推荐批次配置

`RECOMMENDATION_POLICY` 是可选的严格 JSON 对象。字段：`temperature`（0.1–4，默认 0.7）、`authorCap`（1–24，默认 2）、`discoveryLimit`（1–24，默认 12）和 `budget`（必须完整提供 verified/hot/new/underexposed 四个非负有限预算，总和大于零；默认 0.30/0.25/0.20/0.25）。无效配置使批次失败，不静默回退；这些默认值不是实际分布验证后的最优值。

`recommendation_batches.result` 保存四池选取、分项贡献及版本绑定的玩家推荐来源。时段使用固定的 legacy 月度请求估计，不再持续调整：[`apps/worker/src/recommendation-traffic-config.ts`](../../apps/worker/src/recommendation-traffic-config.ts) 记录来源区间、统计天数和 24 个 UTC 小时总量；修改此文件并重新部署即可调整，不需要 D1 配置或运行时 Analytics secret。

discovery 的展示读取从当前已提交记录投影完整有效玩家推荐及当前推荐者名称、头像，不重算批次冻结的选取分数或贡献；具体 90 天窗口、版本绑定、顺序与空数组合同见 [API 参考](worker-api.md#发现项目和下载)。撤回或更新会影响后续源投影读取，但版本化公共缓存的 TTL 内可能仍显示旧内容，不能解释为所有 HTTP 响应立即更新。

流量分布基线取自 legacy Worker `poemofdestinycreativeworkshop` 的 Cloudflare `workersOverviewRequestsAdaptiveGroups.count`（2026-10-03 00:00 UTC 至 2026-11-03 00:00 UTC，左闭右开，31 天，共 1,957,820 请求、737 个非空小时；缺失小时按零计）。每小时总量除以 31 得到平均日内分布，划为六个 1–8 小时的整点时段，最小化各时段预计请求占比偏差。请求数包括 API 等 Worker 请求，既非全站访问人数也非推荐位真实曝光；不新增用户行为采集，不把估算称为实际曝光。

批次按实际激活、替代、失效边界及作品下架／版本变更计算机会，部分小时按比例计入。每次激活仅保存不可变小时估计快照作为历史核算证据，避免未来配置修改重算旧机会；这不是另一套可变 D1 配置。历史证据不足则机会未知而不是零。缓存 TTL 仍可能令旧公开响应继续存在。同一时段最多三次生成尝试；提前生成与边界激活由 Worker Cron 完成，无本机常驻服务。

## 建库与审核报告

[`apps/worker/migrations/0001_initial.sql`](../../apps/worker/migrations/0001_initial.sql) 是上线前空数据库的建库基线，不是存量数据库的原地升级脚本；不得将其应用到已有数据库。存量与旧站数据迁移使用[离线数据迁移流程](../operations/legacy-data-migration.md)。源备份的既定历史遗漏必须在独立源对账中列明，不能伪造新审核报告。

当前审核证据分为从未生成、对象可用、已明确清理三态；意外缺失仍是错误；每日定时任务 `cleanupScheduledData` 仅做只读观测预警，不物理删除数据或对象。正式删除关系、报告清理状态与资源清理执行边界见 [Worker API 参考](worker-api.md)。

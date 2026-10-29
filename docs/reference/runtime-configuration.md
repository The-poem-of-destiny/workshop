# Worker 运行配置参考

本文描述仓库中当前的 Worker 配置和代码行为，不代表远端实际部署状态。接口及认证流程见 [Worker API 参考](worker-api.md)；发布、迁移、回滚与操作授权见 [部署安全手册](../operations/deployment-safety.md)。配置权威为 [`wrangler.jsonc`](../../apps/worker/wrangler.jsonc)、[`Env`](../../apps/worker/src/env.ts) 及其使用代码。

## 环境与 bindings

| 配置 | 顶层默认 | staging | production |
|---|---|---|---|
| Worker 名称 | `workshop` | `workshop-staging` | `workshop` |
| `DB` D1 | `workshop-staging` | `workshop-staging` | `workshop-prod` |
| `R2` | `workshop-client-staging` | `workshop-client-staging` | `workshop-client-prod` |
| `ALLOWED_ORIGINS` | `http://localhost:8787,http://127.0.0.1:8787` | `https://workshop-staging.poem-of-destiny.workers.dev` | `https://workshop.poem-of-destiny.workers.dev` |
| `PUBLIC_ORIGIN` | `http://localhost:8787` | `https://workshop-staging.poem-of-destiny.workers.dev` | `https://workshop.poem-of-destiny.workers.dev` |
| `DISCORD_CLIENT_ID` | `1562466173268926575` | `1562466173268926575` | 空字符串 |
| `DISCORD_ALLOWED_GUILD_IDS` | `1417861565679669272,1134557553011998840` | 同顶层 | 空字符串 |
| `DISCORD_GUILD_ROLE_IDS` | `1134557553011998840:1335363403870502912` | 同顶层 | 空字符串 |

顶层配置还声明 `ASSETS` 静态资源绑定，目录为 `./web/dist`，`/api/*`、`/client/*`、`/assets/*` 先运行 Worker；`CONTENT_SERVICE` 是 `ContentService` Durable Object，使用 SQLite 类迁移 `v1`。D1 迁移目录为 `./migrations`，定时触发为每分钟。具体环境的资源、部署配置和最终绑定应在授权部署时核实，不能仅凭表中仓库值推断线上状态。默认和 production 的入口缓存关闭；staging 的 default 入口缓存显式开启，见下文。

## 变量、secret 与认证

- `ALLOWED_ORIGINS` 是逗号分隔、去除空白后的精确 origin 列表。API CORS 的预检对不允许的 origin 返回 403；创建 OAuth flow 也要求请求有匹配的 `Origin`。它不是通配符列表。
- `PUBLIC_ORIGIN` 用于生成 OAuth 回调地址 `<PUBLIC_ORIGIN>/api/v1/auth/callback`，末尾斜杠会移除；变量未定义时回退到请求 origin。应与 Discord 应用登记的回调地址一致，并使用该环境实际公开地址。
- `DISCORD_CLIENT_ID` 是 OAuth 应用 ID；`DISCORD_CLIENT_SECRET` 是服务端 secret，不写入 `vars` 或仓库。缺少 ID 时 flow 创建会返回本地 pending 地址而不是 Discord 授权地址；兑换授权码要求 ID 和 secret，缺失会失败。生产仓库中的 ID 和公会列表为空，不能据此宣称生产登录已就绪。
- `DISCORD_ALLOWED_GUILD_IDS` 是逗号分隔的公会 ID；登录时必须至少属于其中一个，空列表会拒绝。`DISCORD_GUILD_ROLE_IDS` 格式为 `公会ID:角色ID,角色ID;公会ID:角色ID`，公会及角色 ID 必须为 17 至 20 位数字；同公会条目合并，满足任一指定角色即可。未列角色要求的允许公会只检查成员资格。空角色配置表示不要求角色；非空配置格式无效会在创建 flow 和兑换时失败。默认及 staging 中 `1417861565679669272` 只检查公会，`1134557553011998840` 要求角色 `1335363403870502912`。OAuth 固定请求 `identify`、`guilds`，配置角色要求时另请求 `guilds.members.read`。
- `SESSION_HASH_SECRET` 是会话令牌存储哈希的服务端 secret；存在时使用 HMAC-SHA-256，缺失时代码退回普通 SHA-256。配置或轮换 secret 会改变令牌哈希，已有会话可能失效，应事先安排重新登录。不要把缺省行为当作生产安全配置。
- `APP_VERSION` 缺省为 `dev`，用于 health 响应。`LOG_SAMPLE_RATE` 缺省 `0.1`，非有限数或不大于 0 时不采样非 5xx，大于 1 按 1 处理；5xx 始终记录。`CLEANUP_DRY_RUN=1` 使每日清理只试运行，其他值不启用试运行。

OAuth flow 的有效期为 10 分钟，使用 state、PKCE，并设置浏览器绑定 cookie；HTTPS 下 cookie 使用 Secure。device 和 embed 的状态查询、回调及兑换检查绑定；browser 模式的状态查询和回调不检查绑定 cookie，不应将该绑定保证推广到 browser。服务端保管 secret、授权码、会话令牌和 cookie，不应将其写入日志、文档或工单。Cloudflare 部署凭据与运行时 OAuth/session secret 是不同凭据；CI 使用专用凭据，不得复制个人 token。上述名称不证明远端 secret 存在或值正确。

## 配置校验边界

仓库不是集中式启动配置校验器：来源、公会和角色按使用时解析；角色格式有上述检查，公会允许列表本身只是分割字符串。`PUBLIC_ORIGIN` 的缺省回退、空 client ID 的 pending 地址、无 session secret 的 SHA-256 回退都可能使配置缺陷不表现为启动失败。`GET /api/v1/health` 只报告 `DB`、`R2`、`ASSETS` 绑定是否存在及版本，不验证访问权限、OAuth 配置、secret、回调、角色或缓存命中。发布前应在获授权的目标环境分别确认资源绑定、回调登记、来源、公会和角色策略，以及真实登录和受保护操作；不要读取或打印 secret 值。部署检查及恢复限制见[部署安全手册](../operations/deployment-safety.md)。

## 公开缓存和私有绕过

同一 Worker 导出 default、`DataService` 和 `CachedReads`，具名入口共享 Worker bindings，不构成平台权限隔离。`Env` 不暴露 DB/R2；数据实现使用 `DataEnv`，网关与 DO 经类型化 `ctx.exports` / `state.exports` 调用。`pnpm --filter @workshop/worker check:data-boundary` 检查生产导入和存储访问边界。

顶层和 production 的 default、`CachedReads` 缓存关闭；staging 对二者启用。`DataService` 在各环境关闭缓存。default 公开命中不执行内部调用；未命中才访问内部缓存。内部可变公开投影保存生成时的绝对过期时间，外层只使用剩余期限；失败、部分成功和私有结果禁止公开缓存。代码响应头和配置不等于线上已经部署或命中。

完整请求流程、逐接口缓存层级和失效见 [API 缓存设计与路由清单](cache-design.md)。入口缓存查找早于入口代码，执行时的 URL 规范化不能改变 default 已发生的查找键。浏览器 HTTP 缓存可先于网络请求命中。

## 失效与撤回

成功业务提交后，DataService 通过 `CachedReads.invalidatePublic` 在内部入口合并 purge；HTTP 网关在 default 入口清理对应前缀，定时排行榜和自动发布也分别处理两个入口。site 清 site、home 和 banner；参考集与推荐管理写清各自投影；审核、项目显示编辑、可见性、删除和 gallery 指定写清项目、home、推荐及公开图片前缀。purge 失败记录错误，不回滚已成功的写入，也不是同步提交屏障。精确映射见 [`public-invalidation.ts`](../../apps/worker/src/http/public-invalidation.ts)、[`service.ts`](../../apps/worker/src/data/service.ts) 和 [`scheduler.ts`](../../apps/worker/src/scheduler.ts)。

普通公开表示的 300 秒是响应新鲜度预算，不保证撤回后恰好 300 秒全球消失：浏览器已缓存或保存的内容无法由服务端收回，purge 可能失败或受并发旧请求填充影响。源端在重新执行时检查当前公开资格，旧页面中的图片链接也可能因资格变化而失效。固定版本 immutable 资源有更长的客户端留存风险，不能假定 purge 能撤销已保存字节。客户端发布脚本另有可选的 zone tag purge；其跳过条件、非原子发布顺序和操作限制见[部署安全手册](../operations/deployment-safety.md#client-artifact-publishing)。

本参考依据仓库配置和源码，不证明远端绑定、secret、缓存命中率、跨地区 purge 或撤回时限；需要经授权的 hosted 请求、响应头与实际写入/撤回场景验证，不能用本地静态阅读替代。不要为验证使用未经授权的生产操作或个人 Cloudflare token。

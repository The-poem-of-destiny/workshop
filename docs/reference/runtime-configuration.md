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

顶层配置还声明 `ASSETS` 静态资源绑定，目录为 `./web/dist`，`/api/*`、`/client/*`、`/assets/*` 先运行 Worker；`CONTENT_SERVICE` 是 `ContentService` Durable Object，使用 SQLite 类迁移 `v1`。D1 迁移目录为 `./migrations`，定时触发为每分钟。具体环境的资源、部署配置和最终绑定应在授权部署时核实，不能仅凭表中仓库值推断线上状态。

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

所有环境停用 Workers Cache，公开白名单读取和获准的不可变内容使用 Cache API，缓存按 PoP 独立，不是全球共享缓存。`VERSION_METADATA` 用于按部署版本隔离；绑定缺失时绕过 Cache API。内部可变公开投影保存生成时的绝对过期时间，外层只使用剩余期限，避免内外 TTL 叠加；失败、部分成功和私有结果禁止公开缓存。代码响应头和配置不等于线上已经部署或命中。

TTL 以秒为单位集中配置，必须是十进制非负整数且不超过 31536000；未设置时使用下列默认值，设为 `0`、非法值或超限时禁用对应缓存并对外 `no-store`。TTL 变更时缓存键隔离。顶层、staging 和 production 可在各自的 `vars` 覆盖；Wrangler 环境变量不继承。

| 变量 | 默认秒数 | 分类 |
| --- | ---: | --- |
| `CACHE_TTL_PUBLIC_SECONDS` | 60 | 项目列表、详情、batch、entries，首页、发现、推荐和公开图片 |
| `CACHE_TTL_REFERENCE_SECONDS` | 300 | 排行、site、reference sets |
| `CACHE_TTL_IMMUTABLE_SECONDS` | 31536000 | 版本化 client/checker 对外 immutable |
| `CACHE_TTL_INTERNAL_SECONDS` | 86400 | 授权后的预览及不可变对象内部缓存 |

完整请求流程和逐接口策略见 [API 缓存设计与路由清单](cache-design.md)。浏览器 HTTP 缓存可先于网络请求命中；预览及受保护对象每次读取前仍须实时鉴权。

## 失效与撤回

不使用全球主动 purge，也不恢复 epoch。写入或撤回后，不同 PoP 的旧公开条目可能保留至各自到期；在途请求可能在变更后填入旧数据，浏览器缓存或已保存字节也无法由服务端收回。因此分类 TTL 不是全球撤回时限。固定版本 immutable 资源还有更长的客户端留存风险。客户端发布脚本另有可选的 zone tag purge，其操作限制见[部署安全手册](../operations/deployment-safety.md#client-artifact-publishing)，不应当作本方案的全球失效保证。

本参考描述仓库变更，不证明远端已部署、绑定、缓存命中率或撤回时限；上线仍需用户明确授权，hosted 行为尚未验证。需要获授权后验证目标环境的请求、响应头和实际写入/撤回场景；不要使用未经授权的生产操作或个人 Cloudflare token。

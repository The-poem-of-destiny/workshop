# 自定义域名、缓存与资源消耗上线计划

状态：staging 部分配置，尚未完成验收。沿用 [D-49](decisions.md#d-49-分类-ttl-cache-api)；本计划不授权修改 DNS、Cloudflare、Discord 或真实数据，不改变[人工门槛](user-actions.md)和[发布安全流程](../../operations/deployment-safety.md)。按 staging → production 分别验收；最终记录精确 Worker version、Web／client revision、schema、规则版本、UTC 观察窗口和回退责任人。

## Staging 执行记录（2026-11-19）

- `workshop-staging.poem-of-destiny.3378469.xyz` 已绑定现有 staging Worker，公开 DNS、HTTPS 和健康检查通过；旧入口及 Discord 回调未切换。
- PR #99 已合并到 `143ee219458a4ca2b6d34071371a3456b2ca4423`，合并后 CI 通过。[Staging 工作流](https://github.com/The-poem-of-destiny/workshop/actions/runs/44546621108) 因 `0001_initial.sql` 相对已验收基线有变化，跳过构建和部署。未变更门禁、未迁移；不能用旧版响应作为新版缓存或静态分流证据。
- 已写入并回读 `assets-staging.poem-of-destiny.3378469.xyz/immutable/*` 边缘 TTL 规则：`200` 30 天、源站 `403/404` 5 分钟。尚未建桶或绑定资源域；限流未启用，因为当前 Free zone 的限流表达式不能限定 hostname。防盗链未启用。
- 新令牌的 R2 列桶返回 `401 / 10000`；2026-11-18 UTC 的 Workers 和 D1 基线查询均被拒绝。没有当前版实耗数据，不能把历史流量估计当验收。恢复条件：确认账户级 R2 写入和 Analytics 读取权限，并取得经过 schema 门禁的新版本部署；隔离空库预览须另行授权，不替代现有 staging 数据验收。生产保持不动，按既有发布流程另行审批。
- 随后经用户授权，在关闭并排空维护屏障后原地重建现有 staging D1，不换绑定、不改 GitHub 凭据或 `0001_initial.sql`。只处理了五条已核实的旧 `d1.batch` 票据；重置前保存 Time Travel 回退点。重置后 82 个业务 schema 对象与空库执行 `0001` 的结果逐项一致，外键检查为空，项目和用户均为零。
- 已手动部署不含临时恢复入口的 staging Worker `746600e0-331b-45fa-833e-0dd718ff2ce2`，恢复入口返回 400，维护屏障已重新开放。自定义域首页、健康检查、首页 API 和带一年 immutable 的构建脚本均返回 200。GitHub 自动部署检查点仍需走受保护 PR；此结果不证明边缘命中或账单节省。

## 1. DNS、应用缓存与静态分流

- [ ] Spaceship 委派完成后，分别核对父区 NS、Cloudflare zone `Active`、DNSSEC/DS 与 TLS 证书；盘点并保留无关记录。为 staging 与 production 分设应用 Worker Custom Domain 和 R2 资源域；确认 zone 与 R2 在同一账户，域名／证书可用后再改应用公开 origin。旧入口若还能访问，不能绕过只挂在新域名的 WAF；验证旧地址的处置再开放流量。
- [ ] 记录改动前的目标环境配置和指标。按现行部署流程部署已检查的精确 SHA；同步目标环境的应用 origin、Discord 回调和客户端公开地址。先保留合法旧回调以便回退，验证新域名普通浏览器及嵌入／设备登录与登出，再移除旧配置；不记录授权码、cookie 或 token。
- [ ] 在应用自定义域验证[分类 TTL Cache API](../../reference/cache-design.md)，不启用 Workers Cache、不加覆盖整个应用域的 CDN Cache Everything。对同一 `CF-Ray` 机房连续请求同一匿名 canonical key，记录首次源读、复用时源读减少、过期后重读；按现有 60／300 秒分类做代表性样本，另选一个机房观察独立填充。应用响应头相同不等于 Cache API HIT；用采样到的入口／D1 证据配对，必要时用隔离 staging 诊断版。应用域若经过 Cloudflare Access，不能把该路径当作 Cache API 可用的证据。
- [ ] 匿名与登录请求交替，验证公开投影不混入私有数据、草稿／审核／私有图与票据不对外缓存，票据权限和计数仍实时；测试写后同机房 TTL 内可能陈旧、过期回源以及下架边界。记录实测而非承诺全球撤回时限，不做全局 purge 或 epoch。
- [ ] 完全关闭 `run_worker_first`：命中的静态首页、图标及构建资源不执行 Worker；`/assets/*` 由 Static Assets 设置一年 immutable。验证静态直出、缺失资源 404、API 维护 503 与恢复。维护时静态首页仍可加载，前端依据首页 API 的 `503 maintenance` 显示维护提示。OAuth、票据和稳定客户端入口仍归 Worker；保留 WriteBarrier。

平台依据：[Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)、[Static Assets routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)。

## 2. WAF 速率限制

- [ ] 核对目标 zone 的实际套餐和规则余量。应用域只选需要治理的已知路径；先按路由／客户端区分正常峰值、共享 NAT、重试和可疑突发，再选阈值。Free 默认只有一条 rate limiting 规则，匹配字段、按 IP 计数和 10 秒窗口／缓解有限；若应用与资源域处在同一 Free zone，不假定各有一条，也不靠套餐不支持的 Host／method 匹配。先验证实际表达式作用域；无法安全区分则不上该规则。避免先覆盖 Discord 回调、设备轮询或全部安装／票据流量。
- [ ] staging 用隔离测试客户端验证阈值以下的正常路径、超过阈值的阻断和窗口后恢复，实际记录状态码及 Security Events；验证第二个正常客户端、共享 IP 的容忍度、缓存命中和被早期规则拦截的请求。机器调用不要用浏览器 challenge 替代明确限流。Cloudflare 的边缘计数不是精确全局 Origin 配额；不是鉴权或应用计量的替代品。
- [ ] production 先设告警与回退点，再启用经 staging 验证的规则；观察按路径的阻断、正常安装／登录失败和源站负载。误伤即停用本条规则并保留事件证据，不临时放开鉴权。Free 不假定具备仅记录动作。

平台依据：[Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)、[WAF feature interoperability](https://developers.cloudflare.com/waf/feature-interoperability/)。

## 3. R2 CDN：200、负缓存和防盗链

- [ ] 每个环境独立公开 bucket；只同步允许长期公开、内容寻址或版本化、无即时撤回要求的对象，并核对 MIME、字节与摘要。候选为已确认不含私有信息的不可变发布资源；不搬运当前可撤回封面、草稿／审核资源、有条件预览、下载票据后字节或任何需要实时授权／计量的内容。保留现行 Worker 路径的权限与计量；`r2.dev` 保持关闭，不以公开域映射私有 bucket。先上传并校验全部新对象，再切消费者 URL；回退用此前的已验证 URL，不覆盖已长缓存的对象键。
- [ ] Cache Rule 仅作用于专用资源域和允许的公开前缀；将这些对象设为 Eligible for cache，不依赖扩展名默认行为。边缘 200 用 **30 天（2,592,000 秒）**，origin 返回的 404／403 用 **5 分钟（300 秒）**，5xx 明确不缓存；不把 WAF 403 当成 origin 负缓存。浏览器 TTL 单独控制，负响应不要求客户端长缓存；应用不发送任意 query 变体，不假定免费套餐能忽略 query。先不启用 Smart Tiered，以便区分初始 PoP 行为；如日后单独启用，另对账源读变化。
- [ ] 先在资源域启用面向图片的 Hotlink Protection，并接受其只保护支持的格式、允许空 Referer；不是访问控制，也挡不住可伪造请求。实际测试同站不同子域、站外、空 Referer、SVG／WebP／脚本等非覆盖格式。现有 `Referrer-Policy: same-origin` 可能使合法跨源加载无 Referer；不要据此突然封空 Referer。若确需扩展至其他格式，先确认套餐支持 Referer 条件，再按资源域与明确前缀制定规则，并决定是否接受空 Referer；核对嵌入、Discord、真实 ST、引用隐私以及 CSP／跨源脚本和 CORS。需要强访问控制的对象留在私有路径，不靠防盗链。
- [ ] staging 用合成对象测 cold → HIT、同机房／不同机房、GET／HEAD 和按需的 Range／CORS。记录 `CF-Cache-Status`、`Age`、`CF-Ray`、响应摘要及 R2 读量；核对线上规则精确 TTL，在 staging 可用短 TTL 验证到期回源。对不存在的键测 404，随后上传同一个合成键，核对负缓存到期后可读；单独区分合法 origin 403 与 WAF 403。若该公开 R2 路径无法稳定产生 origin 403，记录该分支未实测，不用 WAF 403 补证。上线后若对象坏了或泄露，先切引用／阻断新流量，按需清除边缘 URL；已下载或浏览器已缓存的内容不可回收。

平台依据：[R2 公共桶](https://developers.cloudflare.com/r2/buckets/public-buckets/)、[Cache Rules 设置](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/)、[状态码 TTL](https://developers.cloudflare.com/cache/how-to/configure-cache-status-code/)、[Hotlink Protection](https://developers.cloudflare.com/waf/tools/scrape-shield/hotlink-protection/)。

## 4. Workers、D1、R2 实耗验收

已知历史基线：旧 Worker 2026-10-03 至 11-03（UTC，结束不含）共 1,957,820 请求／31 天，约 **63,155 请求／天**；不是当前版本的流量、计费或峰值样本。以 Free 100,000 Worker requests／天作量级对照，历史平均相差约 36,845／天；**不能据此判断当前能留在 Free**。缺少当前路由占比、命中率、内部调用和峰值，不能给 D1/R2 单点预测。

| 项 | 上线前估算 | 验收数据 |
| --- | --- | --- |
| Workers | 外部请求量减掉实测静态直出及迁到 R2 CDN 的请求；Cache API HIT 仍执行应用。单列内部 cached fetch、其他 fetch、RPC 与定时入口，按账单口径核对，不把它们一律当成额外计费请求 | Worker invocations、CPU ms／调用和总量、日峰值、429／503；对照计划额度与实际账单用量 |
| D1 | 按路由将缓存 miss／不缓存请求乘以实测 `rows_read`，加实时授权、写路径、定时任务；`rows_written` 单列并包含索引影响，不用 SQL 次数代替行数 | 同窗 D1 rows read／written、扫描及存储；Free 对照为每天 500 万读、10 万写（UTC）及 5 GB 存储 |
| R2 Standard | 按路径估算穿透 CDN 的 GET／HEAD（Class B）、上传／LIST／COPY（Class A）及新增 GB-month，保留失败操作、旧桶和回填量；负缓存命中不是直接计费证据 | 分桶对照 Class A/B 与存储及账户总用量；Standard 月含 100 万 A、1,000 万 B、10 GB-month；记录套餐、观测延迟和共享账户背景流量 |

- [ ] 变更前记录可比的 UTC 窗口。staging 在隔离数据上顺次执行冷／暖请求、到期回源、授权预览、票据下载、WAF 阻断、R2 200／404 和回退；保留精确请求计数和路由样本。用统计增量与单次观测交叉核对，不把控制面事件、浏览器缓存或合成流量算成自然命中。
- [ ] production 分别记录 DNS／应用缓存、静态分流、资源切源、限流的生效时刻；一次变更后留足指标入账时间。比较上线前后同 UTC 时段、同流量口径的每千外部请求 invocations、CPU、D1 读写、R2 A/B，另记录总量与峰值。至少覆盖一个完整 UTC 日，最好保留可比的完整 7 日窗口；按环境、应用、桶和 zone 拆分。用日峰判断 Free 每日风险，用月累计／预测判断付费及 R2 月配额。计入同账户其他服务占用，未实测或无法归因的节省不写成结论。
- [ ] 放行条件：功能与隔离验收通过；静态路径确实不调用 Worker；代表性匿名 Cache API 命中降低源读；R2 CDN 命中降低源操作；WAF 正常路径不被误伤。若样本不足或入账未完成，保持 M-08 未关闭；若授权、写屏障、计量或合法客户端被破坏，按对应步骤立即回退，不等待指标窗口。

价格及额度以验收当日官方口径为准：[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)、[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)、[R2 pricing](https://developers.cloudflare.com/r2/pricing/)。

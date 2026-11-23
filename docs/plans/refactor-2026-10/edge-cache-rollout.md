# 自定义域名、缓存与资源消耗上线计划

状态（2026-11-23）：`staging` 已在 `d7deb9d` 跑通 `deploy-staging` 全链部署与验证（98/98 schema 对象、Worker 部署、客户端与公开图双桶分发及 smoke）；现行公开资源桶为 `workshop-img-staging`（`assets-staging.poem-of-destiny.3378469.xyz`）与 `workshop-img-prod`（`assets.poem-of-destiny.3378469.xyz`），同时承载公开封面／画廊／横幅副本以及 `client/v/<sha>/index.js`（`public, max-age=31536000, immutable`）与 `client/<channel>/index.js`（`public, max-age=300`）。`production` D1/R2 预装载已完成（含 `workshop-img-prod` 531 张公开封面），待首次 `v*` 生产切换与真实流量观察窗口完成最终实耗验收。沿用 [D-49](decisions.md#d-49-分类-ttl-cache-api) 与 [D-53](decisions.md#d-53-上线前架构收敛与条款替代汇总)；本计划不改变[人工门槛](user-actions.md)和[发布安全流程](../../operations/deployment-safety.md)。

## 历史 Staging 执行记录（2026-11-19，已被 2026-11-23 状态替代）

> 说明：以下为 2026-11-19 建域初期的历史过程记录（当时的 82 对象空库重置、早期跳过部署与权限排障均已被后续演进替代；截至 2026-11-23，`staging` 已绑定五分类 98/98 schema 的 `workshop-staging-migrate-977ebb415bf6` 并在 `d7deb9d` 全绿自动发版，现况以 [`state.md`](state.md) 为准）。

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

## 2. WAF 与速率限制

staging 与 production 的应用自定义域共用一条 Free zone 限流：`/api/v1/home` 和 `/api/v1/projects`（含尾部 `/`，不区分方法／查询参数），同一来源 IP、同一 Cloudflare 机房 **60 请求／10 秒**，超过后返回 429 并阻断 10 秒。两域共用计数，不是各有 60 次。Custom Rule 仅在其他域名请求这些路径时跳过 `http_ratelimit`，不跳过其他 WAF 阶段。原 staging `/.env`、`/.git` 和非常用方法规则已移除；未修改平台默认托管规则。

2026-11-22 NRT 实测：staging 63 次目录请求中 61 次 200、2 次边缘 429；同一窗口内 production 自定义域的目录请求也返回边缘 429，图片域相同路径仍为 404，两应用域 health 均为 200。等待 11.5 秒后 staging 目录恢复 200、production 目录恢复其原有 404。未验证其他机房或真实流量下的误伤率。

已关闭 staging Worker 的 `workers.dev` 与 Version URLs，回读两项均为 `false`，Worker deployment ID 不变；旧入口和抽样版本入口 health 均返回 404。Wrangler staging 配置保留这两项，迁移控制工具改用受保护的自定义域。不适用于其他 Worker 或环境。平台依据：[workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)、[Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)、[Custom rules](https://developers.cloudflare.com/waf/custom-rules/)。

`staging` 客户端已在 `d7deb9d` 正式发布至私有桶 `workshop-client-staging` 与公开 CDN 桶 `workshop-img-staging`。`apps/worker/wrangler.jsonc` 已为 `production` 显式配置 `workers_dev: false` 与 `preview_urls: false`；由于 `production` 自定义域当前仍为切流前占位服务、尚未执行首次 `v*` Worker 部署，首次业务上线部署后须回读并实测生产替代入口均已关闭（返回 404）。

如出现误伤，先停用限流规则 `ad0f6692f6ff4778908052e4aa1a5d72`，保留事件证据，不动鉴权。若永久移除限流，同时移除专用范围规则 `e44d465adba94703be7d75737a60f5f8`。后续收紧见 [EDGE-03](open-threads.md#边缘读取公开资源与成本)；不要把边缘计数当作全局配额或鉴权。

平台依据：[Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)、[WAF feature interoperability](https://developers.cloudflare.com/waf/feature-interoperability/)。

## 3. R2 CDN：200、负缓存和防盗链

- [ ] 每个环境独立公开 bucket；只同步允许长期公开、内容寻址或版本化、无即时撤回要求的对象，并核对 MIME、字节与摘要。候选为已确认不含私有信息的不可变发布资源；不搬运当前可撤回封面、草稿／审核资源、有条件预览、下载票据后字节或任何需要实时授权／计量的内容。保留现行 Worker 路径的权限与计量；`r2.dev` 保持关闭，不以公开域映射私有 bucket。先上传并校验全部新对象，再切消费者 URL；回退用此前的已验证 URL，不覆盖已长缓存的对象键。
- [ ] Cache Rule 仅作用于专用资源域和允许的公开前缀；将这些对象设为 Eligible for cache，不依赖扩展名默认行为。边缘 200 用 **30 天（2,592,000 秒）**，origin 返回的 404／403 用 **5 分钟（300 秒）**，5xx 明确不缓存；不把 WAF 403 当成 origin 负缓存。浏览器 TTL 单独控制，负响应不要求客户端长缓存；应用不发送任意 query 变体，不假定免费套餐能忽略 query。先不启用 Smart Tiered，以便区分初始 PoP 行为；如日后单独启用，另对账源读变化。
- [ ] 先在资源域启用面向图片的 Hotlink Protection，并接受其只保护支持的格式、允许空 Referer；不是访问控制，也挡不住可伪造请求。实际测试同站不同子域、站外、空 Referer、SVG／WebP／脚本等非覆盖格式。现有 `Referrer-Policy: same-origin` 可能使合法跨源加载无 Referer；不要据此突然封空 Referer。若确需扩展至其他格式，先确认套餐支持 Referer 条件，再按资源域与明确前缀制定规则，并决定是否接受空 Referer；核对嵌入、Discord、真实 ST、引用隐私以及 CSP／跨源脚本和 CORS。需要强访问控制的对象留在私有路径，不靠防盗链。
- [ ] staging 用合成对象测 cold → HIT、同机房／不同机房、GET／HEAD 和按需的 Range／CORS。记录 `CF-Cache-Status`、`Age`、`CF-Ray`、响应摘要及 R2 读量；核对线上规则精确 TTL，在 staging 可用短 TTL 验证到期回源。对不存在的键测 404，随后上传同一个合成键，核对负缓存到期后可读；单独区分合法 origin 403 与 WAF 403。若该公开 R2 路径无法稳定产生 origin 403，记录该分支未实测，不用 WAF 403 补证。上线后若对象坏了或泄露，先切引用／阻断新流量，按需清除边缘 URL；已下载或浏览器已缓存的内容不可回收。

平台依据：[R2 公共桶](https://developers.cloudflare.com/r2/buckets/public-buckets/)、[Cache Rules 设置](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/)、[状态码 TTL](https://developers.cloudflare.com/cache/how-to/configure-cache-status-code/)、[Hotlink Protection](https://developers.cloudflare.com/waf/tools/scrape-shield/hotlink-protection/)。

### 普通公开封面：独立撤回试验

[D-51](decisions.md#d-51-普通公开封面可短暂陈旧)允许短暂陈旧。此试验用独立 staging 公开桶与 `covers/` 前缀，不改 `immutable/` 规则，也不接入目录或上传真实封面作为探针。对 200 试用边缘 TTL 60 秒，浏览器每次重验证；403／404／5xx 不缓存，过期与源站错误均不兜旧。变更前先确认域名 TLS、桶绑定、规则实际生效及写入／精确 purge 权限。

用两个不同的合成 PNG 键，从同一 PoP 对每个键记录 cold、HIT、`Age`、`CF-Ray` 和内容摘要。两个键各自在独立用例中删除源副本：一个不 purge，用来观察自然到期后下一次请求是否已不返回图；另一个在命中后立刻做精确 URL purge，用来观察实际撤回路径。另查从未发布的键与被撤回键均不返回图片。记录源端删除时间、purge 接受时间和实际探测结果；单 PoP 样本不外推为全球上限。这个探针不替代业务发布与下架竞争的验收。

2026-11-21 探针阶段曾使用早期试点桶 `workshop-covers-staging` 绑定 `assets-staging.poem-of-destiny.3378469.xyz`（TLS 和所有权激活，`r2.dev` 关闭；该试点桶及对应的 `workshop-covers-prod` 随后已被统一公开桶 `workshop-img-staging`／`workshop-img-prod` 接替并于 2026-11-23 删除）。仅该域 `/covers/` 的 200 边缘 TTL 为 60 秒，400–599 不存储，禁用过期后台更新时返回旧响应；原 `/immutable/` 规则未改。

2026-11-21 staging 合成 PNG 探针（同一 NRT PoP）：两个键均从 `200 MISS` 转为 `200 HIT`，内容摘要一致；浏览器收到 `public, max-age=0, must-revalidate`。自然到期键在源删除后仍返回 `200 HIT`（`Age: 5`），首次填充约 69 秒后返回 `404 BYPASS`。另一键先删源，再对精确 URL purge；Cloudflare 接受后约 0.24 秒的请求返回 `404 BYPASS`。从未上传的键也返回 `404 BYPASS`；两个探针源对象均已删除。未测其他 PoP、源站 5xx 或业务发布/下架并发；采样不证明精确的到期瞬间或全球撤回上限。

优化目标是降低 Cloudflare Free tier 各项额度的消耗，不为单项指标预设最高优先级。Worker 外部入站请求、R2 读写、D1 读写通常更容易成为瓶颈，切流前后优先测量这些指标，同时记录 Worker CPU 和其他受影响的额度。用相同浏览负载对照冷／暖读，另测发布、替换、撤回增加的写入；不要把减少 Worker 请求当作总资源消耗下降。Worker 内 Cache API 命中仍计 Worker 入站请求；未挂 Worker 的 R2 自定义域可绕过 Worker，但 CDN 未命中仍可能产生 R2 源读。参见 [Workers 计费](https://developers.cloudflare.com/workers/platform/pricing/)。

已确认直连 R2 的 staging 业务试验：公开副本写入结果不明时允许下架保持处理中，不提前报告成功。一次性本地 workerd 探针确认 R2 binding 的 `onlyIf.etagMatches` 在对象删除后拒绝迟到的写入，不会重建对象。Cloudflare R2 管理 REST 上传端点对同类过期 `If-Match` 返回 200，不能用它实现写入围栏；远端合成探针已删除。这个证据只覆盖已存在的预留对象被删除后迟到的条件写入，不覆盖预留本身迟到、重建预留或业务并发，也不证明 hosted binding 行为。

业务接入的状态顺序：

1. D1 持久化每个项目的独立代际；触发器拒绝越过未撤回副本直接改公开指针、可见性或软删除。选图以当前公开指针为准，不接受任意 R2 key；重发分配新键。
2. 先提交公开状态，再写入已验证的封面字节；只在写入确认后公开 CDN URL。写入未确认前保留现行 Worker 图片路径。复制的在途记录必须先于 R2 PUT 持久化；进程退出、超时或响应丢失时不能把记录当作已失败并允许撤回越过它。单靠 PUT 后重查 D1 仍可能在删除之后重新公开。
3. 下架或替换先停止旧代际复制，确认旧副本已删除，再提交业务状态和撤回记录；清理精确 URL 不作为 D1 提交条件。删除已完成但业务提交失败时，公开项目继续使用原 Worker 路径，不能继续发已删除的 CDN URL；修复或重试不得复用撤回键。
   若预留 PUT 的结果不明，`reserving` 记录保留，业务下架不会报成功。不能仅凭一次 HEAD 或超时就清记录：迟到的预留还可能落地。
4. 本地已验证公开封面／画廊／横幅投影、撤回后不能重建旧键、直接改私有被 D1 拒绝；保留旧 Worker 路由。早期拆分的 `0002_public_cover_replicas.sql`（连同画廊与横幅副本表）已收口并入 98 对象上线基线 `0001_initial.sql`，已在 `staging`（`d7deb9d`）及预装载完成的 `workshop-prod`（531 条 `public_cover_replicas`）核验就绪，见[状态记录](state.md#当前-stagingedge-01)。仍需使用已登录的 `staging` 作者验收真实并发、画廊／横幅替换下架及生产切流后的实际成本。


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

### EDGE-02：同图对照与撤回窗口

2026-11-21 13:42:58–13:43:04 UTC，NRT，staging 专用项目 `6ec876ad-3991-44c4-a5a4-9959e4d9de30`。旧 Worker 公开资源路由和新 R2 CDN URL 各 14 次（首次、复读、12 并发），全部 200，图片摘要一致。Worker 路由首次未标缓存状态、后 13 次 HIT；CDN 首次 MISS、后 13 次 HIT。首次／复读完整响应分别为 Worker 509／178 ms、CDN 717／401 ms；顺序执行的单次样本不能证明延迟收益。封面直出将这 14 次浏览器封面请求从应用域移到 CDN 域；并非账单上已独立归因的 14 次调用差值。

切回私有 PATCH 耗时 2.144 秒。以成功响应为零点，匿名详情最后 200／首次 404 为 51.457／52.744 秒，旧 Worker 封面为 52.744／54.015 秒，新 CDN 封面为 54.015／55.641 秒。时间为轮询观测点，不是精确失效时刻或全球上限；未执行 purge。项目已软删除、会话已撤销、临时签发 secret 已删除且入口回到 404。

同窗 Workers Analytics：13:42／13:43 UTC 分别为 57／161 请求，均零 errors，CPU p50 为 1.696／0.641 ms，p99 为 28.321／11.556 ms。窗口混有巡检、作者操作和撤回轮询，不可作两条路由的 CPU 差值。D1 首次查询只返回 13:42 的 7 读／0 写，不覆盖已发生的写入；R2 返回测试时段私有桶 2 PUT／3 GET、公开桶 1 PUT／1 DELETE，但没有覆盖已观察到的 CDN MISS 取源。缺失指标不记成零，不能据此估算全量免费额度。此次仅对照封面子请求，不是完整浏览旅程；未改 production。

### 目录冷查询：全文先行与翻页复用总数

2026-11-21：用新版目录代码生成 SQL，在同一个 staging D1 上以只读查询执行；数据有 525 个公开项目。以下是 D1 `meta.rows_read`，不包括 Worker、缓存、封面请求或用户端延时；所有样本零写入。

| 搜索 | 匹配项目 | 原读行 | 新读行 |
| --- | ---: | ---: | ---: |
| 随机无结果词 | 0 | 1,051 | 1 |
| 埃洛 | 1 | 1,059 | 11 |
| 埃洛 + 角色 + 少女标签 | 1 | 1,061 | 13 |
| 世界书 | 8 | 1,122 | 88 |
| 角色 | 279 | 3,229 | 2,775 |
| 角，第 1 页 | 281 | 3,243 | 2,795 |
| 角，第 2 页 | 281 | 3,189 | 1,618 |

首次搜索先从 FTS 取候选，再按公开资格和结构化筛选收窄。第一页仍执行列表与精确计数两条 SQL；后续只执行列表 SQL，沿用游标里的首次总数。全文可以命中标题、作者、分类或标签中的文本；精确标签仍按[筛选合同](../../reference/worker-api.md#目录筛选与游标)做分组匹配，不能互相替代。短词和 trigram 匹配规则未改。

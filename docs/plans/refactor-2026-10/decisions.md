# 决策记录（唯一来源）

本文件是重构决策的**唯一事实来源**。其他文档（`main.md`、`features.md`、`archive/patch-audit.md`）只引用 ID，不再维护副本。  
状态：`生效` / `待定` / `被替代`。新增决策追加编号，不重排历史。

2026-10-26 决策复审：**D-40～D-47 为最新确认，冲突时优先于下方旧条款。** 它们是目标与验收约束，不代表已经实现；下一步工作见 [checklist.md 的本轮工作包](checklist.md#本轮工作包2026-10-26)。未被明确改变的条款继续有效。

---

## 已生效

### D-01 平台与执行模型

Cloudflare **Free** 套餐。普通 Worker 每请求 10ms CPU，Durable Object 每请求 30s；因此保留**一个** `ContentService` DO 承接大 JSON 解析与完整 checker，删除用正则复写路由表的 `contentServiceKey`，由 Hono 显式路由。

### D-02 项目可见性

只有两态：`public` / `private`，不设 unlisted。旧 `visibility=0 + approved` 迁移为 `private`。`private` 对非作者/审核者在列表、详情、文件、批量接口一律 404。

### D-03 匿名可见范围

匿名只能看到摘要与条目索引；完整可安装内容（manifest 与文件）必须登录并经过权限检查。

### D-04 订阅计数

订阅计数保持公开，列表与详情返回真实计数。当前实现硬编码 `subscribesCount: 0`，属于功能缺失，新实现必须真正计算。

### D-05 客户端分发

使用**固定地址**，由 Worker 代理 R2 提供（`/client/...`，D-22），服务端控制版本与缓存头，不使用 jsDelivr `@main` 或 `@tag`。

### D-06 客户端版本门禁

**精确匹配**当前 channel 版本（`stable` / `staging`）。版本不一致时阻止安装/更新/修复，并提示更新。`client.minimum` 不恢复。

### D-07 站外通知

不做。未来可能在 tavern-client 侧实现，不在本轮范围。

### D-08 配套脚本展示

> 配套脚本后端范围已由 D-45 替代；这里只保留旧决定的历史。

移除工坊内的配套脚本展示与版本健康检查（角色管理库、美化器等）。记录：未来可能统一到某个地方。

### D-09 审核路由

- 客户端上传前检查：结果**记录但不信任**（`gate + checker revision + warning count + 作者确认 + 时间`），只作路由与审计。
- 客户端 `pass/warn` → 进入 DO 自动检查；客户端 `block` 或**缺少标记** → 直接人工，**不跑 DO**。
- DO 自动检查：`pass` 自动发布；`warn` 自动发布并显示警告标记；`block` 转人工。
- **没有自动拒绝**：自动检查只决定“发布 / 转人工”，拒绝只能由人做。
- 超时重试，达到上限转人工，不能静默跳过。
- 审核者基于 DO 报告做**一票决定**：通过即发布、失败即拒绝；结果绑定 `submission_id + content_hash + checker_revision`。本地重跑仅作辅助，且必须同 revision（D-31）。
- `pass/warn/block` 的语义**唯一定义在 checker**；业务层不写“某类型必须人工”的散落判断。

### D-10 认证与跨域

- **Origin 白名单**：`/auth/flows` 只接受生产/预发/本地工坊 origin；**不存储请求里的 Origin**；没有 `Origin` 直接拒绝。
- **工坊 iframe 是唯一 API 客户端**。宿主（随机域名的云酒馆）不直接调 API，只做显示与 bridge 转发。
- **token 永不跨 origin**。三条交付路径：
  1. 普通浏览器：iframe 自己开弹窗，回调把 token `postMessage` 给同源 opener。
  2. 嵌入（云酒馆，宿主开弹窗）：iframe 生成 `verifier`，服务端存 `challenge`；回调把**一次性 code** 交给宿主，宿主经 bridge 转给 iframe，iframe 用 verifier 换 session。code 单独无用，且有 TTL 与单次兑换。
  3. 移动端/外部浏览器（无 opener）：**设备码流程**，iframe 持有 device secret 并同源轮询。
- 删除“只凭 state 返回 token”的跨站 poll。
- CORS 只回显白名单 origin，不开 `*`；宿主不调 API，因此随机域名不需要 CORS。
- 第三方 iframe 的存储按顶层站点分区，**接受“每个酒馆站点各自登录”**；若将来要求跨站共享登录，必须单独设计顶层登录流程。

### D-11 发布模型

不可变 revision + D1 单指针切换。删除“复制草稿行 + 复制 R2 + 失败回滚”的补偿式发布；R2 对象不可变，孤儿由清理任务回收。

### D-12 数据迁移

新库应用完整编号 migration 链，旧库只读保留；迁移保留选定公开项目 id。只导入当前产品需要的已发布内容及必要作者，校验实际字节、完整索引与关联；不因旧库存在某类数据就恢复对应结构或历史。范围详见 D-39。

### D-13 切换与回滚

一次性切换，旧系统在线到验收完成。停写屏障必须覆盖旧文件 GET 计数与 OAuth 写路径。开放用户写入后**不承诺无损回切旧库**；只回滚代码。

### D-14 搜索与排行

保留中文 FTS 搜索语义（含 1–2 字与标签）、日榜与发现历史、7d/30d 周期排序。只删除确认无生产引用的旧小时榜模块与表。

### D-15 测试

删除断言源码文本的测试。保留 EJS checker 语料、fingerprint、diff、安装安全行为；新增 domain 单测、workerd 集成、API 契约、迁移对账；Playwright 压到 5–8 条真实旅程。

### D-16 产物与发布

构建产物不提交；客户端发布产物上传到 R2，不进仓库；CI 对精确 SHA 构建一次并逐级提升同一 artifact；部署只走 CI；删除 PowerShell 部署器。

### D-17 缓存

切换时所有动态 API `private, no-store`；验收后按 D-28 对公开 GET 与个人 GET 开 Workers Cache。静态资产用内容哈希 + immutable。删除 `caches.default` 与客户端 TTL 缓存。

### D-18 架构骨架

pnpm workspace：`apps/worker`（含 `web/`）+ `apps/tavern-client`（含 `data/`）+ `packages/{contracts,content,domain}` + `config/` + `tools/` + `tests/` + `docs/`。Worker 内 `http → use case → storage`；不设独立 db 包。

### D-19 部署形态：只用 Worker，不用 Pages

- **不存在 Cloudflare Pages 项目**：不创建 Pages 项目、不使用 Pages Functions、不使用 `pages_build_output_dir`、不执行 `wrangler pages deploy`。
- `apps/worker/web` 只是 React + Vite 的源码与构建目录；产物通过**同一个 Worker** 的 Static Assets（`assets.directory`）随 Worker 一起部署。
- 对外只有一个入口 Worker：`/api/*` 走 Hono，其余由 Static Assets 提供；`/api` 未匹配返回 JSON 404。
- 构建产物与 Worker 版本一一对应，回滚 Worker 版本即回滚前端。
- CI 只跑 `wrangler deploy`（或 versions/deployments 流程），不引入第二套托管平台。

### D-20 双产物与目录边界

系统只有两个产物：

1. **Worker**（`apps/worker`）：API + Static Assets。前端源码放在 `apps/worker/web/`，构建产物进入同一个 Worker；不是独立部署物。
2. **Tavern Client**（`apps/tavern-client`）：独立单文件 IIFE，自己的版本号（stable/staging）与发布节奏；只允许依赖 `packages/contracts`、`packages/content`、`packages/domain` 的浏览器安全部分，禁止 import Worker 实现或 Node/Cloudflare 专用模块。

```text
apps/
├─ worker/
│  ├─ src/          # Hono API、storage、jobs
│  ├─ web/          # React + Vite 源码 → Worker Static Assets
│  └─ wrangler.jsonc
└─ tavern-client/   # TH 桥接与安装逻辑 → 单文件产物
packages/{contracts,content,domain}
```

- 一次 Worker 部署发布 API 与 Web；client 产物独立发布到 R2（见 D-22），回滚粒度因此不同。
- client 版本与 Worker 版本独立记录；兼容性由 D-06 的精确匹配门禁保证。
- 测试与 e2e 分开：Worker 走 workerd/HTTP；client 走真实 SillyTavern。
- 该条细化 D-18 的目录骨架，不改变依赖方向与运行时拓扑。

### D-21 客户端产物托管在 R2（独立发版）

> 状态：托管部分已被 D-22 替代（Worker 代理 R2，不使用自定义域/zone）；版本记录仍按本条的 D1 方案。

- **存储**：独立 R2 bucket（例如 `workshop-client`），通过自定义域 `client.<zone>` 公开；不使用 Pages，不额外建 Worker。
- **路径**：
  - `/v/<sha>/index.js`：内容哈希，`Cache-Control: public, max-age=31536000, immutable`。
  - `/stable/index.js`、`/staging/index.js`：稳定指针，`Cache-Control: no-cache` + ETag（或 `max-age=60` 配合 revalidate），保证更新可见。
- **CORS**：对公开脚本允许 `GET` 任意来源（随机酒馆域名），不带 credentials。
- **发布**：上传版本化对象 → 更新稳定指针对象。不需要部署 Worker。
- **版本门禁（D-06 精确匹配）**：Worker 必须在运行时知道当前要求的 client 版本，否则独立发版仍然要改 Worker。做法：当前版本写入 D1 `site_settings`（或同一 R2 的 manifest），Worker 读取并做短缓存（如 60s）；发布脚本同时更新对象与版本记录。
- **旧路径 shim**：由同一个 bucket 提供，保留一个下架周期后删除。
- **回滚**：把稳定指针与版本记录指回上一版本对象，不重建 Worker。

### D-22 客户端分发：Worker 代理 R2 + Workers Cache

替代 D-21 中“R2 自定义域 + zone CDN”的部分。

- **不使用 zone 缓存**，也不给 R2 绑自定义域。`/client/*` 由 Worker 读取 R2 对象后返回。
- 版本化路径 `/client/v/<sha>/index.js`：
  - 浏览器与边缘都 `immutable`，`max-age=31536000`；
  - `Cache-Tag: client:v:<sha>`。
- 稳定指针 `/client/stable/index.js`（以及 `staging`）：
  - 浏览器：`Cache-Control: public, max-age=0, must-revalidate`；
  - 边缘：`Cloudflare-CDN-Cache-Control: max-age=300`，`Cache-Tag: client:stable`；
  - 发布时覆盖对象后 `ctx.cache.purge({ tags: ['client:stable'] })`，不必等 TTL。
- CORS：`Access-Control-Allow-Origin: *`，不带 credentials（随机酒馆域名需要模块 import）。
- 发布顺序：上传版本对象 → 更新 D1 版本记录 → 覆盖稳定对象 → purge tag。
- 回滚：覆盖稳定对象 + 更新记录 + purge。
- 取舍：
  - HIT 时不执行 Worker；MISS 时计一次 Worker 请求。
  - 开启 Workers Cache 后，Web 的 Static Assets 请求也按标准请求计费：Free 上计入 100k/天额度，Paid 上才产生费用。
  - 稳定指针的边缘 TTL 决定“未被 purge 时”的最坏陈旧窗口。

### D-24 Workers Cache 专项设计（重构必做）

Workers Cache 是唯一的边缘缓存层（不使用 zone，不使用 Pages）；Static Assets 的平台缓存只服务静态文件。重构期间必须完成以下研究，产出写回 main.md 并落成测试：

1. **缓存键**：默认键 = entrypoint + path/query + Worker 版本；确认 `Vary`、`ctx.props`、`cross_version_cache` 是否使用（默认不跨版本，部署即清空）。
2. **头策略**：`Cache-Control` 给浏览器、`Cloudflare-CDN-Cache-Control` 给边缘，分离设置；在 staging 实测 `no-store` 与 CDN 头的优先级；禁止无缓存头的 200（会被启发式缓存 2 小时）。
3. **失效**：每个可缓存路由定义 `Cache-Tag`；列出发布、下架、改可见性、审核通过、删除各自的 purge 清单；client 稳定指针单独 tag；评估 Free 的 purge 限额。
4. **并发**：列表/详情在冷启动与发布瞬间依赖请求合并；检查 SWR 期间是否会返回已下架内容。
5. **身份**：确认 `Authorization` 自动 bypass 的边界；个人状态按 D-28 的网关 + `ctx.props` 方案按用户缓存，验证 props 隔离、`Authorization` 剥离与会话撤销。
6. **测量**：staging 统计 MISS/HIT、`Cf-Cache-Status`、D1 rows read 与 CPU，给出目标命中率与回归阈值。
7. **额度**：`cache.enabled` 开启后 Static Assets 计入请求；Free 为 100k/天；给出额度模型与超额降级方案。

**门禁**：上述清单未完成、staging 未跑通前，不把 `cache.enabled` 开到生产。**验收**：每个可缓存 GET 都有显式头、tag 与失效触发；无隐式缓存；下架后一次 purge 内所有边缘不可见。

### D-25 Free 套餐资源预算与实现约束

全部资源按 Cloudflare Free 额度设计，不假设可升级：

| 资源 | Free 额度 | 约束 |
|---|---|---|
| Workers | 100k 请求/天；10ms CPU/请求；3MB 脚本；50 subrequest | 请求是硬上限，超额失败；缓存 HIT 仍计请求 |
| Durable Objects | 100k 请求/天；13k GB-s/天；5GB 存储；30s CPU/请求 | 只用于内容解析/checker；启用 hibernation |
| D1 | 5M rows read/天；100k rows written/天；5GB | 读放大是主要风险 |
| KV | 100k 读/天；1k 写/天；1GB | 新系统不用；版本记录在 D1 |
| R2 | 10GB 存储；1M Class A/月；10M Class B/月；出网免费 | 请求路径禁止 List；发布才写 |
| Workers Cache | 按标准请求计费（HIT 也算） | 省 CPU，不省请求数 |

实现要求：

1. **读预算**：每个公开读请求设 rows read 上限并纳入测试；热路径禁止大范围扫描。**展示型聚合不物化**（总数、分类数、周期统计）：按需查询 + Workers Cache 摊薄，过期重算；只有“每请求必读且必须强一致”的计数（下载、订阅）才用原子增量。物化只用于缓存摊不薄或一致性要求更高的场景。
2. **写预算**：写操作批量、幂等；100k rows/天是硬约束，审核与安装登记不得逐条写。
3. **KV 定位**：新系统不用（版本记录在 D1）；1k 写/天也不足以承载任何用户行为。
4. **R2 定位**：对象按 key 直取；发布时上传，请求路径不 List；公开产物靠 Workers Cache 降 Class B。
5. **DO 定位**：只保留一个；内容解析、checker 复核、发布串行化；不得按页面浏览调用；使用 hibernation，避免空转计费。
6. **CPU**：Worker p95 < 10ms；不做 zip/大文本/循环加密；重活进 DO 或离线 job。
7. **缓存目标**：列表/详情命中率 ≥ 80%；以 `Cf-Cache-Status` 与 D1 rows read 验收。
8. **Cron**：合并 job，按批处理，禁止 per-project 扇出。
9. **压测**：按预期峰值 2 倍跑预算测试；超额路径必须有明确失败语义，不静默降级。

### D-26 前端方向：保留原风格，单屏列表 + 顶部发现栏

本轮只冻结方向与数据契约；具体实现等框架重构完成后进行。

2026-10-23 局部更新：新站精修暗金基调，卡片降低封面占比、重视项目级作者介绍，并采用阴影悬浮、高光及轻微倾斜的视觉方向。卡片视觉部分以[新站视觉方向记录](../../../.agents/notes/in-progress/new-ui-visual-direction.md)为准；其中已确认方向与待试验参数明确分开。该更新同样局部调整 D-27 的封面尺寸约定，不改变数据契约、四项发现栏或后端范围；其余 D-26／D-27 决策仍保留。

- **风格**：保留现有视觉语言，做小改，不重做设计系统。
- **信息架构**：删除发现页；列表页是首屏，也是唯一主屏。顶部是发现栏，细节见 D-27。
- **列表**：桌面一行 4 个；卡片图不使用 1:1，默认 16:9，`object-fit: cover`。
- **卡片字段**：标题、作者头像与名称、`世界书 N 条 | 正则 N 条`、发布时间、上次更新时间、适配版本（世界书 schema，如 `4.3`）、作者一句话介绍、跳转 Discord 帖子的按钮（链接选填）。
- **详情**：右侧栏补充作者一句话介绍与最新更新时间；现有安装/下载操作保留。
- **统计**：footer 与 header 都不放统计（D-27）。
- **响应式**：手机必须可用；断点建议 4 / 3 / 2 / 1 列；参考 NexusMods 的信息密度，不照搬其视觉。
- **数据契约**：上述字段必须进入公开 DTO；作者头像、一句话介绍、Discord 帖子地址、世界书 schema 版本、两类条目计数在发布时写入 release 元数据（版本固有属性，不是聚合统计）。

### D-27 前端细节定稿

- **发现栏**：一行 4 个；按小时固定一组（同一小时内的匿名请求看到同一集合），客户端洗牌；Workers Cache 以小时桶为键缓存 1h，tag `discover`；发布/下架时 purge。
- **适配版本**：显示世界书 schema 版本（如 `4.3`），单一值；本轮不做区间匹配或兼容判断。
- **Discord**：选填；公开字段 `discord_thread_url`；为空不渲染按钮。
- **警告**：只在详情内分组展示，卡片不加角标。
- **已安装/待更新**：由 Tavern client 的本地安装登记与公开版本比较得出，不依赖登录；普通浏览器没有该状态。
- **分页**：每页 24；只显示“第 X–Y 条”，不显示总数。
- **统计**：不展示项目总数、分类数、7d/30d 等统计；周期热度只用于排序/推荐，不进 UI。
- **计数口径**：`世界书 N 条 | 正则 N 条` 取最新已发布 release 的条目数与正则脚本数，发布时写入该 release 记录。
- **图片与头像**：卡片图 16:9；作者头像用 Discord 头像，加载失败回退首字母。
- **响应式**：4 / 3 / 2 / 1 列。

### D-28 公开展示数据与个人状态的 Workers Cache 策略

- **入口拆分**（同一个 Worker）：
  - `default` 网关：`cache.enabled=false`，每个请求都执行鉴权、规范化、路由。
  - `Public`：`cache.enabled=true`，匿名共享缓存。
  - `Viewer`：`cache.enabled=true`，网关鉴权后删除 `Authorization`，通过 `ctx.exports.Viewer.fetch(req, { props: { userId, sessionVersion } })` 调用；`ctx.props` 进入缓存键，按用户隔离。
- **公开范围**：项目列表、详情、发现栏、作者资料、分类、首页，以及其中的下载量/订阅量展示值、封面与画廊图片，走 `Public` 共享缓存；可安装文件不在公开缓存内（D-29）。
- **个人状态**：仍走独立 `/api/v1/me/*`，避免每个项目详情按用户分片；响应按 `userId + sessionVersion` 缓存 15–30s。浏览器侧 `no-store`，边缘 TTL 用 `Cloudflare-CDN-Cache-Control`，优先级在 staging 验证（D-24）。
- **隔离与安全**：
  - props 只由网关设置；禁止把客户端头当作身份来源。
  - 转发前删除 `Authorization`（以及 `Cookie`），否则触发 bypass。
  - `Viewer` 只能经 `ctx.exports` 调用，不可被外部路由直接命中。
  - props 必须包含所有影响响应的身份维度，至少 `userId` 与 `sessionVersion`。
- **失效**：
  - 登出、会话撤销、角色变化：bump `sessionVersion`，键变化使旧条目自然过期，不依赖 purge。
  - 订阅/评分等个人写操作：短 TTL（15–30s），不逐次 purge；必要时按 `viewer:<userId>` 强制失效。
  - 发布、下架、改可见性、删除：`Public` 的 `Cache-Tag` purge。
- **计数分离**：缓存的是展示值；真实值由写路径原子增量维护。下载、订阅动作是 `POST` + `no-store`。
- **计数下载**：票据申请不计数；只有票据消费并成功取得字节后才增量，响应 `no-store`。公开文件若走缓存，则不计入下载量。
- **标签**：`projects`、`project:<id>`、`author:<id>`、`discover:<bucket>`、`taxonomy`、`viewer:<userId>`。
- **TTL 基线**：列表 30s、详情 60s、作者 300s、分类/发现 1h；个人状态 15–30s；均配 `stale-while-revalidate`。
- **禁止**：`Vary: Authorization` 代替 bypass；把 viewer 字段塞进 `Public` 共享缓存；对公开 GET 设置 Cookie；依赖 props 之外的客户端可控头做隔离。

### D-29 登录边界：浏览不需要，写入与个人数据需要

**无需登录**：

- 列表、详情摘要、搜索、筛选、排序、发现栏、Banner、编辑精选、作者筛选列表。
- 公开计数、发布时间/更新时间、世界书 schema 版本、Discord 链接、详情内的 warn。
- “已安装/待更新”高亮：由 Tavern client 的本地安装登记与公开版本比较得出，服务端不要求会话；普通浏览器不显示。

**需要登录**：

- 下载与安装（文件、安装握手、下载计数；包括已批准的 public 项目）。
- 点赞/取消、订阅/取消、私有评分与留言。
- 创建、编辑、删除项目；上传世界书/正则/封面；提交、重新提交。
- 查看自己的审核状态、拒绝原因、草稿与私有项目。
- 我的项目、我的订阅、我的评分。
- 审核队列、批准/拒绝、管理后台、Banner/精选/角色基线登记。
- 每日抽签（入口已收起；是否保留见 Q-10）。
- 登出与会话撤销。

匿名详情不返回文件列表、下载地址与安装入口，只显示摘要与登录提示。

### D-30 元数据检查

- **范围**：创建/修改项目时，检查 title、description、version label、tags/taxonomy、`author_note`、Discord URL、兼容性备注、封面表现（位置/缩放）与封面文件本身。
- **位置**：Worker 内同步执行（元数据小，不进 DO）；封面只验 MIME、大小、尺寸，不解码大图。
- **结果**：
  - `pass`：直接生效；
  - `warn`：生效，并在作者侧标记；
  - `block`：拒绝本次修改并返回 findings，项目保持原状；**不进人工队列**。
- **规则**：长度与控制字符、URL 允许列表（Discord 链接格式）、标签合法性、版本格式、封面类型/尺寸、外链策略、频率限制。
- **审计**：记录 `metadata_checker_revision`、findings、操作者与时间；已批准项目的元数据修改同样走此流程，内容 revision 不变。
- **与内容审核分离**：元数据不进入 `draft → submitted → checking` 状态机；block 是编辑失败，不是提交被拒。

### D-31 Checker 版本策略：玩家版可不同，管理员与 DO 必须一致

- 两个构建独立版本化：
  - `upload-checker`：创作者浏览器预检；gate 只作路由与审计，不信任；
  - `review-checker`：DO 权威复核，也是管理员看到的报告来源。
- 允许 `upload-checker` 与 `review-checker` 的 engine/policy revision 不一致。
- **一致性要求**：同一 submission 的 DO 报告与管理员界面必须使用同一个 `review_checker_revision`。
  - submission 记录该 revision；
  - 管理员默认直接看 DO 报告，不在浏览器另跑一份“权威检查”；
  - 若提供本地重跑，必须加载该 submission 固定的同一 revision，并明确标为辅助结果，不得覆盖 DO 结果。
- 检查器升级：新 submission 用当前 review revision；已提交/待审的保持记录 revision；只有管理员显式重跑才切换并写审计。
- 超时：最多 3 次，超过转人工。

### D-32 前端旧模块处置定稿

- 首页货架改为排序 tab；默认“最近更新”。
- 排序：最近更新、发布时间、下载、点赞；筛选：类型、标签；搜索在 header；删除最低赞/最低下载筛选。
- Banner 保留，压成窄条，位于 header 下、发现栏上。
- 编辑精选只保留数据与后台设置，不做独立区块；后续可作为发现栏的候选来源。
- 每日抽签入口从主 UI 收起，不设 header 入口；接口与配额表暂留；是否保留见 Q-10。
- “已安装/待更新”用 Tavern client 本地状态（D-29），无需登录。
- 点作者名进入该作者的筛选列表，不做作者主页。
- 我的项目/我的订阅从 header 用户菜单进入，复用列表组件。
- 作者一句话介绍为项目级字段 `author_note`，卡片与详情复用；不设作者级 bio。
- 分页 24/页、顺序翻页，只显示 X–Y，不显示总数（D-27）。

### D-33 迁移、抽查与分发定稿

> 抽查要求已由 D-43 删除；旧客户端过渡范围由 D-40 替代。以下不再构成抽查或旧协议兼容任务。

- block 后重提：保留上一轮报告与内容快照，审核详情可对比；重提不再清空历史。
- 自动发布抽查：**已取消，见 D-43**，不实现原抽样规则。
- 兼容截止：删除 tags 镜像、旧订阅 toggle（保留 `PUT` 设置接口）、旧身份/名称解析；旧排名快照与日榜表在确认无读取后删除；旧 client shim 保留一个周期。
- 固定分发：`/client/stable/index.js` 与 `/client/staging/index.js`；版本文件 `/client/v/<sha>/index.js`；旧 jsDelivr 地址显示一次迁移提示，一个周期后下线。

### D-34 删除上传收据（attestation）

- 删除签名收据与二次上传；上传一次完成。
- 服务端校验结构、大小与内容哈希；客户端 gate 仍记录但不信任（D-09）。
- 理由：收据只证明“字节被某个 checker revision 预检过”，不证明 checker 真的运行；权威结论由 DO 的 review checker 给出（D-31）。

### D-35 安装状态、订阅与下载分离

- 安装状态的权威是本地 SillyTavern 世界书条目元数据 + Tavern client 的 `cw_install_registry` 本地缓存；服务端不建 installs 表，也不用服务端记录判断“已安装”。
- 订阅是服务端 `project_subscriptions` 记录的用户意图：表示想继续获取更新，不等于已下载或已安装。
- 下载是取件行为；服务端可保留 `download_events` 的 `user_id`，用于按用户/天幂等计数，但不把它当安装状态，也不向用户暴露下载历史。安装与“我下载了什么”的展示仍以本地为准。
- 客户端在本地合并三类状态：服务端订阅、本地下载记录、本地安装记录；对用户展示“已订阅 / 已安装 / 有更新 / 已取消订阅但本地保留”等状态。
- 取消订阅只移除服务端订阅，不自动删除世界书或正则；卸载必须由用户明确触发。
- 更新／卸载的玩家修改处理已由 D-42 替代，不再沿用默认保留修改规则。
- 参考 Steam Workshop 的职责划分（订阅=意图、下载=传输、安装=本地客户端），但不采用“退订后自动删除本地内容”的行为。

### D-36 审核队列：放宽去重，优先减少 Worker 调用

- 审核台列表只拉 `pending`，默认 20 条；`checking` 只显示计数，不拉列表。
- 列表响应同时返回所有状态的 `counts`（pending/checking/approved/rejected/superseded），一次请求拿到列表和计数。
- 使用 `(submitted_at, id)` keyset cursor；不承诺 snapshot 或跨并发场景的严格无重复/无遗漏。
- 审核台以减少请求为目标：缓存列表与详情/diff、预取下一条；审核成功后本地移除并切到下一条，不重新拉整页。
- 管理端队列保持 `private, no-store`；Workers Cache 只用于公开读接口。
- 服务端仍用条件更新兜底重复审核，不引入 snapshot 存储。

### D-37 缓存阶段：公开投影短 TTL，动态接口保持 no-store

- 当前保留 Workers Cache 仅用于明确标注的公开投影（项目列表/详情/发现/榜单/推荐等），TTL 30 秒，键含 `cache_epoch`；不宣称 tag purge、`Cf-Cache-Status` 或网关级缓存已完成。
- 登录后读取、下载票据/字节、作者、审核、互动写路径全部 `private, no-store`。
- 在 D-24/D-28 验收前不扩大缓存范围，也不把公开计数缓存当作权限或写入判断。
- 客户端/checker 版本化对象使用 immutable 长缓存；channel 指针使用短缓存并回源校验。
- `/api/v1/client/compatibility` 与 `/client/*` 允许 `Access-Control-Allow-Origin: *`：它们无 session、由任意 SillyTavern 页面加载；其余 `/api/*` 继续使用 Origin 白名单。

### D-38 Workers Cache 入口与公开代际

- D-37 中把旧 `caches.default` 称作 Workers Cache 的表述由本决策取代；旧实现不得继续作为新缓存机制。
- 默认 gateway 明确不缓存；仅命名 `Public` entrypoint 使用 Workers Cache，且先只在获授权的 staging／预发配置开启，production 保持关闭。
- gateway 每次公开读取先从 D1 primary 取得公开代际；失败 fail closed。可信代际通过 entrypoint props 参与缓存键，公开状态变更与代际递增同事务。
- Public 内部响应显式 30 秒 TTL、`stale-if-error=0`、不启用 SWR；gateway 对外改写为 `private, no-store`，去除内部 cache/tag 控制头。正确性不依赖 purge 的接受结果。
- 私有、作者、审核、票据与字节路径保持 no-store；不可变版本对象可单独使用 immutable 缓存。当前公开封面按 project-level display association 或发布 revision 的回退引用判定，不按共享 key 任意取第一行。

### D-39 重构数据边界与 schema 收敛

- 旧库不是新模型的需求清单。当前用户旅程、不变量和真实读写决定 schema；无用数据可舍弃，不保留历史兼容壳。
- 只保留一套编号 migrations；`0001` 是历史起点，不是完整当前 schema。新库应用全链，既有库仅应用待执行迁移，不增加平行手写 schema。
- `0021` 删除 7 个死／镜像字段：OAuth `verifier_hash`、revision `facets/custom_tags/metadata`、submission `gate/checker_revision`、人工 review `report`。客户端检查只存 `client_*`；权威报告保留在 `submission_check_runs`，最新报告投影和类型化 metadata 审计仍有业务用途。
- assets 仅允许 worldbook／regex／cover；Discord 头像与站点 Banner 不进入项目资产表。保留共享 R2 key、每 revision/kind 唯一、单独公开封面 association 等现行约束。
- 已发布内容必须具有完整持久索引。保留 `entry_index_ready` 作为显式完整性状态；匿名读取只查 D1，不再通过 DO／R2 兼容历史内容。升级时撤下 ready=0 的旧发布指针并清除其不完整派生索引，内容 revision 留作作者历史；恢复公开需走当前提交路径。
- 此前仅导入公开项目的范围已由 D-40 替代；旧样本导入工具不代表完整迁移方案。完整业务历史与用户关系必须在新模型稳定后映射与对账，不能按旧排除清单丢弃。
- 审计确认现有 28 张业务／索引表均有真实读写；不为“删得多”而删除排行、发现曝光、引用、互动等仍在使用的功能。旧状态枚举的历史容许值不等于新增业务状态；当前状态迁移仍以实际生产路径为准。
- 本地 commit 已获授权，按职责划分；这不授权 push、PR、部署或破坏性远程 D1/R2 操作。

### D-40 完整替代旧版与完整数据迁移

- 新项目完整接替旧版，不接受仅迁公开作品的精简替代。替代 D-12／D-39 中排除业务历史和用户关系的迁移范围；保留单一 migrations、规范化新模型与真实数据校验原则。
- 迁移覆盖项目与必要内容版本、作者归属、草稿、审核／检查历史、互动关系及历史计数、必要权限与站点配置。按旧数据实际结构建立映射与对账；不能因为新导入工具暂不支持就丢弃，无法映射的记录必须列出并解决，不伪造历史。
- 实际数据迁移在功能与逻辑完成后进行；本轮不执行迁移。此前本地／staging 公开项目样本导入不是完整迁移验收。
- 完整业务数据迁移不等于复制旧会话、OAuth 凭据或永久维护旧 schema/API。旧会话不直接充当新会话，权限映射需验证。
- 完成迁移并切换后，旧客户端网页／协议停止服务并要求更新；不维护旧客户端继续安装、更新的兼容 API。替代 D-33 中模糊的“一个周期”窗口，切换仍需另行授权。

### D-41 本机安装实例与兼容边界

- 完整接替旧版本机安装管理：发现本机安装、明确扫描范围与失败项、按位置识别实例，以及正常更新、卸载、迁移和新建／绑定世界书能力。不能用 registry 健康检查冒充全量发现。
- 同一项目在不同世界书／角色位置的安装分别管理，可独立保留版本、更新、卸载与迁移；所有操作明确目标实例。
- 旧格式识别集中在宿主／旧数据适配边界，转换为新版规范实例；不把兼容分支散入业务，不恢复服务端 installs 权威。
- 只接管可明确识别的旧内容。存疑内容列出位置与原因，引导用户卸载后重新下载；不提供人工认领、补标记、原地改写来猜测或修复身份，不仅凭名称匹配接管。
- D-35 的本机权威、订阅／下载／安装分离与退订不自动卸载仍保留。

### D-42 玩家修改：先看 diff，再整体操作

- 更新或卸载发现玩家修改，必须指出修改内容并提供 diff 界面，确认下一步后才能写入；取消则不写入。
- 确认更新执行所选实例的整体替换；确认卸载执行所选实例所属内容的整体删除。不做逐条合并、部分保留，也不默认保留修改条目。替代 D-35 中沿用旧保留修改规则的约束。
- “整体”不是删除整本世界书或角色全部正则；无法可靠判定归属的内容不得自动删除。
- 确认绑定预览时的实例与内容状态；确认后状态变化必须重新读取并重新核对，不能使用过期 diff 执行破坏性动作。

### D-43 统一提交与自动审核流程，无抽查

- 元数据、封面和内容合并成一次提交；替代 D-30 的独立公开展示即时修改路线。元数据也要审核，不能直接覆盖公开资料；修改待审资料／内容须产生替代提交、重新检查，旧公开快照不受影响。
- 作者浏览器运行作者侧检查并反馈 pass／warn／block；作者可修改后提交，也可无视反馈直接提交，携带检查标记。作者侧 block 不是禁止提交。
- 作者侧 block 或缺少检查标记直接进入人工队列；pass／warn 进入云端侧检查。云端侧脚本与作者侧独立，云端 pass／warn 自动发布，block 转人工。检查失败／超时按既有重试与人工兜底，不能冒充通过。
- 人工审核可主动运行与云端一致的审查脚本，也可不运行而直接作决定；保留 D-31 的固定检查版本、精确快照及证据绑定，不把主动重检变成必需步骤。
- 没有自动拒绝。**删除 D-33 的自动发布抽查要求**：不保留抽查队列、抽样规则、强制抽查分支或验收项。首次投稿、超大文件、含外链不因此额外抽查。
- 格式／请求合法性校验仍与内容审核区分，不因允许作者提交 block 就允许非法请求绕过校验。
- 允许撤回尚未发布的待审提交，保留提交、检查与审核历史；正在运行的检查完成后也不得发布已撤回／被替代快照，旧公开版本不受影响。

### D-44 所有项目排序与周期计数

- 支持最新发布、最新更新、最多点赞、最多下载。后两项可组合全部时间、最近 7／30／90 天；是窗口内互动量，不是按项目发布年龄过滤。
- 周期点赞采用净增量：窗口内点赞 +1、取消点赞 −1，包括取消窗口之前的点赞，允许负分。幂等设置不得重复计事件；不采用“新增且仍有效点赞”口径。
- 周期下载按窗口内有效下载计数，延续成功消费与计量的既有边界。排序、过滤和分页作用于完整结果集，不在当前页前端重排。
- 发现逻辑后续重做，不要求保留旧发现／排行接口；现有发现栏外观保持。替代 D-14／D-27／D-32 中相冲突的旧接口与周期范围约束。
- 不刻意建立统计仪表盘，但允许自然展示必要统计，如分页旁“共 N 个项目，当前显示 X–Y”，总数须对应当前筛选结果。替代禁止总数展示的旧约束；页码交互与后端分页契约需一起设计，不能伪造可跳页能力。

### D-45 配套脚本后端版本推送

- 提供配套脚本的后端版本推送 API 与方便调用的推送工具／命令，明确授权、版本标识与输入契约；前端展示与健康检查面板先不做。局部替代 D-08 的整体移除范围。
- 此“推送”是版本登记／发布，不是主动通知用户；不扩大为站外通知或任意远程脚本执行。

### D-46 界面组织与既定视觉边界

- 保持已确认卡片／列表展示；顶栏和侧栏采用结构式布局，不做悬浮卡片容器；发现栏保持当前表现。替代 D-26／D-27／D-32 中过时的固定列数、图片比例、每页 24 等视觉限制，以现有确认界面为对照，不重新推翻。
- 审核等独立任务采用旧版页面内独立弹层的组织原则，保持浏览上下文与返回路径；不是新增浏览器 window.open，也不是全站重新卡片化。
- 作者索引、草稿／提交历史等新能力保留；资料与内容合并送审不等于删除历史或回退旧实现。
- 审核完整内容／变化阅读、编辑未保存保护、独立长文阅读、管理工具分区、手机任务层作为下一步改造工作；未经运行验收不标为完成。

### D-47 继续有效与暂缓范围

- 公开／私有两态，不增 unlisted，不为此新增详情 URL。D-03／D-29 登录边界保留：匿名摘要／索引，完整内容、下载、安装和个人操作需登录。
- D-06 当前 channel 精确版本门禁保留；“兼容旧安装数据”不等于放行旧客户端。作者／云端 checker 分离继续按 D-31。
- 站外通知指 Discord 私信／机器人、邮件、Web Push 等离开工坊后主动投递；目前不新增。工坊订阅更新提示与酒馆内提醒不因此被禁止，但未确认的扩展不自动加入本轮。
- 每日抽签继续暂缓；作者主页等未经确认的新扩展不加入当前工作，也不能标成永久取消。

---

## 待定

| ID | 问题 | 现状/默认 | 需要谁定 |
|---|---|---|---|
| Q-10 | 每日抽签是否保留 | UI 入口已收起；接口与配额表暂留；已暂缓 | 产品 |

Q-05 已定：见 D-35。Q-06 已定：见 D-36。

---

## 被替代

> S-xx 是被放弃的早期提案，不是有效决策编号；有效决策只有 D-xx。

| ID | 原提案 | 替代 |
|---|---|---|
| S-01 | 使用 jsDelivr `@tag` 分发（早期建议） | D-05 固定地址 |
| S-02 | 启用 `client.minimum`（早期建议） | D-06 精确匹配 |
| S-03 | 嵌入模式用 BroadcastChannel/localStorage 交付 token（讨论稿） | D-10 一次性 code + verifier |
| S-04 | 客户端 block 仍跑 DO 生成报告（讨论稿） | D-09 不跑 DO |
| S-05 | R2 自定义域 + zone CDN 分发 client（早期托管方案） | D-22 Worker 代理 + Workers Cache |

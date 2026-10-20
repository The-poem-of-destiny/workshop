# 决策记录（唯一来源）

本文件是重构决策的**唯一事实来源**。其他文档（`main.md`、`features.md`、`patch-audit.md`）只引用 ID，不再维护副本。  
状态：`生效` / `待定` / `被替代`。新增决策追加编号，不重排历史。

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

使用**固定地址**，由 Worker / Static Assets 提供（`/client/...`），服务端控制版本与缓存头，不使用 jsDelivr `@main` 或 `@tag`。静态资源请求默认免费并可被 CDN 缓存。

### D-06 客户端版本门禁

**精确匹配**当前 channel 版本（`stable` / `staging`）。版本不一致时阻止安装/更新/修复，并提示更新。`client.minimum` 不恢复。

### D-07 站外通知

不做。未来可能在 tavern-client 侧实现，不在本轮范围。

### D-08 配套脚本展示

移除工坊内的配套脚本展示与版本健康检查（角色管理库、美化器等）。记录：未来可能统一到某个地方。

### D-09 审核路由

- 客户端上传前检查：结果**记录但不信任**（`gate + checker revision + warning count + 作者确认 + 时间`），只作路由与审计。
- 客户端 `pass/warn` → 进入 DO 自动检查；客户端 `block` 或**缺少标记** → 直接人工，**不跑 DO**。
- DO 自动检查：`pass` 自动发布；`warn` 自动发布并显示警告标记；`block` 转人工。
- **没有自动拒绝**：自动检查只决定“发布 / 转人工”，拒绝只能由人做。
- 超时重试，达到上限转人工，不能静默跳过。
- 审核者浏览器检查：**一票生效**，通过即发布、失败即拒绝；结果绑定 `submission_id + content_hash + checker_revision`。
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

新库从 `0001_initial.sql` 重建，旧库只读保留；迁移保留公开项目 id；逐表映射 + 对账；迁移工具幂等。

### D-13 切换与回滚

一次性切换，旧系统在线到验收完成。停写屏障必须覆盖旧文件 GET 计数与 OAuth 写路径。开放用户写入后**不承诺无损回切旧库**；只回滚代码。

### D-14 搜索与排行

保留中文 FTS 搜索语义（含 1–2 字与标签）、日榜与发现历史、7d/30d 周期排序。只删除确认无生产引用的旧小时榜模块与表。

### D-15 测试

删除断言源码文本的测试。保留 EJS checker 语料、fingerprint、diff、安装安全行为；新增 domain 单测、workerd 集成、API 契约、迁移对账；Playwright 压到 5–8 条真实旅程。

### D-16 产物与发布

构建产物不提交（客户端 release 产物例外）；CI 对精确 SHA 构建一次并逐级提升同一 artifact；部署只走 CI；删除 PowerShell 部署器。

### D-17 缓存

切换时所有动态 API `private, no-store`；验收后再对 viewer-neutral 公开 GET 开 Workers Cache。静态资产用内容哈希 + immutable。删除 `caches.default` 与客户端 TTL 缓存。

### D-18 架构骨架

pnpm workspace：`apps/{worker,web,tavern-client}` + `packages/{contracts,content,domain}` + `config/` + `data/` + `tools/` + `tests/` + `docs/`。Worker 内 `http → use case → storage`；不设独立 db 包。

### D-19 部署形态：只用 Worker，不用 Pages

- **不存在 Cloudflare Pages 项目**：不创建 Pages 项目、不使用 Pages Functions、不使用 `pages_build_output_dir`、不执行 `wrangler pages deploy`。
- `apps/web` 只是 React + Vite 的源码与构建目录；产物通过**同一个 Worker** 的 Static Assets（`assets.directory`）随 Worker 一起部署。
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

- 一次 Worker 部署发布 API 与 Web；client 产物独立发布到 R2（见 D-21），回滚粒度因此不同。
- client 版本与 Worker 版本独立记录；兼容性由 D-06 的精确匹配门禁保证。
- 测试与 e2e 分开：Worker 走 workerd/HTTP；client 走真实 SillyTavern。
- 该条细化 D-18 的目录骨架，不改变依赖方向与运行时拓扑。

### D-21 客户端产物托管在 R2（独立发版）

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
5. **身份**：确认 `Authorization` 自动 bypass 的边界；同一 URL 对匿名与登录返回不同内容时，禁止把 viewer 状态写进共享缓存。
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
| KV | 100k 读/天；1k 写/天；1GB | 只放配置/版本记录，绝不做计数 |
| R2 | 10GB 存储；1M Class A/月；10M Class B/月；出网免费 | 请求路径禁止 List；发布才写 |
| Workers Cache | 按标准请求计费（HIT 也算） | 省 CPU，不省请求数 |

实现要求：

1. **读预算**：每个公开读请求设 rows read 上限并纳入测试；热路径禁止大范围扫描。**展示型聚合不物化**（总数、分类数、周期统计）：按需查询 + Workers Cache 摊薄，过期重算；只有“每请求必读且必须强一致”的计数（下载、订阅）才用原子增量。物化只用于缓存摊不薄或一致性要求更高的场景。
2. **写预算**：写操作批量、幂等；100k rows/天是硬约束，审核与安装登记不得逐条写。
3. **KV 定位**：只存低频配置；1k 写/天意味着任何用户行为都不能写 KV。
4. **R2 定位**：对象按 key 直取；发布时上传，请求路径不 List；公开产物靠 Workers Cache 降 Class B。
5. **DO 定位**：只保留一个；内容解析、checker 复核、发布串行化；不得按页面浏览调用；使用 hibernation，避免空转计费。
6. **CPU**：Worker p95 < 10ms；不做 zip/大文本/循环加密；重活进 DO 或离线 job。
7. **缓存目标**：列表/详情命中率 ≥ 80%；以 `Cf-Cache-Status` 与 D1 rows read 验收。
8. **Cron**：合并 job，按批处理，禁止 per-project 扇出。
9. **压测**：按预期峰值 2 倍跑预算测试；超额路径必须有明确失败语义，不静默降级。

### D-26 前端方向：保留原风格，单屏列表 + 顶部发现栏

本轮只冻结方向与数据契约；具体实现等框架重构完成后进行。

- **风格**：保留现有视觉语言，做小改，不重做设计系统。
- **信息架构**：删除发现页；列表页是首屏，也是唯一主屏。顶部是一个“发现”栏目：一行 4 个，按小时固定一组，客户端洗牌（D-27）。
- **列表**：桌面一行 4 个；卡片图不使用 1:1，默认 16:9，`object-fit: cover`。
- **卡片字段**：标题、作者头像与名称、`世界书 N 条 | 正则 N 条`、发布时间、上次更新时间、适配版本（世界书 schema，如 `4.3`）、作者一句话介绍、跳转 Discord 帖子的按钮（链接选填）。
- **详情**：右侧栏补充作者一句话介绍与最新更新时间；现有安装/下载操作保留。
- **统计**：列表底部统计删除；header 也不放统计；列表区只显示“第 X–Y 条”，不显示总数。
- **响应式**：手机必须可用；断点建议 4 / 3 / 2 / 1 列；参考 NexusMods 的信息密度，不照搬其视觉。
- **数据契约**：上述字段必须进入公开 DTO；作者头像、一句话介绍、Discord 帖子地址、世界书 schema 版本、两类条目计数在发布时写入 release 元数据（版本固有属性，不是聚合统计）。

### D-27 前端细节定稿

- **发现栏**：一行 4 个；按小时固定一组（同一小时内的匿名请求看到同一集合），客户端洗牌；Workers Cache 以小时桶为键缓存 1h，tag `discover`；发布/下架时 purge。
- **适配版本**：显示世界书 schema 版本（如 `4.3`），单一值；本轮不做区间匹配或兼容判断。
- **Discord**：选填；公开字段 `discord_thread_url`；为空不渲染按钮。
- **分页**：每页 24；只显示“第 X–Y 条”，不显示总数。
- **统计**：不展示项目总数、分类数、7d/30d 等统计；周期热度只用于排序/推荐，不进 UI。
- **计数口径**：`世界书 N 条 | 正则 N 条` 取最新已发布 release 的条目数与正则脚本数，发布时写入该 release 记录。
- **图片与头像**：卡片图 16:9；作者头像用 Discord 头像，加载失败回退首字母。
- **响应式**：4 / 3 / 2 / 1 列。

---

## 待定

| ID | 问题 | 现状/默认 | 需要谁定 |
|---|---|---|---|
| Q-01 | DO 检查超时上限次数 | 建议 3 次 | 产品 |
| Q-02 | warn 的展示层级 | 卡片角标 + 详情分组；是否可按规则筛选 | 产品/设计 |
| Q-03 | block 后重新提交是否保留上一轮报告 | 建议保留供对比 | 产品 |
| Q-04 | 元数据修改是否仍需审核 | 新审核模型只覆盖内容；元数据默认 schema 校验 | 产品 |
| Q-05 | 安装状态的权威记录 | D1 行 / 条目内单一记录 / registry 降级为缓存，三者选一 | 技术 |
| Q-06 | 审核队列读取契约 | 稳定 cursor 或短期 snapshot | 技术 |
| Q-07 | 兼容截止清单 | 哪些旧格式在切换时彻底消失（tags 镜像、订阅 toggle、旧排名、旧 shim、旧身份解析） | 产品+技术 |
| Q-08 | 自动发布后的抽查/滥用策略 | 默认不抽查；是否对首次投稿/超大文件/含外链做抽样 | 产品 |
| Q-09 | 固定分发地址的路径与迁移方式 | 如 `/client/latest.js` + 版本化文件；旧地址如何提示一次迁移 | 技术 |

---

## 被替代

| ID | 原决策 | 替代 |
|---|---|---|
| D-19 | 使用 jsDelivr `@tag` 分发（早期建议） | D-05 固定地址 |
| D-20 | 启用 `client.minimum`（早期建议） | D-06 精确匹配 |
| D-21 | 嵌入模式用 BroadcastChannel/localStorage 交付 token（讨论稿） | D-10 一次性 code + verifier |
| D-22 | 客户端 block 仍跑 DO 生成报告（讨论稿） | D-09 不跑 DO |
| D-23 | R2 自定义域 + zone CDN 分发 client（D-21） | D-22 Worker 代理 + Workers Cache |

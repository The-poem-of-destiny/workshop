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

- 一次 Worker 部署同时发布 API、Web 与 client 文件；回滚 Worker 版本即整体回滚。
- client 版本与 Worker 版本独立记录；兼容性由 D-06 的精确匹配门禁保证。
- 测试与 e2e 分开：Worker 走 workerd/HTTP；client 走真实 SillyTavern。
- 该条细化 D-18 的目录骨架，不改变依赖方向与运行时拓扑。

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

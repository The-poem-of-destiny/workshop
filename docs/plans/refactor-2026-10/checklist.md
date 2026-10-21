# Creative Workshop 重构 Checklist

更新：2026-10-21  
状态口径：`[x]` = 当前代码有实现且已有可运行证据；`[ ]` = 未完成（即使已有部分代码也不勾）。  
上线门槛：**所有 `[ ]` 关闭**，并且生产切换由人工审批。勾选不代表可以上线；本文件全部勾选才是。

## 0. 文档与仓库

- [x] 单一 `decisions.md` 作为决策源。
- [x] `features.md` 功能清单与 `main.md` 架构方案保留。
- [x] 删除原始 model 方案；历史材料移入 `archive/` 并由 `archive/README.md` 标注非事实来源。
- [x] pnpm workspace、单 lockfile、Node 版本与 CI 入口。
- [x] `pnpm check` 覆盖 workspace、strict typecheck、worker/domain 测试、schema、迁移测试、wrangler dry-run。
- [x] 删除旧 `cloudflare/`、旧 E2E/Playwright、PowerShell 部署器、提交的 `dist/`/`test-bundles/`。
- [ ] CI 对精确 SHA 构建一次并逐级提升同一 artifact（当前 deploy 每次重装/重建）。
- [ ] 部署流水线包含 D1 migration、artifact hash、Worker version 记录。

## 1. 平台与数据模型

- [x] 单 Worker + Static Assets；`/api/*` JSON 404 不被 SPA 吞。
- [x] `apps/worker/migrations/0001_initial.sql` 基线表、外键、FTS 表与触发器。
- [x] workerd + 本地 D1/R2 集成测试。
- [ ] `ContentService` Durable Object（D-01）。
- [ ] `scheduled`/cron 入口（榜单、周期快照、清理、自动审核）。
- [ ] 项目版本标签字段（schema/contracts/API/客户端）。
- [ ] 元数据检查字段与 findings（D-30）。
- [ ] 客户端版本记录表 / channel 指针。
- [ ] avatar/banner 上传与 `assets.kind` 的写入路径；当前只有 worldbook/regex/cover。

## 2. 认证与权限

- [x] 角色存 `users.role`，每请求查库；owner 保护；会话撤销。
- [x] `POST/GET /auth/flows`、Origin 白名单、D1 flow。
- [x] `GET /me`、`DELETE /sessions/current`。
- [ ] Discord callback / `POST /auth/flows/:id/redeem` / 设备码。
- [ ] 生产 session 创建、30 天滑动过期（`touchSession` 未使用）。
- [ ] PKCE verifier 可兑换；当前服务端 verifier 只存 hash 且不返回。
- [ ] 公会准入 `ALLOWED_GUILD_IDS`。
- [ ] CORS 允许列表与 CSP；当前只有安全头。
- [ ] `oauth_flows.origin` 与 D-10“不存储请求 Origin”的口径统一。

## 3. 公开读、搜索与发现

- [x] 公开 list/detail/home/recommendations/reference-sets/site。
- [x] 详情匿名摘要；manifest/files 需登录。
- [x] FTS trigram（≥3 字）。
- [ ] 1–2 字搜索走 `project_search_short MATCH`（当前 `LIKE`）。
- [ ] 标签筛选、作者筛选。
- [ ] API 默认 24/页；统一 cursor/nextCursor 契约。
- [ ] Web 分页/加载更多与“第 X–Y 条”。
- [ ] 发现栏小时桶 + `discovery_exposures`。
- [ ] 7d/30d 周期热度排序与快照。
- [ ] reference version items + hash 指纹（B10/C11）。
- [ ] 每日抽签接口（Q-10 决定后再做）。

## 4. 创作与内容

- [x] 创建项目、两态可见性、CAS 更新。
- [x] 不可变 revision、worldbook/regex/cover 上传、冻结、submit。
- [x] 作者私有 draft 摘要。
- [x] 单次上传；attestation/二次上传已删除。
- [ ] 上传/提交调用 `validateProjectContentText` 与 `validateProjectContentPolicy`。
- [ ] 空世界书/非法 JSON/项目类型不匹配内容拒绝。
- [ ] 元数据检查：长度、控制字符、版本格式、封面尺寸、频率、审计。
- [ ] Discord 线程 URL host/guild/path 白名单。
- [ ] 单条目删除生成新 revision。
- [ ] 项目软删 `DELETE /projects/:id` + 清理任务。
- [ ] 拒绝原因必填并对作者可见。
- [ ] `GET /me/projects`、`GET /me/subscriptions`。
- [ ] 兼容性元数据、安装注意事项、原版冲突选择、发布前引用检查。
- [ ] 封面位置/缩放字段与 UI。

## 5. Checker

- [ ] 从 `2aa31fb^` 移植 checker 源码到 `packages/content`。
- [ ] L1–L7 组合兼容规则。
- [ ] M1–M5 能力/风险规则。
- [ ] U2–U5 外链/媒体规则。
- [ ] API1–API2 规则。
- [ ] AH1–AH4 提示规则。
- [ ] EJS-PARSE / JS-PARSE / FILE / CHECKER-INTERNAL / CHECKER-LIMIT。
- [ ] 预算：2000 条目、500 单元、20 万字符、4 万/10 万 AST、120s。
- [ ] upload-checker 与 review-checker bundle、`?v=` immutable 缓存。
- [ ] 上传端记录 client gate / warning count / acknowledged / checked_at。
- [ ] DO 权威复核；pass/warn 自动发布，block/missing/超时转人工。
- [ ] 审核绑定 `submission + content hash + checker revision`；本地重跑同 revision。
- [ ] 报告、fingerprint、diff、baseline、accepted/changed/new/removed。
- [ ] checker 语料/behavior test（T2）。

## 6. 审核与发布

- [x] 审核队列/详情、批准/拒绝、单 batch 切 published 指针。
- [x] 角色变更、最后 owner 保护、审计写入。
- [ ] `GET /admin/audit-events`。
- [ ] 审核详情读取 cover 文件；worldbook/regex 条目级 diff。
- [ ] 拒绝理由必填并写审计。
- [ ] 审核 request 不得覆盖 submission `checker_revision`（D-31）。
- [ ] 自动结果与人工结果都写审计；人工覆盖自动结果写理由。
- [ ] 审核队列稳定 cursor / 筛选 / 排序（Q-06 决定后）。
- [ ] 管理项目列表过滤已删除项目并支持筛选。

## 7. 互动与下载

- [x] 点赞/订阅/评分幂等；评分仅本人可见。
- [x] 下载计数按 user/project/day 幂等，触发器原子增量。
- [ ] `POST /downloads` 返回一次性地址或 302；文件路由消费 token。
- [ ] 公开计数/周期计数的展示口径与 D-27 对齐。

## 8. 客户端与分发

- [ ] `apps/tavern-client`（D-20）；旧 `src/CreativeWorkshop` 迁移或明确停用。
- [ ] `/client/*` Worker 代理 R2、stable/staging 指针、版本化对象。
- [ ] 客户端版本记录 + 精确 channel 门禁（D-06）。
- [ ] 旧客户端兼容：`/api/projects/:id`、`/api/files/*` 映射到新 release，或迁移提示。
- [ ] `test-dist` shim 由新 Worker 服务或按窗口删除。
- [ ] D-08：移除配套脚本展示/依赖健康检查（config + bridge + service）。
- [ ] 固定导入 URL、Workers Cache、Cache-Tag/purge（D-22）。
- [ ] 真实 SillyTavern 安装/更新/修复旅程。

## 9. 管理后台

- [x] 项目列表、成员列表、角色修改、审核队列。
- [ ] 站点设置写接口（`PUT /site`）。
- [ ] Banner 上传与位置/缩放设置。
- [ ] 编辑精选写入/删除。
- [ ] 角色引用 set/version/items 登记。
- [ ] 审计日志读取。
- [ ] 管理端权限与操作审计覆盖所有写接口。

## 10. Web UI

- [x] 公开单屏列表、详情侧栏、搜索框、4/3/2/1 响应式。
- [ ] 排序 tab 在默认视图生效（当前无搜索时渲染 `home.latest`）。
- [ ] 发现栏、分页、作者筛选、“我的项目/订阅”。
- [ ] 登录态、作者创建/编辑/上传/提交后台。
- [ ] 审核队列/详情/批准拒绝后台。
- [ ] Toast、弹窗集合、警告标记、Discord 按钮、Banner 位置缩放。
- [ ] 卡片作者头像/时间/一句话/更新时间；详情作者介绍。

## 11. 缓存、调度与运维

- [x] 第一阶段动态 API `private, no-store`；文件/审核文件 no-store。
- [ ] 静态资产 immutable；封面缓存策略与内容哈希。
- [ ] D-24/D-28 Workers Cache 专项、Cache-Tag/purge、`Cf-Cache-Status` 测量。
- [ ] cron：榜单、7d/30d、清理、过期 session、自动审核。
- [ ] 可观测性采样率；错误不采样。
- [ ] 定期备份与校验（J6）。
- [ ] D1 rows read/write 预算测试（J7）。

## 12. 测试、迁移与上线

- [x] 26 个 worker 集成测试、3 个 domain 测试、schema 校验。
- [x] 迁移 synthetic + SQL converter 测试。
- [x] 真实备份全量两次 + delta + reconcile；隔离本地 D1 load。
- [x] 本地 HTTP E2E 10/10；本地浏览器 UI 冒烟。
- [x] staging 部署、D1 migration、5xx 冒烟、回滚/恢复演练。
- [ ] R2 批量复制适配器；staging 真实数据导入。
- [ ] T3 fingerprint/diff/安装安全测试。
- [ ] T6 旧公开 API 样本契约测试。
- [ ] Playwright 5–8 条真实旅程。
- [ ] 生产切换 runbook 执行与人工审批。
- [ ] 生产旧库只读保留、回滚窗口、监控指标演练。

## 上线判定

只有同时满足以下条件才可勾选“可上线”：

- 第 2、5、8、9、10、11 节无未完成项。
- 第 4、6 节无未完成项。
- 第 12 节的生产切换项由人工完成并记录 Worker version、commit SHA、migration 列表。
- `pnpm check`、E2E、staging 冒烟全绿。

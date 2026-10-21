# 完成度审计清单

更新：2026-10-21  
性质：本轮 goal 的可勾选审计源。`[x]` 只表示当前代码/命令有证据；`[ ]` 未完成；`[~]` 已记录并跳过（需用户、外部环境或产品决策）。

## 0. 验收门槛

- [x] `pnpm check` 退出码 0。
- [x] `pnpm --filter @workshop/worker test` 全绿（83/83）。
- [x] `pnpm e2e:local` 全绿（21/21）。
- [~] 关键前端页面有截图（`screenshots/`）；截图已生成，需人工视觉签收。
- [~] 其余代码可执行项见未勾选项；本轮未完成项已列在第 7 节。
- [x] 不进行 production 部署，不创建 `v*` tag。

## 1. API 与领域

### 1.1 状态归属与协议

- [x] 只保留一套内容获取协议：授权 release → 单次下载计数 → 短时票据 → 取字节；移除 `GET /projects/:id/install` 的内联原文传输和旁路计数。
- [x] 获取协议强制校验 `X-Client-Channel` + `X-Client-Version`，缺省不得视为兼容；manifest 不成为旁路。
- [x] 审核队列默认且只返回 `pending`；`checking` 只出现在 counts；历史提交另设显式查询。
- [x] 审核队列响应同时返回全部状态 counts（D-36）。
- [x] 审核队列使用 `(submitted_at,id)` keyset cursor。
- [x] 公开项目列表改为固定 24 条 + keyset cursor，不再用 offset 伪装 cursor。
- [x] 匿名 `entries` 索引在 revision 冻结时生成并持久化，不在读路径解析 R2 原文。
- [x] 删除条目时复用不可变 R2 对象，不复制全部保留资产。
- [ ] 所有外部请求/响应进入 `packages/contracts`，Web 不再维护平行 DTO。
- [x] 412 响应带 `resource/expectedVersion/currentVersion`，区分 409 状态机冲突。
- [x] 选择并记录动态 API 缓存阶段：在 D-24 验收前保持 `private,no-store`，或完成 gateway/Public/Viewer 与 tag purge。
- [x] 参考集详情使用单资源查询，不再全量读取后过滤。

### 1.2 安全与一致性

- [x] Origin 白名单、session HMAC、OAuth flow/state/PKCE/guild/role 校验。
- [x] `/api/v1/client/compatibility` 的 `Access-Control-Allow-Origin: *` 与全局 CORS 模型统一，并在文档中标明边界。
- [x] 下载计数在字节成功返回时发生；失败或仅申请票据不计数。
- [x] 公开计数明确为展示投影，TTL/SWR 与个人写路径分离。

## 2. 前端与交互

### 2.1 信息架构

- [x] 首页只保留一个 4 卡发现栏；删除“最新上架/编辑精选/周热度”重复货架；主列表是唯一内容主屏。
- [x] Banner 压成 header 下的窄条，桌面约 72–104px，移动约 64–88px。
- [x] 列表范围显示真实 `X–Y`，筛选/分页变化后重置；固定 24 条或明确顺序分页，不混用无限加载和页码语义。
- [x] 卡片提供条件 Discord 操作；详情提供明确 secondary 操作，不把链接混入说明段落。

### 2.2 详情与无障碍

- [x] 详情为 dialog：`role=dialog`、`aria-modal`、`aria-labelledby`、Escape、焦点陷阱、关闭后焦点回到触发卡片。
- [x] 桌面为右侧 sheet + backdrop；移动为全屏 dialog。
- [x] 详情按作者说明、注意事项、版本信息分组，并展示安装/下载状态。
- [x] 全局 toast 使用 `role=status`/`role=alert`，可关闭，不占 header 流。

### 2.3 视觉语言

- [x] 语义 token：action（蓝）、warm（金）、surface 0/1/2、border subtle/strong、success/warning/danger、elevation。
- [x] 主操作实心蓝；金色只做身份/强调；危险操作独立样式。
- [x] 统一 `:focus-visible`、160ms transition、`prefers-reduced-motion`。
- [x] 卡片/panel/queue row 形成明确层级，不再是同一种描边盒子。
- [x] 嵌入密度：shell 16px、标题 24–28px；普通浏览器可稍大。

### 2.4 功能旅程

- [x] 安装状态区分 `notInstalled / upToDate / updateAvailable / localChanged / scanIncomplete`；客户端上下文上报扫描状态。
- [x] 详情提供幂等点赞/订阅；个人状态通过 `/me/state` 单独读取。
- [x] 登录支持 browser popup；嵌入模式使用 device flow 轮询/兑换，不依赖 opener。
- [x] 创作 preflight 显示真实状态（无本地文件/检查中/pass/warn/block），提交仍按同一结果派生。
- [x] 审核详情结构化展示 report/gate/findings/diff，原始 JSON 折叠。

## 3. 客户端与本地状态

- [x] 修复 staging 客户端被识别为 stable：channel 在模块初始化时捕获并由 iframe 显式传递。
- [x] Web 安装请求使用显式 channel，不从 `location.pathname` 推断。
- [x] 本地记录 downloaded/installed/updateAvailable；服务端订阅与本地扫描状态在详情合并展示。
- [~] 更新旅程已比较本地 revision/hash 并保留修改；独立“修复”入口未实现，需真实 ST 验收。
- [x] 卸载保留或显式确认玩家修改条目，regex 同样处理。
- [~] 真实 SillyTavern 安装/更新/修复验收：需要运行中的 ST 与测试角色。

## 4. 数据、分发与运维

- [x] D-35：服务端不建 install 表；订阅、下载事件、安装状态分离。
- [x] `download_events` 保留 `user_id` 做 user/project/day 幂等计数，不作为安装状态。
- [x] `download_events` 计数时机与获取协议统一（见 1.2）。
- [x] 审核队列表索引补齐 `(status, submitted_at, id)` 或由 query-plan 证据证明无需。
- [~] 客户端 artifact 进入 CI build-once / promotion：需要发布凭据与生产审批。
- [~] D-24/D-28 tag purge 与 `Cf-Cache-Status` 实测：需要 staging zone/token。
- [~] 定期备份、R2 资产备份、生产回滚演练：需要生产授权/外部保留策略。
- [~] staging 真实数据导入与独立 reconcile：需要目标授权。

## 5. 文档与需求

- [x] API 设计文档包含用户旅程、不变量、状态归属、缓存层、一致性边界、端点推导。
- [~] 需求/功能文档与实现一致；本轮已修正 README、checklist、API 文档中的过期路由/货架/计数描述，其余历史条目随实现逐个清理。
- [x] 本轮跳过的重大决策写入 decision log，附选项/影响/建议。

## 6. 本轮执行记录

- 起始：`work` @ `19a069e`，PR #22。
- 审计输入：API/前端/客户端三份只读审计；现有 checklist/decisions/state。

## 7. 本轮证据（2026-10-22）

- `pnpm check`：通过（workspace、Biome、类型、单测、schema、迁移/备份、wrangler dry-run）。
- `pnpm --filter @workshop/worker test`：83/83。
- `pnpm e2e:local`：21/21；含桌面/移动浏览、详情、详情互动、作者工作区、审核、管理。
- 截图：`docs/plans/refactor-2026-10/screenshots/`。
- 获取协议：`POST /api/v1/projects/:id/acquisitions`；`GET /projects/:id/install` 已删除；票据消费时计数。
- 公开目录：固定 24 + keyset；无效 cursor 返回 400。
- 条目索引：`revision_entry_index`，提交冻结时写入；旧数据读路径回退解析。
- 缓存阶段：D-37。
- 未完成/延期：R2 保留资产复用、Web DTO 统一、本地下载/安装账本、嵌入/设备登录、真实 ST 验收、CI build-once、生产备份演练。

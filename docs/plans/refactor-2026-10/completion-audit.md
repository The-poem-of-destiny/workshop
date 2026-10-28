# 完成度审计清单

更新：2026-10-21  
性质：本轮 goal 的可勾选审计源。`[x]` 只表示当前代码/命令有证据；`[ ]` 未完成；`[~]` 已记录并跳过（需用户、外部环境或产品决策）。

## 0. 验收门槛

- [x] `pnpm check` 退出码 0。
- [x] `pnpm --filter @workshop/worker test` 全绿（83/83）。
- [x] `pnpm e2e:local` 全绿（21/21）。
- [~] 关键前端页面有截图（`screenshots/`）；截图已生成，需人工视觉签收。
- [x] 可执行项已关闭或标记 `[~]` 并写明原因；未完成项见第 7 节。
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
- [x] 所有外部响应 DTO 进入 `packages/contracts`；审核详情/diff/成员/项目/审计/站点响应均由路由 parse，Web 直接引用共享类型。
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

- [x] 安装扫描报告多位置实例的 `clean / localChanged / baselineUnknown`，并单列 failures／ambiguous 及未扫描其他角色；服务端订阅不等于本地安装。
- [x] 详情提供幂等点赞/订阅；个人状态通过 `/me/state` 单独读取。
- [x] 登录支持 browser popup；嵌入模式使用 device flow 轮询/兑换，不依赖 opener。
- [x] 创作 preflight 显示真实状态（无本地文件/检查中/pass/warn/block），提交仍按同一结果派生。
- [x] 审核详情结构化展示 report/gate/findings/diff，原始 JSON 折叠。

## 3. 客户端与本地状态

- [x] 修复 staging 客户端被识别为 stable：channel 在模块初始化时捕获并由 iframe 显式传递。
- [x] Web 安装请求使用显式 channel，不从 `location.pathname` 推断。
- [x] 本地记录 downloaded/installed/updateAvailable；服务端订阅与本地扫描状态在详情合并展示。
- [x] D-42 替代保留修改旧规则：更新先展示玩家修改和完整差异，明确确认后整体替换所选实例所属内容；取消零写入，确认前内容变化拒绝执行。
- [x] 卸载先展示差异并明确确认，只删除可靠归属的所选实例内容；不接管歧义实例、不删除整本世界书或其他实例正则。
- [~] 本次宿主投影与安装协议只有本地验证；真实 SillyTavern 安装／更新／卸载／旧格式迁移未执行，也不属于本次本地验证授权。

## 4. 数据、分发与运维

- [x] D-35：服务端不建 install 表；订阅、下载事件、安装状态分离。
- [x] `download_events` 保留 `user_id` 做 user/project/day 幂等计数，不作为安装状态。
- [x] `download_events` 计数时机与获取协议统一（见 1.2）。
- [x] 审核队列表索引补齐 `(status, submitted_at, id)` 或由 query-plan 证据证明无需。
- [x] 客户端 artifact 进入 staging build-once，并由 staging artifact 提升到 production；R2 发布仍需现有部署凭据。
- [~] D-24/D-28 tag purge 与 `Cf-Cache-Status` 实测：需要 staging zone/token。
- [~] 定期备份、R2 资产备份、生产回滚演练：需要生产授权/外部保留策略。
- [~] staging 真实数据导入与独立 reconcile：需要目标授权。

## 5. 文档与需求

- [x] API 设计文档包含用户旅程、不变量、状态归属、缓存层、一致性边界、端点推导。
- [x] 需求/功能文档与实现一致；README、checklist、API 设计、state、decisions、design comparison 已同步本轮路由/计数/货架/构建链。
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
- 未完成/延期：独立修复入口、真实 ST 验收、生产备份演练。

## 8. W1～W7 最终开放式对照（2026-10-26）

本节覆盖当前清单以外的旧新能力与任务体验，不以旧历史勾选证明本轮通过。`OpenAuditAuthor`／`OpenAuditOperations` 只读对照固定 legacy 与当前源码；下列影响及建议属于静态推断，除明确列出的浏览器实测，不声称真实 SillyTavern 已验证。不自动恢复旧布局或扩展 D-40～D-47 边界。

### 明确缺口与不一致

| 项目 | 源码／运行证据 | 影响与处置 |
|---|---|---|
| 阅读行为配置（已实现，补充验收中） | `packages/contracts/src/projects.ts`、`apps/worker/src/storage/content-index.ts`、`apps/worker/web/src/features/projects/ProjectDetail.tsx` | 登录阅读层新增世界书触发关键词／次关键词逻辑、插入位置／顺序／深度／角色／出口及启用状态；正则匹配表达式、停用状态与替换长度仅作纯文本展示，不执行。缺省字段明确未指定，兼容旧响应缺少 behavior。 |
| 评分评论未回填（已修） | `apps/worker/web/src/features/projects/ProjectDetail.tsx`、`apps/worker/src/storage/interactions.ts`、`apps/worker/test/identity-interactions.test.ts` | 个人状态回填评论；未加载禁止编辑；省略 comment 的 API 更新保留旧值，显式空串才清除。真实 API 回归通过，界面专项结果见 state。 |
| 评分可见性说明（已修） | 个人状态 requireSession 与当前 userId SQL；公开详情不返回评分评论 | 补准确说明：只供本人查看，不向作者／其他用户公开；跨用户、匿名读取及公开字段回归通过，不照抄旧承诺。 |
| 更新保留修改旧承诺（已修） | `ProjectDetail.tsx` 对照 `InstallDialog.tsx` | 改为预览差异后整体替换、不保留该实例本地修改；取消仍零写入，不改变 D-42。 |
| 已存内容逐条删除（已实现，补充验收中） | `apps/worker/web/src/features/projects/authoring/CurrentRevisionEntries.tsx`、`apps/worker/web/src/features/projects/ProjectEditor.tsx`、`apps/worker/src/http/routes/authoring.ts` | 作者编辑器独立读取当前版本已保存世界书／正则条目；确认删除产生 successor，未保存资料／未上传文件阻止删除，冻结版本须先新建版本；公开快照不变，仍需统一送审。读取限作者／owner 与项目内 revision，不计公开下载。 |
| 阅读关闭焦点（已实现修复） | 浏览器此前两次 activeElement=BODY；`ProjectDetail.tsx` 的 opener ref 与 onCloseAutoFocus | 明确恢复打开阅读层的原条目按钮；最终桌面／手机复验见 state。 |
| HTTP 安装桥（已修并实测） | ZeroTier HTTP 中 randomUUID 未定义；改 getRandomValues 生成关联 ID | 实际浏览器覆盖 scan／confirm timeout、dispose、origin/source/requestId/type 过滤和预览确认取消消息往返；不注入 UUID、不真实 ST、不执行宿主写入。 |

### 值得借鉴、需决定的差异

| 项目 | 证据 | 价值与处置建议 |
|---|---|---|
| 多标签组合 | 旧 `../workshop-legacy/cloudflare/src/pages/home/app/actions.ts:659-696` 最多12个；新 `apps/worker/web/src/App.tsx:106-109,445-453,866-909` 单 tag | 组合检索收缩；采纳前明确 AND／OR 契约、查询与分页重置，不只做 chips。 |
| 搜索提交方式 | 旧 `../workshop-legacy/cloudflare/src/pages/home/app/actions.ts:528-585` Enter；新 `apps/worker/web/src/App.tsx:615-625,420-470,1223-1235` 200ms 自动查询 | 输入速度与结果稳定性取舍；可保留旧结果标记更新中或分离 draft／submitted，中文输入法尚未实测。 |
| 保存上传提交编排 | 旧 `../workshop-legacy/cloudflare/src/pages/home/modal/project-editor.ts:549-554`；新 `apps/worker/web/src/features/projects/ProjectEditor.tsx:274-334,370-385` | 当前分步利于重试，但最终提交需用户协调；可串联现有步骤并保留失败恢复，不宣称跨 HTTP 事务。 |
| 阅读字体偏好 | 旧 `../workshop-legacy/cloudflare/src/pages/home/state.ts:6-55`；新 `apps/worker/web/src/styles/base.css:1-6` | 可局部持久化阅读字体，不改变全站外观、不自动引入外部字体 CDN。 |
| 跨版本审核记忆 | 旧 `../workshop-legacy/cloudflare/src/pages/home/modal/admin-review.ts:129-130,183-216`；新 `apps/worker/web/src/features/review/check-report.ts:17-31,117-138,163-181` | 旧 accepted／changed／new 语义未进入新 finding；恢复须绑定内容和检查依据，不按 ruleId 盲目沿用人工结论。 |
| 全队列筛选排序 | 旧 `../workshop-legacy/cloudflare/src/pages/home/modal/admin-review.ts:571-600,694-716`；新 `apps/worker/web/src/features/review/AdminPanel.tsx:110-120,189-218` | 新搜索仅已加载数据；应准确标范围，若补全队列搜索／类型／排序须走服务端。 |
| 中断安装修复出口 | 旧 `../workshop-legacy/cloudflare/src/pages/home/repair-ui.ts:144-150,184-188`；新 `apps/tavern-client/src/install.ts:85-86,354-357` | 新版更保守；可展示阶段与可靠任务证据，不能恢复模糊认领。已补空 pending 在完整扫描后明确重装的恢复路径。 |
| 全库扫描成本 | 旧 `../workshop-legacy/src/CreativeWorkshop/services/install-registry.ts:186-202`；新 `apps/tavern-client/src/install.ts:177-196`、`apps/tavern-client/src/index.ts:81-89` | 完整发现避免未绑定实例消失，但启动即全扫描有成本；延迟／范围开关需产品决定，不默默缩范围。 |
| 更新汇总入口 | 旧 `../workshop-legacy/cloudflare/src/pages/home/update-center.ts:6-19,123-155`；新 `apps/worker/web/src/features/installed/Installed.tsx:110-170` | 可增加仅有更新筛选／数量，保留逐实例确认；旧版也不是批量自动写入，不扩成脚本健康面板。 |
| 宿主键盘与慢加载 | 旧 `../workshop-legacy/src/CreativeWorkshop/index.ts:307-364`；新 `apps/tavern-client/src/index.ts:126-234` | 新固定全屏无显式 visualViewport 跟随／慢加载提示；需真实宿主条件证据，不以普通 Web 手机截图断言键盘遮挡。 |

### 新版应保留的优点

- 真实多位置独立实例与版本、预览／确认／取消边界；旧版多副本选择唯一保留不是本轮目标（`apps/worker/web/src/features/installed/Installed.tsx:45-46,110-170`）。
- 订阅阅读清单与实际安装分离，提交历史记录撤回／检查／决定而不只显示当前状态（`apps/worker/web/src/features/projects/Subscriptions.tsx:73-117`；`apps/worker/web/src/features/projects/authoring/SubmissionHistory.tsx:17-53`）。
- 审核绑定冻结证据、409 取消原决定并重新核对，服务端检查自动刷新但保留人工例外（`apps/worker/web/src/features/review/AdminPanel.tsx:130-149,281-348,394-458`）；不恢复设备 challenge。
- 冻结内容、报告及理由导出与剪贴板降级（`apps/worker/web/src/features/review/AdminPanel.tsx:461-480`；`apps/worker/web/src/features/review/export-markdown.ts:83-96,215-223`）。
- 管理任务返回索引保留挂载期间草稿／筛选／分页并恢复入口焦点（`apps/worker/web/src/AdminTools.tsx:102-189,224-254,334-359`）；不是刷新页面后的持久恢复。

### 验收结论与产品建议边界

原第五轮 E2E 因过时点赞 selector 停止，用户明确允许追加最多三轮后，第一个追加完整运行即 **21/21 通过**。最终 `pnpm check` 通过：Worker 123、domain 23、content 7、client 17；CLI 真实 HTTP 3 tests 通过。阅读焦点／评分及桥协议专项证据见 state。

本审计保留后续可借鉴项，不将 W1～W7 完成等同于旧版每一项能力完全相同。用户随后授权补齐明确缺口，阅读行为配置与已存内容逐条删除已实施，补充验证记录见 state；组合筛选、字体、全队列查询等需要产品取舍的建议尚未纳入。正式数据迁移、切换与真实宿主操作未执行。无 commit／push／部署／远程业务写入。

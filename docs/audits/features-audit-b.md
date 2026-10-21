# 功能与决策完成度审计（B）

- 仓库：`/home/zz/world-builder/projects/命定之诗/workshop`
- 分支 / HEAD：`refactor/2026-10` / `e103ee4`
- 审计范围：`features.md` §7–§12（互动、分发与版本、UI 与通知、运维、测试与文档），以及 `decisions.md` 全部 D-01..D-34、`main.md` §3 运行时、§4 数据模型、§5 API 契约、§6 缓存、§9 构建与发布。
- 文档基准目录：`docs/plans/refactor-2026-10/`（下表中的 `features.md:N`、`decisions.md:N`、`main.md:N`、`state.md:N` 均指该目录）。
- 方法：只读检查当前工作树；不运行测试、不修改数据、不访问 Cloudflare 资源。`state.md` 的完成声明只作为待验证声明，不作为证据。
- 状态口径：`done` = 当前代码有实现且有对应测试/可运行证据；`partial` = 主要路径存在但缺契约、缺分支或只完成一侧；`missing` = 当前仓库无实现。`deferred` 表示文档已明确延期/阻塞，但仍记为 `missing` 或 `partial`，并在备注中区分。
- 严重度：`blocker` = 阻断生产切换或核心契约；`high` = 必需用户功能缺失/失效；`medium` = 有替代路径或部分实现；`low` = 非阻断/收尾项；`none` = 已完成。

## 0. 结论摘要

- `features.md` §7–§12 共 34 行，当前 `done` 8 行、`partial` 12 行、`missing` 14 行。
- 最严重的缺口不在互动写入（点赞/订阅/评分/下载计数主路径可用），而在**外围能力**：没有客户端分发（`/client/*`、R2 代理、版本门禁）、没有任何 cron/定时任务、没有管理端站点/精选/基线/审计读取接口、没有 Workers Cache 专项（D-24/D-28）、项目版本标签从数据模型中消失。
- 多数缺口没有被 `state.md` 记录为阻塞项；`state.md` 只把 OAuth callback、checker DO、SillyTavern 验证、R2 复制适配器列为 stop condition。其余缺口属于未完成实现，而不是已声明的延期。
- 发现一个当前 UI 的功能性 bug：排序 tab 在无搜索词时完全不生效（见 §5.1）。

## 1. features.md §7–§12 状态表

### 1.1 §7 互动

| ID | 要求来源 | 状态 | 当前证据 | 严重度 | 备注 |
|---|---|---|---|---|---|
| G1 点赞 | `features.md:125`；`main.md:169` | done | `apps/worker/src/http/routes/me.ts:39-55`；`apps/worker/src/storage/interactions.ts:48-56`；`apps/worker/test/identity-interactions.test.ts:106` | none | 幂等 `PUT/DELETE`，登录必需；`INSERT OR IGNORE` 保证重复幂等。 |
| G2 订阅 | `features.md:126`；`decisions.md:22`（D-04） | done | `apps/worker/migrations/0001_initial.sql:151-178`（触发器计数）；`apps/worker/src/storage/projects.ts:92`（DTO 公开计数）；`apps/worker/src/storage/interactions.ts:57-75` | none | 订阅计数由触发器维护并在列表/详情返回，不再是硬编码 0。 |
| G3 私有评分/留言 | `features.md:127`；`main.md:169` | done | `apps/worker/src/http/routes/me.ts:75-100`；`apps/worker/src/storage/interactions.ts:79-88`；`apps/worker/test/identity-interactions.test.ts:106` | none | 只有 `GET /me/state` 返回本人评分；公开 DTO 不含评分/留言。 |
| G4 下载计数 | `features.md:128`；`decisions.md:243`（D-28） | partial | `apps/worker/src/http/routes/projects.ts:34-42`；`apps/worker/src/storage/downloads.ts:8-19`；`apps/worker/migrations/0001_initial.sql:192-218` | medium | 有 `POST /projects/:id/downloads`、按用户/项目/天幂等、触发器原子增量；但 D-28 要求该响应返回一次性地址或重定向，当前只返回 `204`，实际文件仍走单独的 `GET .../files/:kind`，且后者不计入下载量。计数与分发已分离，但没有一次性地址。 |
| G5 每日抽签配额 | `features.md:129`；`decisions.md:328`（Q-10） | missing（deferred） | 新 Worker 无 draw/lottery/quota 路由（`apps/worker/src/app.ts:28-37`）；新 schema 无抽签表（`apps/worker/migrations/0001_initial.sql:7-321`）；旧入口记录于 `p0-baseline.md:81-82` | low | Q-10 未定，`features.md:129` 要求“接口暂留”。当前是整体未迁移，不是仅收起入口；属于已记录的待定项。 |

### 1.2 §8 分发与版本

| ID | 要求来源 | 状态 | 当前证据 | 严重度 | 备注 |
|---|---|---|---|---|---|
| H1 stable/staging 客户端 | `features.md:135`；`decisions.md:104-112`（D-20） | missing | `config/workshop.json:2-17` 只有旧客户端版本；`apps/` 下只有 `worker`（无 `tavern-client`） | blocker | 版本配置仍服务于旧 webpack 客户端，新 Worker 不消费。 |
| H2 旧路径 shim | `features.md:136`；`decisions.md:307-312`（D-33） | partial | `test-dist/CreativeWorkshop/index.js` 仍跟踪；`scripts/build-workshop-legacy-shim.mjs:7-15` 生成 shim；`apps/worker/wrangler.jsonc:15` 未提供实际 shim 路由 | medium | 计划保留一个周期，但新 Worker 不服务 `test-dist`，也没有 `/client` 迁移路径。旧客户端调用的是 `/api/projects/...`（`src/CreativeWorkshop/services/project-fetch.ts:271,311`），与新 `/api/v1` 不兼容。 |
| H3 staging 域名别名 | `features.md:137` | partial | `config/workshop.json:18-23` 记录旧别名；`apps/worker/wrangler.jsonc:35-46` 只有单个 workers.dev/staging 配置 | medium | 别名只在旧配置文件里，Worker 没有多 host 路由/别名验证。 |
| H4 移除配套脚本依赖 | `features.md:138`；`decisions.md:38-40`（D-08） | missing | `config/workshop.json:30-42` 仍列角色管理库/美化器；`src/CreativeWorkshop/bridge/host.ts:8,408-413` 仍暴露 `bridge:list-script-dependencies`；`src/CreativeWorkshop/services/script-dependency.ts` 仍完整存在 | medium | D-08 要求移除展示与版本健康检查；当前代码和配置都保留。旧客户端处于过渡期可以解释保留客户端代码，但**工坊配置与 bridge 请求**没有移除。 |
| H5 固定导入 URL | `features.md:139`；`decisions.md:26-28`（D-05） | missing | `apps/worker/src/app.ts:28-37` 无 `/client` 路由；`apps/worker/wrangler.jsonc:15` 只在 `run_worker_first` 中列出 `/client/*`；`config/workshop.json:43-46` 仍是 jsDelivr `cdnBase` | blocker | 没有 R2 代理、没有版本化对象、没有 stable/staging 指针。 |
| H6 项目版本标签 | `features.md:140` | missing | `apps/worker/migrations/0001_initial.sql:70-93` 的 `project_revisions` 无 version 列；`packages/contracts/src/authoring.ts:6-15` 无 version 字段；`packages/domain/src/version.ts:1-60` 的版本工具在 Worker 中无调用 | high | 这是数据模型缺失，不是仅 UI 缺失。旧客户端会比较 `project.version`（`src/CreativeWorkshop/services/project-fetch.ts:322`），新 DTO 永远没有该字段。 |
| H7 精确客户端版本门禁 | `features.md:141`；`decisions.md:30-32`（D-06） | missing | 无版本记录表/读取路径；无客户端；`decisions.md:136` 要求写入 D1 `site_settings` 或 R2 manifest，当前 `site_settings` 只有 banner 读取（`apps/worker/src/storage/home.ts:28-38`） | high | 没有 current channel version，也没有安装/更新/修复拒绝路径。 |
| H8 客户端迁移提示 | `features.md:142`；`decisions.md:307-312` | partial | `config/workshop.json:6-14` 有 self-rewrite 迁移配置；`scripts/build-workshop-legacy-shim.mjs:8-28` 生成旧 shim；新客户端不存在 | medium | 迁移逻辑只存在于旧构建脚本，新的固定分发和一次性提示未实现。 |

### 1.3 §9 UI 与通知

| ID | 要求来源 | 状态 | 当前证据 | 严重度 | 备注 |
|---|---|---|---|---|---|
| I1 首页壳 + React | `features.md:148`；`main.md:116` | done | `apps/worker/web/src/App.tsx:51-115`；`apps/worker/web/index.html:1-13`；`tools/e2e-local.mjs:104-110`（真实 Worker HTTP 根页） | none | 已删除字符串 UI，React 壳可用；但只是最小列表/详情。 |
| I2 主题/字体/图标本地化 | `features.md:149` | partial | `apps/worker/web/src/styles.css:10` 使用 `"Noto Sans SC"` 但未打包字体；`apps/worker/web/index.html` 无 CDN 引用；无图标集 | low | 没有 CDN 依赖（符合移除 CDN 的目标），但字体/图标也没有本地产物，依赖系统回退。 |
| I3 弹窗集合 | `features.md:150` | partial | `apps/worker/web/src/App.tsx:33-49` 只有右侧详情栏；无上传/审核/确认弹窗 | medium | 7 类弹窗未重建。 |
| I4 移动端 4/3/2/1 | `features.md:151`；`decisions.md:199-210`（D-26） | done | `apps/worker/web/src/styles.css:87`（4 列）、`:151-159`（3/2/1 断点） | none | 断点与要求一致。 |
| I5 Toast | `features.md:152` | missing | `apps/worker/web/src` 无 toast 实现；`App.tsx:57,105` 只有单行 error 文本 | medium | 无全局提示组件。 |
| I6 通知 | `features.md:153`；`decisions.md:34-36`（D-07） | done | 新 Worker/Web 无站外通知代码；站内更新中心仍在旧客户端 `src/CreativeWorkshop` 中 | none | D-07 明确“不做”，属于有意的 no-op。 |
| I7 社区入口/Discord | `features.md:154`；`decisions.md:212-223`（D-27） | partial | DTO 有 `discordThreadUrl`（`apps/worker/src/storage/projects.ts:105`）；卡片/详情未渲染（`apps/worker/web/src/App.tsx:11-49`） | medium | 字段已入库，但 UI 没有按钮；D-27 要求为空不渲染、非空显示。 |

### 1.4 §10 运维

| ID | 要求来源 | 状态 | 当前证据 | 严重度 | 备注 |
|---|---|---|---|---|---|
| J1 榜单 cron | `features.md:160`；`decisions.md:174-197`（D-25） | missing | `apps/worker/src/index.ts:4-8` 只导出 `fetch`；`apps/worker/wrangler.jsonc` 无 `triggers.crons`；无 ranking job 文件 | high | 没有 scheduled handler，榜单永远不会生成/刷新。 |
| J2 周期热度快照 | `features.md:161`；`decisions.md:76-78`（D-14） | missing | schema 有 `ranking_runs`/`ranking_entries`/`discovery_exposures`（`0001_initial.sql:220-245`），但 `apps/worker/src` 中无任何读写；无 7d/30d 代码 | high | 表建了但没有生产者/消费者；属于死表。 |
| J3 日志/可观测 | `features.md:162` | partial | `apps/worker/wrangler.jsonc:6-8` 仅 `observability.enabled`；`apps/worker/src/app.ts:85-87` 只对未捕获错误 `console.error`；无 10% 采样配置 | low | 没有 `head_sampling_rate`，也没有“错误不采样”的独立通道。 |
| J4 staging 数据同步 | `features.md:163`；`decisions.md:68-70`（D-12） | partial | `tools/migrate/cli.mjs:9-14` 提供 extract/transform/load/verify/reconcile/all；`tools/migrate/load-local.mjs` 只写本地 D1；`state.md:100` 明确 R2 复制适配器未实现 | medium | 工具链存在，真实 staging/生产导入与 R2 对象复制未实现；已记录为阻塞项。 |
| J5 部署 CI + 精确 SHA | `features.md:164`；`decisions.md:84-86`（D-16） | partial | `.github/workflows/deploy-production.yml:32-38`、`.github/workflows/deploy-staging.yml:36-42`：各自 `pnpm install --no-frozen-lockfile` + 重新构建 + `wrangler deploy`；无 artifact 上传/提升，无 migration 步骤 | medium | 有 CI 部署，但没有“对精确 SHA 构建一次并逐级提升同一 artifact”；每次部署重新构建。 |
| J6 备份 | `features.md:165` | missing | `tools/` 无定时备份/校验脚本；只有迁移 README 提到导出 | high | 没有定期备份与校验实现。 |
| J7 D1 成本闸门 | `features.md:166` | missing | 无 rows read/write 预算测试；`pnpm check`（`package.json:9`）未包含此类测试 | medium | D-25 的 rows-read 上限与压测未落地。 |
| J8 测试体系 | `features.md:167` | partial | `package.json:9` 统一 `pnpm check`；`apps/worker/test/*.test.ts` 29 个 `it`；`tools/e2e-local.mjs:99-197` 10 个 HTTP E2E；无 Playwright | medium | 测试骨架可用，但 T2/T3/T4/T6 的保留/新增项缺失。 |

### 1.5 §11 测试与文档

| ID | 要求来源 | 状态 | 当前证据 | 严重度 | 备注 |
|---|---|---|---|---|---|
| T1 删除源码正则断言 | `features.md:173` | done | `tests/` 下只有 `fixtures/legacy`；无旧 `cloudflare/tests` 或 `readFileSync` 源码断言 | none | P6 删除清单已执行（`p6-cleanup.md` §4）。 |
| T2 EJS checker 语料 | `features.md:174` | missing | `util/ejs-checker-v2.js` 仍在，但 `apps/worker/test`、`packages/*/test`、`tools` 无 EJS checker 语料/行为测试 | high | 保留为生成产物，未迁到 behavior test。 |
| T3 fingerprint/diff/安装安全 | `features.md:175` | missing | `packages/domain` 只有 `content-policy.test.ts`；无 fingerprint/diff/install 行为测试；旧服务代码在 `src/CreativeWorkshop` 但无新测试 | high | 与 T2 相同，原测试随旧目录删除后未重建。 |
| T4 Playwright 真实旅程 | `features.md:176` | partial | 无 Playwright；`tools/e2e-local.mjs:99-197` 用 Node HTTP 跑 10 个旅程（health、静态 UI、列表、创建、上传、私有 404、提交、审核、下载、Origin） | medium | 有真实 Worker + D1/R2 的 E2E，但不是 Playwright，也没有真实浏览器交互测试。 |
| T5 迁移对账测试 | `features.md:177`；`decisions.md:218-220` | done | `tools/migrate/test.mjs`、`tools/migrate/test-from-sql.mjs` 纳入 `pnpm check`（`package.json:9`）；`tools/migrate/lib.mjs` verify/reconcile | none | 对账/幂等/verify 有测试入口。 |
| T6 API 契约测试 | `features.md:178` | missing | `tests/fixtures/legacy/` 16 个样本存在；但没有测试读取它们（`apps/worker/test` 未引用 `fixtures/legacy`） | high | P0 录制样本未转化为契约测试。 |

## 2. decisions.md 状态表

| ID | 决策要点 | 状态 | 当前证据 | 严重度 | 备注 |
|---|---|---|---|---|---|
| D-01（`decisions.md:10`） | 单个 ContentService DO，Hono 显式路由 | missing | `apps/worker/wrangler.jsonc` 无 `durable_objects`/`migrations`；`apps/worker/src` 无 `getByName`/`DurableObject` | blocker | `state.md:98` 明确无 review checker 实现，属于已记录阻塞。 |
| D-02（`decisions.md:14`） | 两态可见性，private 404 | done | `0001_initial.sql:53`；`apps/worker/src/storage/projects.ts:51-54`（PUBLIC_PROJECT）；`apps/worker/src/storage/releases.ts:25-29` | none | 列表/详情/文件均检查 visibility。 |
| D-03（`decisions.md:18`） | 匿名只给摘要与条目索引 | done | `apps/worker/src/http/routes/projects.ts:22-32`（详情无文件列表）；`apps/worker/src/storage/projects.ts:80-106`（DTO 只有计数） | none | 公开详情不含 manifest/文件 URL。 |
| D-04（`decisions.md:22`） | 订阅计数公开且真实 | done | `0001_initial.sql:151-178`；`apps/worker/src/storage/projects.ts:92` | none | 触发器维护计数，DTO 返回。 |
| D-05（`decisions.md:26`） | 固定地址 `/client`，Worker 代理 R2 | missing | 无 `/client` 路由；`wrangler.jsonc:15` 仅列在 `run_worker_first`；`config/workshop.json:43-46` 仍 jsDelivr | blocker | 见 H5。 |
| D-06（`decisions.md:30`） | 精确 channel 版本门禁 | missing | 无版本记录/读取；无客户端；`site_settings` 只读 banner（`storage/home.ts:28-38`） | high | 见 H7。 |
| D-07（`decisions.md:34`） | 不做站外通知 | done | 无通知代码；旧站内更新中心仍在 `src/CreativeWorkshop` | none | 有意 no-op。 |
| D-08（`decisions.md:38`） | 移除配套脚本展示/健康检查 | missing | `config/workshop.json:30-42`；`src/CreativeWorkshop/bridge/host.ts:8,408-413` | medium | 见 H4。 |
| D-09（`decisions.md:42`） | 审核路由：gate 记录、pass/warn 自动发布、block/missing 人工、超时重试 | partial | `apps/worker/src/storage/authoring.ts:358-388` 记录 gate/checker 并置 `pending`；`apps/worker/src/storage/admin.ts:259-338` 只有人工审核；无自动发布/超时/DO | blocker | `state.md:98` 记录 checker DO 缺失，属已声明阻塞；但“自动发布”分支完全不存在。 |
| D-10（`decisions.md:52`） | Origin 白名单、一次性 flow/redeem/设备码、会话每请求查库 | partial | `apps/worker/src/http/routes/auth.ts:40-108`（flow 创建/状态、Origin 白名单）；`storage/identity.ts:46-93`；无 callback/redeem/device；无任何 `INSERT INTO sessions` 生产路径（仅测试/e2e 种子） | blocker | `state.md:97` 记录缺 Discord secret；但 session 创建路径也完全缺失，意味着即使有 secret 也无法登录。另：`oauth_flows.origin` 存了请求 Origin（`0001_initial.sql:33`，`identity.ts:60-63`），与 `decisions.md:54`“不存储请求里的 Origin”表述冲突，需确认决策原意。 |
| D-11（`decisions.md:64`） | 不可变 revision + D1 指针切换，孤儿由清理任务回收 | partial | `apps/worker/src/storage/authoring.ts:213-242`（不可变 revision）；`storage/admin.ts:313-338`（单 batch 切指针）；无 orphan 清理 job | medium | 发布正确；清理任务缺失（与 J1 同因：无 cron）。 |
| D-12（`decisions.md:68`） | 新库重建、逐表映射、对账、幂等 | partial | `tools/migrate/*`；`p4-migration.md`；`state.md:100` 缺 R2 复制适配器 | medium | 已记录阻塞。 |
| D-13（`decisions.md:72`） | 一次性切换与回滚 | partial | `p5-cutover.md` runbook；无代码层面停写屏障 | low | 属运维流程，未执行生产切换。 |
| D-14（`decisions.md:76`） | 保留中文 FTS（含 1–2 字与标签）、日榜/发现、7d/30d | partial | `apps/worker/src/storage/projects.ts:123-144`：≥3 字用 `project_search MATCH`，≤2 字改用 `LIKE`；`project_search_short` 只在 schema/check-schema 中出现，应用从不查询；无日榜/周期排序 | high | 1–2 字搜索退化为全表 LIKE，违反 `features.md:32`“不换 LIKE”与 D-14；短索引是死代码。 |
| D-15（`decisions.md:80`） | 删除源码断言、保留/新增测试 | partial | T1/T5 done；T2/T3/T4/T6 缺失/部分 | high | 见 §1.5。 |
| D-16（`decisions.md:84`） | 产物不提交、CI 精确 SHA、客户端产物 R2 | partial | `dist/` 不再跟踪（`git ls-files` 无 `dist/`）；CI 每次重建（deploy workflows）；客户端未上传 R2 | medium | 见 J5/H5。 |
| D-17（`decisions.md:88`） | 切换时 no-store；验收后 Workers Cache/静态 immutable | partial | `apps/worker/src/app.ts:19-26` 统一 `private, no-store`；静态资产无 `_headers`/immutable 配置；`app.ts:58` 封面 `public, max-age=60`；无 Workers Cache | medium | 第一阶段做到；第二阶段完全缺失。 |
| D-18（`decisions.md:92`） | workspace 骨架 + packages/content + apps/tavern-client | partial | `pnpm-workspace.yaml`；`apps/` 只有 worker；`packages/` 只有 contracts/domain；无 `packages/content` | medium | 目录骨架不完整。 |
| D-19（`decisions.md:96`） | 只用 Worker + Static Assets，不用 Pages | done | `apps/worker/wrangler.jsonc:11-16`；`apps/worker/src/index.ts:4-8`；无 Pages 配置/命令 | none | 单 Worker 形态成立。 |
| D-20（`decisions.md:104`） | 双产物与目录边界 | missing | 无 `apps/tavern-client`；旧客户端仍在 `src/CreativeWorkshop` 并直接 import `packages/domain` | high | `p6-cleanup.md:60` 已承认“尚未迁到 apps/tavern-client”，但没有阻塞标记。 |
| D-21（`decisions.md:126`） | R2 版本记录（托管部分被 D-22 替代） | partial | 无 D1 client version 记录；无 R2 manifest；`config/workshop.json` 仍是旧客户端版本 | medium | D-21 的版本记录部分仍未实现，托管部分应由 D-22 替代。 |
| D-22（`decisions.md:140`） | Worker 代理 R2 + Workers Cache、缓存头、purge | missing | 无 `/client` handler、无 `ctx.cache`/`Cache-Tag`/purge（全仓 grep 无结果） | blocker | 见 H5。 |
| D-24（`decisions.md:160`） | Workers Cache 专项研究与 staging 验证 | missing | `main.md:181-193` 没有回写研究结果/测试；代码无 cache 键/头/失效实现；`wrangler.jsonc` 无 cache 配置 | high | D-24 标注“重构必做”，当前未开始。 |
| D-25（`decisions.md:174`） | Free 预算、读预算测试、cron 合并、DO 限制 | partial | 无 rows-read/write 测试、无 cron、无 DO；列表查询无上限保护（`storage/projects.ts:152-181`） | high | 预算闸门未落地；请求路径本身尚无大扫描（除 1–2 字 LIKE）。 |
| D-26（`decisions.md:199`） | 单屏列表 + 顶部发现栏 + 卡片字段 + 响应式 | partial | 列表/响应式 done（`styles.css:87,151-159`）；无发现栏；卡片缺作者头像、时间、作者一句话、Discord（`App.tsx:11-31`）；详情缺作者介绍/更新时间 | medium | 数据契约里部分字段存在（schema_version/author_note/discord_thread_url），UI 未消费。 |
| D-27（`decisions.md:212`） | 发现栏小时桶、24/页、作者筛选、Banner 位置缩放、警告详情 | partial | 无 discover 路由/表写入（`storage/home.ts` 只有 banner+recommendations）；API 默认 20（`packages/contracts/src/projects.ts:51`）而 UI 硬编码 24（`web/src/api.ts:43`）；无 authorId 筛选、无 nextCursor 翻页 UI、Banner 只渲染 imageUrl（`App.tsx:88-90`）、无警告展示 | high | 24/页在 UI 侧成立，API 默认值不一致；发现栏/作者筛选/警告完全缺失。 |
| D-28（`decisions.md:225`） | 公开 Public 缓存 + 个人 Viewer 缓存 + 标签失效 | partial | 全部动态响应 no-store（`app.ts:19-26`）；无 `Public`/`Viewer` entrypoint、无 `ctx.props`、无 Cache-Tag；下载写请求 no-store | medium | 没有缓存泄漏（因为没开缓存），但 D-28 的缓存设计与失效策略未实现。 |
| D-29（`decisions.md:248`） | 浏览匿名、写入/文件/个人数据需登录 | partial | 公开读无鉴权；`GET .../manifest`、`.../files` 需 session（`routes/projects.ts:44-77`）；互动需 session（`routes/me.ts:39-100`）；`/downloads` 需 session（`routes/projects.ts:34-38`） | medium | 后端边界基本正确；但登录流程不可完成（D-10），所以“我的项目/订阅/评分”等用户路径实际不可用。 |
| D-30（`decisions.md:269`） | 元数据检查（长度/控制字符/URL 白名单/标签/版本/封面/频率/审计） | missing | `packages/contracts/src/authoring.ts:6-15` 只有 zod 长度/`z.string().url()`；无 `metadata_checker_revision`/findings/审计；封面只查 MIME/大小（`routes/authoring.ts:138-148`），不查尺寸 | high | `discordThreadUrl` 接受任意 URL；无控制字符/版本格式/频率限制；与 D-30 不符。 |
| D-31（`decisions.md:281`） | 玩家版/审核版独立、DO 与管理员同 revision、超时 3 次 | missing | 无 checker 构建/DO；`storage/admin.ts:278` 直接采用请求里的 `checkerVersion`，可覆盖 submission 的 `checker_revision`；测试 `apps/worker/test/admin-review.test.ts:91-98` 正是 `checker-1` → `review-2` | high | 在 checker 缺失前提下，管理员接口已经允许 revision 不一致，未来接 DO 时会违反 D-31。 |
| D-32（`decisions.md:294`） | 排序 tab、筛选、Banner、精选、抽签收起、我的项目/订阅、作者筛选、分页 | partial | 排序 tab 后端/前端存在（`App.tsx:4-9,92-103`）但无搜索时渲染忽略排序结果（`App.tsx:108`）；无标签/作者筛选；无我的项目/订阅；精选只读；无分页展示 | high | 见 §5.1 的排序 bug。 |
| D-33（`decisions.md:307`） | 重提保留历史、自动抽查、删旧 toggle/镜像、固定分发 | partial | `storage/authoring.ts:372-379` 重提 supersede 旧 pending，旧 revision/review 保留；旧 subscribe toggle 已删除，只保留 PUT/DELETE（`routes/me.ts:57-73`），符合 D-33；固定分发缺失 | medium | 历史保留与旧 toggle 处理符合；固定分发/迁移提示缺失。 |
| D-34（`decisions.md:314`） | 删除 attestation，单次上传 | done | 无 preflight/attestation 路由；上传一次完成（`routes/authoring.ts:124-152`）；提交带 gate 记录（`authoring.ts:154-161`） | none | 收据/二次上传已不存在。 |

## 3. main.md §4/§5/§6 与运行时

### 3.0 端点逐项核对（main.md:164-170）

| 端点 | 状态 | 当前实现/缺口 |
|---|---|---|
| `GET /api/v1/projects` | done | `apps/worker/src/http/routes/projects.ts:12-22`；支持 limit/cursor/sort/projectType/search；缺 tag/authorId。 |
| `GET /api/v1/projects/:id` | done | `routes/projects.ts:24-28`；只返回公开摘要，不含文件列表。 |
| `GET /api/v1/home` | done | `routes/home.ts:7`；banner + latest + 4 条推荐，无发现栏。 |
| `GET /api/v1/recommendations` | done | `routes/recommendations.ts:7-9`；返回 `{items}`，无 `nextCursor`。 |
| `GET /api/v1/reference-sets` | done | `routes/references.ts:8-17`；`/:id` 在内存过滤。 |
| `GET /api/v1/site` | done | `routes/site.ts:7`；只读 banner。 |
| `POST /api/v1/auth/flows` | partial | `routes/auth.ts:40-89`；Origin 白名单/flow 创建；返回 state 与 URL；无 callback。 |
| `GET /api/v1/auth/flows/:id` | done | `routes/auth.ts:95-108`；只返回状态/过期时间。 |
| `POST /api/v1/auth/flows/:id/redeem` | missing | 无路由；无 session 创建。 |
| `GET /api/v1/me` | done | `routes/me.ts:20-26`。 |
| `DELETE /api/v1/sessions/current` | done | `routes/auth.ts:30-38`；`storage/identity.ts:86-93`。 |
| `POST /api/v1/projects` | done | `routes/authoring.ts:50-60`；创建 revision 1。 |
| `PATCH /api/v1/projects/:id` | done | `routes/authoring.ts:76-90`；`If-Match` CAS。 |
| `POST /api/v1/projects/:id/revisions` | done | `routes/authoring.ts:108-122`。 |
| `PUT /api/v1/projects/:id/revisions/:rev/files/:kind` | done（受 kind 限制） | `routes/authoring.ts:124-152`；只允许 worldbook/regex/cover，无 avatar/banner。 |
| `POST /api/v1/projects/:id/revisions/:rev/submit` | partial | `routes/authoring.ts:154-161`；只创建 pending，无自动检查/自动发布。 |
| `PATCH /api/v1/projects/:id/visibility` | done | `routes/authoring.ts:92-106`。 |
| `GET /api/v1/admin/submissions` | done | `routes/admin.ts:38-49`；status 过滤，offset cursor。 |
| `GET /api/v1/admin/submissions/:id` | done | `routes/admin.ts:51-58`；含 assets/review。 |
| `POST /api/v1/admin/submissions/:id/review` | done（仅人工） | `routes/admin.ts:80-91`；`storage/admin.ts:259-338`。 |
| `GET /api/v1/projects/:id/releases/:releaseId/manifest` | done | `routes/projects.ts:44-58`；需登录。 |
| `GET /api/v1/projects/:id/releases/:releaseId/files/:kind` | done | `routes/projects.ts:60-77`；需登录，no-store。 |
| `GET /api/v1/me/state?ids=` | done | `routes/me.ts:28-37`；最多 50 个 id。 |
| `PUT/DELETE /api/v1/me/likes/:id` | done | `routes/me.ts:39-55`。 |
| `PUT/DELETE /api/v1/me/subscriptions/:id` | done | `routes/me.ts:57-73`。 |
| `PUT/DELETE /api/v1/me/ratings/:id` | done | `routes/me.ts:75-100`。 |
| `GET /api/v1/admin/projects` | done | `routes/admin.ts:93-103`。 |
| `GET /api/v1/admin/members` | done | `routes/admin.ts:105-115`。 |
| `PUT /api/v1/admin/members/:id/role` | done | `routes/admin.ts:117-128`；最后 owner 保护。 |
| `GET /api/v1/admin/audit-events` | missing | 无路由；`audit_events` 只有两处写（`storage/admin.ts:299,418`）。 |
| `PUT /api/v1/site` | missing | 无路由；`site_settings` 只读（`storage/home.ts:28-38`）。 |
| `POST /api/v1/projects/:id/downloads`（D-28 补充） | partial | `routes/projects.ts:34-42`；返回 204，无一次性地址。 |
| `GET /api/v1/assets/*`（公开封面） | done | `apps/worker/src/app.ts:39-61`；只允许 covers/banners，covers 校验 public。 |

### 3.1 API 契约（main.md:160-179）

| 组 | 契约 | 状态 | 证据 |
|---|---|---|---|
| 公开读 | `GET /projects`、`/projects/:id`、`/home`、`/recommendations`、`/reference-sets`、`/site` | done（形状有偏差） | `apps/worker/src/app.ts:34-37`；`storage/projects.ts`、`storage/home.ts`、`storage/references.ts`。`/recommendations` 返回 `{items}` 无 `nextCursor`（`routes/recommendations.ts:7-9`），`/reference-sets` 同样（`routes/references.ts:8-10`），与 `main.md:172-176`“集合返回 {items,nextCursor}”不完全一致；当前数据量有 LIMIT 20，影响低。 |
| 身份 | `POST /auth/flows`、`GET /auth/flows/:id`、`POST /auth/flows/:id/redeem`、`GET /me`、`DELETE /sessions/current` | partial | flow 创建/状态有（`routes/auth.ts:40-108`）；`redeem` 无；`GET /me`/登出有（`routes/me.ts:20-26`、`routes/auth.ts:30-38`）；无 session 创建路径。 |
| 作者 | 创建、PATCH、revisions、上传、submit、visibility | done | `routes/authoring.ts:50-161`；`storage/authoring.ts`。缺 `DELETE /projects/:id`（D9/p0:63）和单条目删除（D7），但 main §5 表未列，见 §3.3。 |
| 审核 | submissions 列表/详情/review | done（仅人工） | `routes/admin.ts:38-91`；`storage/admin.ts:126-338`。无 DO/自动发布（D-09 阻塞）。 |
| 安装 | manifest/files（需登录） | done | `routes/projects.ts:44-77`；`storage/releases.ts:17-45`。 |
| 个人 | `/me/state`、likes/subscriptions/ratings | done | `routes/me.ts:28-100`；`storage/interactions.ts`。 |
| 管理 | `/admin/projects`、`/admin/members`、`PUT role`、`GET /admin/audit-events`、`PUT /site` | partial | 前三项 `routes/admin.ts:93-128`；`audit-events` 与 `PUT /site` 不存在（全仓无路由/contract）。 |

### 3.2 数据模型（main.md:126-158）

- 表清单齐全：`users`、`sessions`、`oauth_flows`、`projects`、`project_revisions`、`assets`、`submissions`、`reviews`、互动三表、`download_events`、`project_metrics_daily`、`ranking_runs`/`ranking_entries`/`discovery_exposures`、`recommendations`、`site_settings`、`reference_*`、`audit_events` 均存在于 `apps/worker/migrations/0001_initial.sql:7-321`，`tools/check-schema.mjs:8-36` 也验证了这些表。
- 但存在以下“有表无字段/无消费者”的不一致：
  1. `project_revisions` 无项目版本标签列（H6/D-30），旧客户端依赖的 `project.version` 没有落点。
  2. 无 `metadata_checker_revision`/metadata findings 列（D-30）。
  3. 无客户端版本记录表或 `site_settings` 写入路径（D-06/D-21/D-22）。
  4. `ranking_*`、`discovery_exposures`、`project_metrics_daily.likes_delta` 无写入者（J1/J2）；`recommendations`、`reference_*`、`site_settings` 只有读路径，没有管理端写路径（F9/F10/F11/F13）。
  5. `audit_events` 只有人工审核和角色变更两处写（`storage/admin.ts:299,418`），作者操作/管理设置/精选/基线没有审计事件；且没有读取接口（F4）。
  6. `sessions.last_seen_at` 与 `touchSession` 无调用（`storage/sessions.ts:35-42`），30 天滑动过期未实现；也没有生产 session 创建。
  7. `assets` 支持 `avatar`/`banner` kind，但上传白名单只有 worldbook/regex/cover（`packages/contracts/src/authoring.ts:23`），banner/avatar 无写入路径。

### 3.3 其他 main/p0 契约缺口

- `GET /api/v1/me/projects`、`GET /api/v1/me/subscriptions`：`p0-baseline.md:57-58` 明确映射，features D15 要求保留；`routes/me.ts` 只有 `/state` 和互动写。
- `DELETE /api/v1/projects/:id`：`p0-baseline.md:63` 映射，features D9 要求软删；无路由，schema 的 `deleted_at` 从未被写入。
- `POST /api/v1/admin/reference-sets`、`.../:id/versions`、`PUT/DELETE /api/v1/admin/recommendations/:id`、`PUT /api/v1/site`：`p0-baseline.md:96-100` 映射；全部不存在。
- 公开列表缺少 `tag`/`authorId` 筛选（`packages/contracts/src/projects.ts:51-56` 只有 limit/cursor/sort/projectType/search），与 B4/D-32 的“类型、标签”和“点作者名进入筛选列表”不一致。
- 内容策略没有接入 Worker：`packages/domain/src/content-policy.ts:45-62` 导出 `validateProjectContentPolicy`，`packages/domain/src/project-content.ts:169` 导出 `validateProjectContentText`，但 `apps/worker/src` 无任何调用；作者可提交空/无效世界书，服务端只做 MIME/大小/AST 计数（`storage/authoring.ts:323-343`），D-14“发布前检查（策略 + 引用）”未落地。

### 3.4 缓存（main.md:181-193）

- 第一阶段（动态 API `private, no-store`）成立：`apps/worker/src/app.ts:19-26` 对没有显式头的响应统一加 `private, no-store`；文件/manifest/审核文件也显式 no-store（`routes/projects.ts:68`、`routes/admin.ts:75`）。
- 但静态资产没有 `immutable`/`_headers` 配置，`web/dist` 的哈希文件名没有对应缓存头；`app.ts:58` 封面使用 `public, max-age=60`，不是内容哈希 immutable。
- 第二阶段（D-28/D-24）完全未实现：无 `Public`/`Viewer` entrypoint、无 `ctx.props`、无 `Cache-Tag`、无 purge、无 `Cf-Cache-Status` 测量；全仓 grep `ctx.cache|caches.|purge|Cache-Tag|CDN-Cache` 无命中。
- 因此 D-24 的“门禁”虽然未被违反（生产未开 cache），但“重构必做”的研究与测试也未完成；`main.md:193` 只引用 D-24，没有回写研究结果。

### 3.5 运行时/运维（main.md:114-124）

- 单 Worker + Static Assets：成立（`wrangler.jsonc:11-16`、`src/index.ts:4-8`；根路由实际由 Assets 提供，`app.ts:81` 的文本根路由在部署路径上不可达，属死代码）。
- cron：不存在。`src/index.ts` 只导出 `fetch`，`wrangler.jsonc` 无 `triggers`。榜单、周期快照、过期会话、孤儿对象回收、自动发布轮询都没有调度器。
- DO：不存在。`wrangler.jsonc` 无 `durable_objects`，源码无 `getByName`/`DurableObject`；与 `state.md:98` 的已记录阻塞一致。
- KV：未使用，符合 D-25。
- 日志：只有 `observability.enabled`，无采样率；错误处理只有 `console.error`（`app.ts:85-87`）。

## 4. 明确逐项检查

### 4.1 互动（点赞/订阅/评分/下载）

- 点赞：`PUT/DELETE /api/v1/me/likes/:id` 幂等，先校验项目存在且 public/published（`routes/me.ts:39-55`；`storage/interactions.ts:32-46`）；测试 `identity-interactions.test.ts:106` 覆盖重复调用。
- 订阅：同上（`routes/me.ts:57-73`）；计数由 `project_subscriptions` 触发器维护，公开 DTO 返回 `counts.subscriptions`（`storage/projects.ts:92`），满足 D-04。
- 评分：`PUT/DELETE /api/v1/me/ratings/:id` 仅本人可见（`GET /me/state` 返回自己的 rating；公开 DTO 无 rating 字段），测试覆盖“keeps ratings private”。
- 下载：`POST /api/v1/projects/:id/downloads` 要求登录，按 `(user, project, day)` 幂等，触发器原子增加 `projects.downloads_count` 和 `project_metrics_daily.downloads`（`storage/downloads.ts:8-19`；`0001_initial.sql:192-218`）。文件 GET 不计入（`routes/projects.ts:60-77`）。缺口：未按 D-28 返回一次性地址/重定向。
- 未发现公开评分/留言泄漏；未发现重复计数（迁移侧的 double-count 修复在 commit `e076c63`）。

### 4.2 推荐/参考集/站点设置

- 读取：`/api/v1/recommendations`（`routes/recommendations.ts:7-9` → `storage/home.ts:40-68`）、`/api/v1/reference-sets` 与 `/:id`（`routes/references.ts:8-17` → `storage/references.ts`）、`/api/v1/site`（`routes/site.ts:7` → `storage/home.ts:28-38`）均存在。
- 参考集只暴露版本与条目计数（`storage/references.ts:13-49`；`packages/contracts/src/references.ts:3-26` 的 `referenceVersionSchema` 只有 `worldbookCount`/`regexCount`），没有返回 `reference_items` 的 `exact_hash`/`normalized_content_hash`/`name_hash`/`structure_hash`。旧 `GET /api/character-references/versions/:id/items` 被映射到 `GET /api/v1/reference-sets/:id`（`p0-baseline.md:38`），但当前该端点只返回 set/versions 计数，客户端无法做 B10/C11 的基线指纹比对。
- 写入：**全部缺失**。没有 `INSERT/UPDATE site_settings`、`recommendations`、`reference_sets`/`reference_versions`/`reference_items` 的代码（全仓 grep 无结果）。因此 F9 Banner 设置、F10 精选设置、F11 角色基线登记、F13 站点设置都没有管理入口；`site_settings` 只能由迁移/手工 SQL 写入。
- 读取侧边界：`listRecommendations` 对非 public/未发布项目直接丢弃（`storage/home.ts:50-53`），不会泄漏 private 项目；`getBanner` 对损坏 JSON 回退默认值（`storage/home.ts:32-37`）。

### 4.3 客户端分发、R2/Workers Cache、版本门禁

- `/client/*`：`wrangler.jsonc:15` 声明 `run_worker_first`，但 `app.ts:28-37` 没有对应路由；请求会进入 Worker，然后落到 `/api` 通配之外的 404/Assets 查找，最终无文件。没有 R2 代理实现。
- R2：Worker 只把 R2 用于项目资产上传/读取（`storage/authoring.ts:298-321`、`routes/projects.ts:60-77`、`routes/admin.ts:69-77`），没有客户端产物 bucket 路径/指针。
- Workers Cache：无 `ctx.cache`/`caches.default`/`Cache-Tag`/purge；D-22 的 `Cloudflare-CDN-Cache-Control` 与 tag 失效不存在。
- 版本门禁：`config/workshop.json:2-5` 有 stable/staging 版本字符串，但只在旧构建脚本中使用（`scripts/build-workshop-legacy-shim.mjs:18-28`）；新 Worker 没有读取、没有 channel 记录、没有安装/更新拒绝路径。D-06 未实现。
- 旧客户端兼容性：`src/CreativeWorkshop/services/project-fetch.ts:311` 请求 `/api/projects/:id`，`:271` 校验 `/api/files/...`，`:322` 比较 `project.version`；新 Worker 只提供 `/api/v1/*` 且无 version 字段。即使旧 shim 仍可下载，旧客户端也无法在新 API 上完成安装/更新。这使“保留一个周期”的 shim 实际只保留了文件，不保留可用性。

### 4.4 通知

- 新 Worker/Web 无站外通知代码；D-07 明确不做，属于有意缺失。
- 站内“更新中心”仍只在旧客户端 `src/CreativeWorkshop` 中（旧 bundle 仍构建，见 `.github/workflows/bundle.yaml:44-48`）；新 UI 没有更新中心。`features.md:153` 的“站内更新中心”在新产物中不可用。

### 4.5 Cron / jobs

- 无 `scheduled` 导出（`apps/worker/src/index.ts:4-8`），`wrangler.jsonc` 无 `triggers.crons`。
- 因此以下 job 全部不存在：日榜/发现榜单生成（J1）、7d/30d 周期快照（J2）、`submitted` 领取与 DO 自动检查（D-09）、超时重试（D-31）、过期 session 清理（main §3）、孤儿 R2/旧 revision 清理（D-11/main §4）。
- schema 中 `ranking_runs`、`ranking_entries`、`discovery_exposures`（`0001_initial.sql:220-245`）无任何生产者/消费者；`project_metrics_daily.likes_delta` 也从未写入。`tools/check-schema.mjs:24-26` 只验证表存在，不验证使用。

### 4.6 管理端点

现有（`routes/admin.ts:38-128`）：submissions 列表、详情、待审文件（worldbook/regex）、review、projects、members、role。
缺失：
- `GET /api/v1/admin/audit-events`（`main.md:170`；`p0-baseline.md:88`）。
- `PUT /api/v1/site`（`main.md:170`；`p0-baseline.md:98`）。
- Banner 上传（旧 `/api/admin/discover-banner/upload`，`p0-baseline.md:99`）。
- `POST /api/v1/admin/reference-sets` / `.../versions`（`p0-baseline.md:96-97`）。
- `PUT/DELETE /api/v1/admin/recommendations/:id`（`p0-baseline.md:100`）。
- 审核详情没有 cover 文件读取（`routes/admin.ts:60-77` 只允许 worldbook/regex），而 `features.md:108` F2 要求三类文件；详情 JSON 包含 cover 资产元数据（`storage/admin.ts:180-231`），但没有内容读取路由。
- 审核列表只有 `status` 过滤（`packages/contracts/src/admin.ts:11-15`），F1 要求分页/筛选/排序；分页是 offset，不是稳定 cursor（Q-06 未定，属已知技术项）。

### 4.7 下载计数

- 计数原子性：`download_events` 插入 + `AFTER INSERT` 触发器（`0001_initial.sql:192-218`），`recordDownload` 用 `INSERT OR IGNORE` 返回 counted/duplicate（`storage/downloads.ts:14-19`）。当前路径正确。
- 计数与分发分离：`POST /downloads` 只增量，文件 GET 不增量（`routes/projects.ts:34-42,60-77`），符合 D-28 的方向。
- 缺口：D-28 的“返回一次性地址或重定向”未实现；`POST` 返回空 204。任何登录用户可每天对同一项目 POST 一次而不真正下载，计数口径是“下载动作”而非“取到文件”。是否可接受需按 D-28 原意确认。
- 公开计数展示：`toSummary` 返回 `counts.downloads`（`storage/projects.ts:88-93`），列表/详情均公开；符合 B8/D-26 的展示需求（D-27 只禁止总数/分类数/周期统计，不禁止单项目下载数）。

### 4.8 缓存头

- 动态 API：`private, no-store`（`app.ts:19-26`）；安装文件/审核文件显式 no-store（`routes/projects.ts:68`、`routes/admin.ts:75`）。没有无缓存头的 200（middleware 兜底），符合切换阶段要求。
- 公开封面：`public, max-age=60, must-revalidate`（`app.ts:58`），不是 `immutable`；R2 key 含 sha256（`storage/authoring.ts:303-305`），但响应头不是 `immutable`，也没有 `Cache-Tag`。D-17/D-22/D-24 的静态 immutable 与 tag/purge 都不成立。
- Web 静态资产：`wrangler.jsonc:11-16` 未配置 `_headers`/缓存规则；Vite 产物虽有哈希文件名（`web/dist/index.html`），但没有 `immutable` 头。
- 没有 `Cloudflare-CDN-Cache-Control`、`stale-while-revalidate`、`Cf-Cache-Status` 测量。

### 4.9 API 契约偏差汇总

1. `POST /api/v1/auth/flows/:id/redeem` 缺失（`main.md:165`）。
2. `GET /api/v1/admin/audit-events` 缺失（`main.md:170`）。
3. `PUT /api/v1/site` 缺失（`main.md:170`）。
4. `GET /api/v1/me/projects`、`GET /api/v1/me/subscriptions` 缺失（`p0-baseline.md:57-58`；features D15）。
5. `DELETE /api/v1/projects/:id` 缺失（`p0-baseline.md:63`；features D9）。
6. 管理端 reference/recommendation/banner 写接口缺失（`p0-baseline.md:96-100`）。
7. 集合端点 `/recommendations`、`/reference-sets` 不返回 `nextCursor`（`main.md:172-176` 的统一规则）；当前有 LIMIT 20，属于低风险契约偏差。
8. 项目版本字段缺失（H6）；旧 API 的 `?v=` 版本握手（E7/C17）没有对应新契约。
9. 搜索/筛选参数不完整：无 tag/authorId（`packages/contracts/src/projects.ts:51-56`）。
10. 审核请求允许客户端传 `checkerVersion` 并覆盖 submission 记录（`storage/admin.ts:278`），与 D-31 的“管理员与 DO 同 revision”冲突。

### 4.10 Schema/表不一致

- 表齐全（见 §3.2），但“建表”不等于“接通”。死表/死列：`ranking_*`、`discovery_exposures`、`project_metrics_daily.likes_delta`、`recommendations`（只读）、`site_settings`（只读）、`reference_*`（只读）、`assets.kind` 的 avatar/banner（无写入）。
- 缺失字段：项目版本标签、metadata checker revision/findings、客户端版本记录。
- `submissions.status` 包含 `checking`，但没有代码会写入；`reviews` 只有人工 review 写入。
- `sessions.last_seen_at`/`session_version` 没有滑动更新；`touchSession` 未使用。
- `projects.deleted_at` 从未写入（无删除接口），所有读路径都检查它，属于“预留但不可达”的状态。
- `assets` 的 R2 key 是内容寻址（`covers/<project>/<rev>-<sha>.png`、`projects/<project>/revisions/<rev>/<kind>-<sha>.<ext>`），与 `main.md:141` 的“R2 key（UUID）”字面不同；不影响不可变性，但迁移/清理脚本需按实际 key 规则处理。

### 4.11 Web UI 表面

- 已有：单屏列表、排序 tab、搜索框、Banner 图、详情侧栏、4/3/2/1 响应式、卡片 16:9、条目计数、schema 版本、标签（`App.tsx:11-115`；`styles.css:87,151-159`）。
- 缺失/失效：
  - **排序 tab 在无搜索词时无效**：`App.tsx:108` 渲染 `search.trim() ? projects : home?.latest ?? projects`；排序变化只更新 `projects`，空搜索时仍渲染 `home.latest`。点击下载/点赞/发布时间不会改变列表顺序。
  - 无发现栏（`home.recommendations` 未渲染）。
  - 无分页/“第 X–Y 条”/加载更多；`nextCursor` 被忽略（`web/src/api.ts:41-47` 只取一次）。
  - 无作者筛选（点作者名）。
  - 无我的项目/我的订阅/用户菜单/登录入口（`App.tsx:46` 明示“登录流程尚未接入”）。
  - 卡片缺作者头像、发布时间、更新时间、作者一句话、Discord 按钮；详情缺作者介绍、更新时间、警告分组（D-26/D-27）。
  - 无上传/审核后台 UI、无弹窗集合、无 Toast。
  - Banner 只渲染 `imageUrl`，忽略 `positionX/positionY/zoom/mobile*`（`App.tsx:88-90`）。
  - 无“已安装/待更新”本地状态高亮（依赖客户端；普通浏览器不显示是 D-29 允许的）。
- 无 CSP 头（`app.ts:19-26` 只有 nosniff/referrer-policy）；不在 §7–12 范围，但 A6 的“CORS/CSP 重做”未完成，供参考。

### 4.12 测试与文档声明核对

- `state.md:49` 声称 `pnpm e2e:local` 10/10：`tools/e2e-local.mjs:99-197` 确实有 10 个 `check`，未运行验证，但静态计数一致。
- `state.md:51` 的 staging 部署/回滚/5xx 声明无法从仓库验证，只能作为运营记录。
- `state.md:52` 声称 P6 删除 `tests/e2e/`、`playwright.config.mjs`：仓库确无这些文件；但 `features.md:176` T4 要求“保留 5–8 条 Playwright 真实旅程”，二者冲突，当前以删除告终。
- `state.md:87` 声称独立 evaluator “CLEAN；无未解决发现”，但本审计在分发、cron、管理端、缓存、版本字段、测试保留项上发现多处缺口；该声明至少对 `features.md`/`decisions.md` 的完整度不成立。
- `state.md:88,97-100` 已记录的阻塞项（OAuth callback、checker DO、SillyTavern、R2 复制）与仓库现状一致；但**未**记录客户端分发、cron/榜单、管理端设置/审计、缓存专项、项目版本、metadata checker、T2/T3/T6、D-08 这些缺口。
- `p4-migration.md` 的演练数字与 `state.md:49`/README 一致；`tools/migrate` 的 verify/reconcile 测试入口存在（`package.json:9`）。
- `p5-cutover.md:40` 明确“未完成：真实登录 OAuth（缺 callback/redeem）”，与代码一致。
- `p6-cleanup.md:60-63` 明确保留旧客户端/配置/test-dist/util checker，说明这些不是“遗漏”，但 `features.md`/`decisions.md` 的新分发目标仍未实现。

## 5. 发现（按可修复性排列）

### 5.1 排序 tab 在默认视图完全不生效

- 证据：`apps/worker/web/src/App.tsx:92-103` 更新 `sort`；`App.tsx:63-70` 按 `sort` 拉取 `projects`；但 `App.tsx:108` 在搜索为空时渲染 `home?.latest ?? projects`，忽略 `projects`。
- 影响：默认首页（无搜索）点击“发布时间/下载/点赞”没有任何视觉变化，违反 B1/D-32；只有输入搜索词后排序才生效。
- 修复方向：无搜索时也渲染 `projects`（`home.latest` 只作为首屏占位/初始数据），或在 `sort` 变化时重置 `home.latest`。不是文档缺失，是当前实现 bug。

### 5.2 1–2 字搜索绕过 FTS 短索引

- 证据：`apps/worker/src/storage/projects.ts:125-139` 对 `<=2` 字使用 5 个 `LIKE '%x%'`；`project_search_short` 由触发器维护（`0001_initial.sql:333-359`），但全仓无查询使用（只有 `tools/check-schema.mjs:77` 测试它可 MATCH）。
- 影响：中文 1–2 字搜索退化为全表扫描 + `LIKE`，违反 `features.md:32`“重建索引，不换 LIKE”和 D-14；随项目数增长会撞 D-25 的 rows-read 预算。
- 修复方向：按 schema 设计的 spaced-text 查询 `project_search_short MATCH`，保留 `LIKE` 仅作极端回退（或删除短索引）。

### 5.3 管理员审核接受任意 checkerVersion

- 证据：`apps/worker/src/storage/admin.ts:278` `const checkerVersion = request.checkerVersion ?? target.checker_revision;`；contract 允许任意字符串（`packages/contracts/src/admin.ts:17-22`）；测试 `admin-review.test.ts:91-98` 明确把 `checker-1` 覆盖成 `review-2`。
- 影响：D-31 要求“同一 submission 的 DO 报告与管理员界面使用同一个 review_checker_revision”，本地重跑只能用固定 revision 且标为辅助。当前接口允许管理员提交任意 revision 并写入 `reviews.checker_version`，审计链会与 DO 报告脱节。checker 尚未实现，但接口契约已经埋下违反点。
- 修复方向：`checkerVersion` 不接受客户端自由值；从 submission 读取 `checker_revision`，若请求值不同则 409/400（除非显式“重跑”流程并写审计）。

### 5.4 D-30 元数据检查缺失且 Discord URL 无白名单

- 证据：`packages/contracts/src/authoring.ts:12` `discordThreadUrl: z.string().url()` 接受任意 URL；`routes/authoring.ts:50-121` 只做 zod 校验；schema 无 `metadata_checker_revision`/findings；封面只验 MIME/大小（`routes/authoring.ts:138-148`），无尺寸/解码限制。
- 影响：违反 D-30 的 URL 允许列表、控制字符、版本格式、封面尺寸、频率限制与审计要求；任意 URL 会进入公开 `discordThreadUrl`。
- 修复方向：新增同步 metadata checker（domain 包），校验 Discord host/path、控制字符、版本 semver、封面尺寸；写 findings/`metadata_checker_revision` 审计；block 时返回 4xx 且不创建 revision。

### 5.5 下载计数缺少一次性地址

- 证据：`routes/projects.ts:34-42` 返回 `204`；`storage/downloads.ts:8-19` 只记账；`routes/projects.ts:60-77` 单独 GET 文件。
- 影响：`decisions.md:243` 明确要求 POST 返回一次性地址或重定向；当前客户端可以只 POST 不下载，计数语义与“下载”脱钩。是否阻断取决于产品对计数口径的要求，但属于契约未实现。
- 修复方向：POST 在记账后签发短期一次性 token/签名 URL（或 302 到带 token 的文件路由），文件路由消费 token 且不再单独计数。

### 5.6 旧客户端与新 API 不兼容

- 证据：`src/CreativeWorkshop/services/project-fetch.ts:271` 校验 `/api/files/...`，`:311` 请求 `/api/projects/:id`，`:322` 比较 `project.version`；新 Worker 只有 `/api/v1/*`（`app.ts:28-37`），且无 version 字段（schema `70-93`）。
- 影响：H2/D-33 计划“旧 shim 保留一个周期”，但旧 bundle 在新 Worker 上无法完成项目详情/安装/更新；切流后旧客户端会整体失效，而不是平滑迁移。`state.md:91`/`p6-cleanup.md:60-63` 只记录了保留，没有记录不兼容。
- 修复方向：在旧客户端下架窗口内提供 `/api/projects/:id`、`/api/files/*` 兼容路由（映射到新 release/manifest），或明确停止旧客户端并在分发层返回迁移提示。

### 5.7 内容策略/元数据检查未接入提交路径

- 证据：`packages/domain/src/content-policy.ts:45-62` 的 `validateProjectContentPolicy` 和 `packages/domain/src/project-content.ts:169` 的 `validateProjectContentText` 只有 domain 单测（`packages/domain/test/content-policy.test.ts:5-22`），`apps/worker/src` 无调用；`routes/authoring.ts:124-161` 只校验 MIME/大小，`storage/authoring.ts:323-343` 只统计条目数，不做结构/策略校验。
- 影响：空世界书、错误 JSON、类型与内容不匹配的项目可以进入 `pending`；在 checker/DO 缺失（`state.md:98`）时只能依赖人工审核发现。`features.md:85` D14 与 `decisions.md:269-279` D-30 要求的提交前检查没有落地。
- 修复方向：在 `submit`（或上传完成时）调用 domain 的策略/结构校验，把 findings 写入 revision/submission；block 时拒绝提交并返回 findings。

### 5.8 参考集接口缺少条目指纹

- 证据：`storage/references.ts:13-49` 的 `listReferenceSets` 只聚合 `worldbook_count`/`regex_count`；`packages/contracts/src/references.ts:3-26` 没有 item/hash 字段；`reference_items` 表有 `exact_hash`/`normalized_content_hash`/`name_hash`/`structure_hash`（`0001_initial.sql:291-307`），但没有读取路径。
- 影响：`features.md:39` B10（角色基线引用，官卡版本 + 指纹）与 C11（原版冲突处理，基线指纹）缺少数据面；`p0-baseline.md:38` 映射的旧 items 端点在新 API 中退化成了“版本计数”，客户端无法判断原版冲突。
- 修复方向：在 `GET /api/v1/reference-sets/:id` 返回版本的 items/hash，或恢复独立的 `.../versions/:versionId/items` 端点并加入契约测试。

## 6. Surprises（与 state.md 的完成声明不符）

1. **`/client/*` 只在 `run_worker_first` 里出现，没有任何 handler。** `wrangler.jsonc:15` 与 `app.ts:28-37` 对照即可确认；D-05/D-22/H5 全部落空，但 `state.md` 未把它列为阻塞。
2. **完全没有 cron/scheduled。** `src/index.ts:4-8` 只有 `fetch`，`wrangler.jsonc` 无 `triggers`；J1/J2/D-09/D-11 的“清理/调度”全部无法运行，`ranking_*` 表是死表。
3. **main.md §5 的两个管理端点根本不存在。** `GET /admin/audit-events` 与 `PUT /site` 在 `routes/admin.ts:38-128`、`routes/site.ts:7` 中都没有；`audit_events` 只有写没有读。
4. **项目版本标签从新模型消失。** `features.md:140` H6 写“保留”，但 schema `project_revisions` 无列、contracts 无字段、domain 版本工具无人调用；旧客户端依赖的 `project.version` 永远 undefined。
5. **D-08 没有执行。** `config/workshop.json:30-42` 仍列两个配套脚本，`src/CreativeWorkshop/bridge/host.ts:408-413` 仍提供依赖检查 bridge；这不是“旧客户端保留”能解释的，因为工坊配置与 bridge 协议也仍在。
6. **T2/T3/T6 这些“保留/新增”测试不存在。** `tests/` 只剩 fixtures；`apps/worker/test`/`packages/domain/test` 没有 EJS checker 语料、fingerprint/diff/安装安全、legacy fixture 契约测试。`state.md:52` 的 P6 删除说明只提到删除 `tests/e2e/`，没有说这些保留项也消失了。
7. **D-24 Workers Cache 专项没有任何回写或测试。** `main.md:181-193` 仍是计划文字，代码无 `Cache-Tag`/`ctx.cache`/purge；`main.md:193` 只是“见 D-24”，没有研究结果。
8. **D-10 的“不存储请求里的 Origin”与实现相反。** `oauth_flows.origin` 存在（schema `29-42`），`insertAuthFlow` 写入 `flow.origin`（`storage/identity.ts:60-63`），`auth.ts:40-89` 用请求 Origin 生成 URL。先校验白名单降低了风险，但决策文字需要澄清或修正实现。
9. **生产 session 创建路径不存在。** 全仓 `INSERT INTO sessions` 只在测试/e2e 出现；即使补上 Discord callback/redeem，当前也没有 `createSession`/过期/滑动续期的生产代码。`state.md:88,97` 只提 callback/redeem，没有提这一层。
10. **`state.md:87` 的“evaluator CLEAN”无法覆盖上述缺口。** 该声明与 `features.md` §7–§12 的完成度、main §5 的端点清单、D-05/D-22/D-24 的存在性直接冲突；应视为“对某个切片/某次复审的结论”，不能当作整体完成声明。

## 7. 有意延期 vs 意外缺失

| 项 | 文档依据 | 分类 | 说明 |
|---|---|---|---|
| Discord OAuth callback/redeem/device、真实登录 | `state.md:97`、`p5-cutover.md:40` | 有意延期（缺凭据） | 仓库只实现 flow 创建/状态；没有 secret，不能伪造登录。 |
| ContentService DO + 权威 checker + 自动发布 | `state.md:98`、`p6-cleanup.md` §1 | 有意延期（缺 checker 实现/语料） | D-01/D-09/D-31 的 blocker 有明确记录；但“自动发布”分支、检查器语料、超时重试仍应列为未实现。 |
| 真实 SillyTavern / Tavern client 验证 | `state.md:99` | 有意延期（环境） | 本机无运行中的 ST；未用 mock 冒充。 |
| 真实备份导入 staging / R2 对象复制 | `state.md:100` | 有意延期（未获批准/适配器缺失） | 本地 D1 load 已完成；R2 复制与 staging 导入未做。 |
| `test-dist` shim / 旧客户端保留 | `state.md:91`、`p6-cleanup.md:60-63` | 有意保留（窗口期） | 保留本身是计划；但新 Worker 不服务 shim、旧客户端不兼容，属于保留策略内的未完成部分。 |
| Q-10 每日抽签 | `decisions.md:328` | 待产品决策 | 入口收起；接口/配额未迁移，未自行发明。 |
| 生产切换 | `p5-cutover.md:42-56`、`state.md:90` | 待人工审批 | 只完成本地/staging 演练。 |
| `/client/*`、R2 代理、版本门禁、迁移提示 | `features.md:135-142`、`decisions.md:26-32,140-158,307-312` | **意外缺失** | 不依赖凭据或 checker，可直接实现；`state.md` 未列为延期。 |
| cron/榜单/周期快照/清理 | `features.md:160-161`、`decisions.md:76-78,174-197` | **意外缺失** | 表和配置都在，缺 scheduled handler。 |
| 管理端 audit/site/reference/recommendation/banner 写入 | `main.md:170`、`p0-baseline.md:88-100` | **意外缺失** | main §5 明确列出，代码完全没有。 |
| Workers Cache D-24/D-28 第二阶段 | `decisions.md:160-172,225-247`、`main.md:181-193` | **意外缺失/未开始** | 生产未开 cache，未造成泄漏；但“重构必做”研究未做。 |
| 项目版本标签 H6 | `features.md:140`、`decisions.md:269-279`（D-30） | **意外缺失** | schema/contracts 均无字段。 |
| 元数据检查 D-30 | `decisions.md:269-279` | **意外缺失** | 只有 zod 基础校验。 |
| T2/T3/T6 测试保留/新增 | `features.md:174-178`、`decisions.md:80-82` | **意外缺失** | 旧测试删除后没有重建，fixtures 未使用。 |
| D-08 配套脚本移除 | `decisions.md:38-40` | **意外缺失** | 配置/bridge 仍在。 |
| UI 发现栏/分页/我的项目/作者筛选/Toast/警告/Discord | `decisions.md:199-223,294-305` | **意外缺失** | React 壳只完成列表/排序/搜索/详情的最小集；排序还有 bug。 |

## 8. 使用的只读命令

- `git log --oneline -8`、`git status --short`、`git log -1 --format=%H`
- `git ls-files`（确认 `dist/` 未跟踪、`test-dist/`/`src/` 仍跟踪）
- `find apps packages tools tests config -type f ...`、`find src util scripts test-dist dist -type f`、`ls docs/audits`
- `read` 读取 `features.md`、`decisions.md`、`main.md`、`state.md`、`p0-baseline.md`、`p4-migration.md`、`p5-cutover.md`、`p6-cleanup.md`
- `read` 读取 `apps/worker/src`、`apps/worker/web/src`、`packages/*`、`tools/*`、`.github/workflows/*`、`config/workshop.json`
- `grep -rn` 检查：`scheduled|DurableObject|getByName`、`/client|Cache-Tag|purge|CDN-Cache|caches.`、`audit_events|INSERT INTO audit`、`ranking|discovery|period`、`project_search_short`、`metadata_checker|rows_read|backup|notify|toast`、`INSERT INTO sessions|session_version`、`INSERT INTO reference|site_settings|recommendations`、`draw|lottery|quota`
- `sed -n`/`grep -n` 读取指定行范围；`cat` 读取小型配置/契约/测试文件；`wc -c`、`grep -c` 统计
- `test -d packages/content`（确认不存在）
- 未运行 `pnpm test`、`pnpm check`、`pnpm e2e:local`、wrangler 或任何会写 D1/R2/网络的命令。

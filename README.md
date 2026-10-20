# 命定创意工坊

这是「命定之诗与黄昏之歌」的**创意工坊**独立仓库，包含两个可独立部署的运行时：

- **SillyTavern 客户端脚本**：在酒馆内打开工坊界面，浏览、安装、更新和修复社区项目；
- **Cloudflare Worker 后端**：项目上传、审核、发布、点赞、订阅、鉴权与文件分发。

角色卡本体、世界书、立绘素材和自适应正则美化脚本不在本仓库维护。

## 仓库结构

```text
workshop/
├─ apps/worker/              # 唯一后端：Hono + D1 + R2 + Static Assets
│  ├─ migrations/            # D1 结构演进（唯一迁移序列）
│  ├─ src/                   # API 与存储层
│  └─ web/                   # 管理/浏览站点（React + Vite）
├─ packages/contracts/       # 共享 Zod 契约与类型
├─ packages/domain/          # 分类、内容策略、限额、版本等纯函数
├─ src/CreativeWorkshop/     # 酒馆客户端脚本（过渡期保留）
├─ config/workshop.json      # 客户端版本、分发路径与兼容迁移
├─ data/                     # 官方角色卡基线指纹等运行时数据
├─ tools/                    # workspace/schema 校验与旧数据迁移 CLI
├─ docs/plans/refactor-2026-10/  # 重构决策、P0 基线、P5/P6 记录
└─ tests/fixtures/legacy/    # 旧公开接口匿名响应夹具
```

`cloudflare/` 旧 Worker 与旧首页 UI 已删除；旧实现只保留在 git 历史中。新的数据库结构只认 `apps/worker/migrations/`。

## 客户端

入口是 [`src/CreativeWorkshop/index.ts`](src/CreativeWorkshop/index.ts)。它在 SillyTavern 中创建 iframe，并通过 postMessage bridge 与宿主页面通信：

- 安装、更新、卸载项目世界书与正则；
- 项目差异对比与冲突处理；
- DLC 修复、安装状态登记与脚本依赖检查。

客户端版本、分发路径和兼容迁移由 `config/workshop.json` 决定。`dist/` 与 `test-dist/` 是构建产物，不手工维护。

## 后端

唯一 Worker 位于 [`apps/worker/src/index.ts`](apps/worker/src/index.ts)，技术栈为 Cloudflare Workers + Hono，数据存储为 D1，文件存储为 R2，静态站点通过 Static Assets 提供。

- 公开读取：首页、项目列表/详情、推荐、参考集、站点信息；
- 登录后读取：发布清单、文件下载；
- 作者：创建、编辑、上传、提交审核；
- 审核：待审队列、发布指针切换、成员角色、审计；
- 互动：点赞、订阅、评分、按用户/项目/日幂等的下载计数。

接口以 `/api/v1` 为前缀。契约在 `packages/contracts`，领域规则在 `packages/domain`，两者都是唯一来源。

## 本地开发

根目录使用 pnpm：

```text
pnpm install
pnpm check                 # workspace、类型、测试、schema、迁移测试、wrangler dry-run
pnpm e2e:local             # 启动真实 workerd + 本地 D1/R2，跑 10 条 HTTP E2E
pnpm --filter @workshop/worker dev
pnpm --filter @workshop/worker web:build
```

本地 D1：

```text
cd apps/worker
pnpm exec wrangler d1 migrations apply workshop-staging --local --config wrangler.jsonc
```

## 部署

Git 仓库与 Cloudflare 运行时是两套独立状态。部署前必须记录被部署的确切提交 SHA，并在部署后单独验证 Worker 版本；推送代码不等于部署。

- 配置与绑定：`apps/worker/wrangler.jsonc`
- 部署前：`pnpm check`，并先执行 `pnpm --filter @workshop/worker web:build`
- 迁移：`wrangler d1 migrations apply <database> --remote --config apps/worker/wrangler.jsonc`
- 旧备份：`python3 tools/migrate/from_d1_sql.py <dump.sql> <r2-dir> <临时输出目录>`，再用 `tools/migrate/cli.mjs` 执行/校验/对账
- 密钥只通过 `wrangler secret put` 写入，不进入仓库

P5 切换演练与 P6 清理记录见 `docs/plans/refactor-2026-10/`。

## 许可证

本仓库原创内容采用 [`CC BY-NC-SA 4.0`](LICENSE) 授权。第三方接口、平台服务及其素材不因本仓库授权而改变原有许可，使用者需自行遵守对应条款。

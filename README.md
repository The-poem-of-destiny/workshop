# 命定创意工坊

这是「命定之诗与黄昏之歌」的**创意工坊**独立仓库，包含两部分：

- **SillyTavern 客户端脚本**：在酒馆内打开工坊界面，浏览、安装、更新和修复社区项目；
- **Cloudflare Worker 后端**：项目上传、审核、发布、点赞、订阅、鉴权与文件分发。

角色卡本体、世界书、立绘素材和自适应正则美化脚本不在本仓库维护。

## 仓库结构

```text
workshop/
├─ src/CreativeWorkshop/     # 客户端脚本：桥接、安装、修复、差异对比
├─ cloudflare/
│  ├─ src/                   # Worker 路由、页面与业务逻辑
│  ├─ migrations/            # D1 结构演进
│  ├─ tests/                 # Worker / 页面冒烟测试
│  └─ schema.sql             # 新数据库基线结构
├─ config/workshop.json      # 客户端版本、分发路径、服务地址的唯一事实来源
├─ scripts/                  # 构建、产物校验与部署辅助脚本
├─ data/                     # 官方角色卡基线指纹等运行时数据
├─ tests/                    # 浏览器端到端测试
├─ dist/                     # 正式构建产物
└─ test-dist/                # 历史公开导入路径的兼容 shim
```

## 客户端

入口是 [`src/CreativeWorkshop/index.ts`](src/CreativeWorkshop/index.ts)。它在 SillyTavern 中创建 iframe，并通过 postMessage bridge 与宿主页面通信：

- 安装、更新、卸载项目世界书与正则；
- 项目差异对比与冲突处理；
- DLC 修复、安装状态登记与脚本依赖检查。

`dist/` 下的正式产物由 `config/workshop.json` 的 `client.stable` / `client.publicPath` 决定；历史 `test-dist` 路径只保留一个自我改写的兼容 shim。当前版本号、分发路径和端点不要在文档里再维护第二份。

## 后端

Worker 代码位于 [`cloudflare/src/index.ts`](cloudflare/src/index.ts)，技术栈为 Cloudflare Workers + Hono + chanfana（OpenAPI 3.1），数据存储为 D1，文件存储为 R2，OAuth 状态使用 KV。

能力范围：

- Discord OAuth 登录与登录态查询；
- 项目列表、详情、创建、更新、删除与可见性；
- 世界书 / 正则 / 封面文件上传与审核；
- 点赞、订阅、搜索、排序与首页展示；
- 管理员审核队列、项目管理、管理员与审计日志；
- 结构化项目分类、官方标签、自定义标签与展示标签。

产品规则与分类定义的唯一来源在 `cloudflare/src/config/`；上传与请求上限在 `cloudflare/src/config/runtime-limits.ts`。

## 本地开发

根目录使用 pnpm：

```text
pnpm install
pnpm build              # 构建正式产物与兼容 shim
pnpm watch              # 开发监听
pnpm check:workshop-config
pnpm check:workshop-bundles
```

Worker 目录使用 npm：

```text
cd cloudflare
npm install
npm run dev             # 本地 Worker
npm run cf-typegen      # 修改 wrangler.jsonc 绑定的必做步骤
npm run check:types
npm run check:home-js-smoke
```

端到端测试使用 Playwright，命令见根 `package.json`。

## 部署

Git 仓库与 Cloudflare 运行时是两套独立状态。部署前必须记录被部署的确切提交 SHA，并在部署后单独验证 Worker 版本；推送代码不等于部署。

部署脚本与检查入口在 `scripts/deployment/`，环境配置在 `cloudflare/wrangler*.jsonc`。密钥只通过 `wrangler secret put` 写入，不进入仓库。

## 许可证

本仓库原创内容采用 [`CC BY-NC-SA 4.0`](LICENSE) 授权。第三方接口、平台服务及其素材不因本仓库授权而改变原有许可，使用者需自行遵守对应条款。

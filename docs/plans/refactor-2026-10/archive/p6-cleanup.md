# P6 清理清单

前置：P2–P5 各自验收通过；删除前用 `grep`/LSP 证明零引用。P6 只在 `refactor/2026-10` 分支执行，不 push。

## 1. 旧运行时代码

- [x] `cloudflare/src/pages/home/**`、`pages/home.ts`（随 `cloudflare/` 整体删除）
- [x] `/assets/home.js` 动态路由与 `check-home-js.mjs` 的 `new Function()` 验证
- [x] `contentServiceKey` 正则分发器
- [ ] 旧 `CodeCheckService` 命名；新 `ContentService` DO 尚未实现，P3 仍为已知缺口
- [x] `caches.default` ×3、客户端 TTL 缓存、`forceRefresh`
- [x] `utils/auth.ts` KV session
- [x] `project-ranking-snapshots.ts` 与仅被它引用的测试

## 2. 旧数据/表

- [x] `public_project_counts` 及 trigger
- [x] `admins`、`super_admins`
- [x] `project_rank_snapshots`、`project_ranking_days`
- [x] 旧搜索派生表
- [x] 旧缓存 revision、锁 token

旧表只存在于旧 D1；新 schema 不创建它们。生产旧库不在本轮删除范围。

## 3. 构建/部署

- [x] `test-bundles/`
- [x] `wrangler.frontend.jsonc`（随 `cloudflare/` 删除）
- [x] committed `cloudflare/src/generated/*.txt`
- [x] `scripts/deployment/*.ps1`
- [x] `sync-staging-from-backup.py`
- [x] 重复 lockfile（`cloudflare/package-lock.json`）
- [ ] `test-dist` shim：客户端仍有 `config/workshop.json` 兼容迁移，下架窗口后删除
- [x] 旧 `dist/` 产物（不再提交，构建生成）

## 4. 旧测试

- [x] 所有读源码做正则断言的脚本
- [x] 为死代码保留的测试
- [x] 只打线上 staging 的 Playwright 默认配置（旧 `tests/e2e/` 与 `playwright.config.mjs` 已删除）

## 5. 验证

- [x] `grep`/`rg` 旧路径零引用（历史文档与生成产物注释除外）。
- [x] `pnpm check` 全绿。
- [ ] 新 Worker 在 staging 冒烟（本地已冒烟；staging 部署未执行）。
- [x] `state.md` 记录删除清单与未删项（附原因）。
- [x] 不修改 `data_backup/`，不提交任何 dump。

## 6. 顺序

1. 删测试与死代码（低风险）。
2. 删旧路由/缓存/UI。
3. 删旧表与 migration 依赖（确认无读）。
4. 删构建产物与部署脚本。
5. 最后删 `cloudflare/` 剩余目录；保留 git 历史。

## 7. 保留项

- `src/CreativeWorkshop/`：酒馆客户端仍在过渡期，尚未迁到 `apps/tavern-client`。
- `config/workshop.json`：客户端分发与兼容迁移仍以其为准。
- `test-dist/CreativeWorkshop/index.js`：只服务旧导入路径迁移，删除时间取决于客户端下架窗口。
- `util/ejs-checker-v2.js`：生成产物，但客户端仍引用；后续随客户端迁移处理。

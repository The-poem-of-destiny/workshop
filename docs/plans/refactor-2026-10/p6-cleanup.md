# P6 清理清单

前置：P2–P5 各自验收通过；删除前用 `grep`/LSP 证明零引用。P6 只在 `refactor/2026-10` 分支执行，不 push。

## 1. 旧运行时代码

- [ ] `cloudflare/src/pages/home/**`、`pages/home.ts`
- [ ] `/assets/home.js` 动态路由与 `check-home-js.mjs` 的 `new Function()` 验证
- [ ] `contentServiceKey` 正则分发器
- [ ] 旧 `CodeCheckService` 命名；保留一个 `ContentService` DO（若 P3 已实现）
- [ ] `caches.default` ×3、客户端 TTL 缓存、`forceRefresh`
- [ ] `utils/auth.ts` KV session
- [ ] `project-ranking-snapshots.ts` 与仅被它引用的测试

## 2. 旧数据/表

- [ ] `public_project_counts` 及 trigger
- [ ] `admins`、`super_admins`
- [ ] `project_rank_snapshots`、`project_ranking_days`
- [ ] 旧搜索派生表（若新 FTS 完全替代）
- [ ] 旧缓存 revision、锁 token

## 3. 构建/部署

- [ ] `test-bundles/`
- [ ] `wrangler.frontend.jsonc`
- [ ] committed `cloudflare/src/generated/*.txt`
- [ ] `scripts/deployment/*.ps1`
- [ ] `sync-staging-from-backup.py`
- [ ] 重复 lockfile（`cloudflare/package-lock.json` 在 npm 迁移完成后）
- [ ] `test-dist` shim（下架窗口后）
- [ ] 旧 `dist/` 产物（若已由 CI artifact/R2 替代）

## 4. 旧测试

- [ ] 所有读源码做正则断言的脚本
- [ ] 为死代码保留的测试
- [ ] 只打线上 staging 的 Playwright 默认配置（改为本地 Worker）

## 5. 验证

- [ ] `grep`/`rg` 旧路径零引用；LSP references 为空。
- [ ] `pnpm check` 全绿。
- [ ] 新 Worker 在 staging 冒烟。
- [ ] `state.md` 记录删除清单与未删项（附原因）。
- [ ] 不修改 `data_backup/`，不提交任何 dump。

## 6. 顺序

1. 删测试与死代码（低风险）。
2. 删旧路由/缓存/UI。
3. 删旧表与 migration 依赖（确认无读）。
4. 删构建产物与部署脚本。
5. 最后删 `cloudflare/` 剩余目录；保留 git 历史。

# P5 切换演练与生产 runbook

本轮只做**本地/staging 演练**；真实生产切换必须人工审批。旧系统保持在线，直到演练与对账全部通过。

## 1. 预检

- [ ] `refactor/2026-10` 全绿：`pnpm check`。
- [ ] 新库 migration 在本地应用成功：`wrangler d1 migrations apply --local`。
- [ ] `data_backup/` 快照可读，且未提交；记录快照时间。
- [ ] 旧系统只读/停写开关可用；覆盖 OAuth 写、文件 GET 计数、发布/审核/互动写。
- [ ] 生产 runbook 的审批人、回滚窗口、观察指标已确认。

## 2. 本地演练

```text
1. 关闭旧系统写入口（本地快照/只读模式）。
2. 用新 migration 建空库。
3. tools/migrate/cli.mjs all --source data_backup --target .tmp/migration.json
4. tools/migrate/cli.mjs reconcile --source data_backup --target .tmp/migration.json
5. 应用迁移到本地 D1；抽样安装 manifest/files。
6. 启动新 Worker：pnpm --filter @workshop/worker dev
7. 跑 pnpm check + Playwright 本地旅程。
8. 重跑迁移，确认幂等；delta 重跑结果一致。
```

验收：

- 对账全过（项目数、published 指针、每项目文件 sha256、互动数、评分、审计、FK）。
- 公开读差分样本通过；私有/草稿/审核数据不泄露。
- 安装 manifest/files 对抽样项目可用。
- 5xx < 0.5%（本地/ staging 压测）。

## 3. Staging 演练

1. 部署同一 commit 到 staging（仅 staging）。
2. 对 staging D1 应用 migration。
3. 用脱敏样本或 `data_backup` 的 staging 子集跑迁移。
4. 冒烟：`/api/v1/health`、列表、详情、搜索、登录、manifest/files、审核队列。
5. 验证缓存头：动态 API `private, no-store`；封面/静态资产按策略。
6. 记录 Worker version、commit SHA、migration 列表、artifact hash。
7. 演练回滚：部署上一版本，确认旧代码仍可服务 staging。

## 4. 生产切换（人工审批）

1. 记录要部署的精确 SHA 与 migration 列表。
2. 开停写屏障；确认旧 OAuth 与文件计数写入已停。
3. 最终 delta 迁移 + 对账。
4. 部署新 Worker（tag + environment 审批）。
5. 受控账号冒烟：登录、列表、详情、安装、审核。
6. 开放写入；监控 5xx、D1 rows、CPU、缓存命中。
7. 旧 D1/R2 只读保留 7–90 天；开放写入后只承诺回滚代码，不承诺无损回旧库。

## 5. 回滚

- 开放写入前：回旧 Worker + 旧库，停止新库写入。
- 开放写入后：只回滚 Worker 代码；旧库不再接收新数据，反向迁移需单独演练。
- 任何回滚都要记录原因、时间、影响范围。

## 6. Stop conditions

- 对账任一不一致。
- 私有/草稿数据出现在公开响应。
- 迁移不可幂等或 delta 结果不一致。
- staging 5xx 超阈值、D1 预算超限。
- 真实生产切换未获人工审批。

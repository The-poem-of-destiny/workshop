# P5 切换演练与生产 runbook

本轮只做**本地/staging 演练**；真实生产切换必须人工审批。旧系统保持在线，直到演练与对账全部通过。

## 1. 预检

- [ ] `refactor/2026-10` 全绿：`pnpm check`。
- [ ] 新库 migration 在本地应用成功：`wrangler d1 migrations apply --local`。
- [ ] `data_backup/` 快照可读，且未提交；记录快照时间。
- [ ] 旧系统只读/停写开关可用；覆盖 OAuth 写、文件 GET 计数、发布/审核/互动写。
- [ ] 生产 runbook 的审批人、回滚窗口、观察指标已确认。

## 2. 本地演练

已完成（2026-10-21）：

- 本地 D1 应用 `0001_initial.sql`：59 条命令成功。
- 真实备份：`from_d1_sql.py` 导出 7 张表 + 935 个 R2 资产（429 封面 / 67 正则 / 439 世界书，0 缺失）；全量跑两次字节一致；verify/reconcile 全过；`--since 2026-09-01` delta 也通过。
- 本地 HTTP E2E：`pnpm e2e:local` 10/10（health、静态 UI、列表、创建、上传、私有 404、发布提交、审核公开读、下载幂等、Origin 拒绝）。
- 实际浏览器：本地 Chromium 打开首页，标题「命定创意工坊」，读到 E2E Project 卡片。

验收：

- [x] 对账全过（项目数、published 指针、每项目文件 sha256、互动数、评分、审计、FK）。
- [x] 公开读差分样本通过；私有/草稿/审核数据不泄露。
- [x] 安装 manifest/files 对抽样项目可用。
- [x] 5xx < 0.5%：staging 200 次 health/list 请求 0 个 5xx、0 个非 200。

## 3. Staging 演练

已完成（2026-10-21，账户 `ThisAccount`，仅 staging）：

1. 对 `workshop-staging` D1 远程应用 `0001_initial.sql`：59 条命令成功。
2. `wrangler deploy --env staging` 成功；Worker version `bda4def5-7fb2-42da-b13b-23821d74759d`。
3. 冒烟：`/api/v1/health` 200、`/api/v1/projects` 200、`/` 200 HTML、无 Origin 的 auth flow 403。
4. 动态响应带 `private, no-store`，安全头正常。
5. 未导入真实备份到 staging；`data_backup` 只在本地演练使用。

未完成：staging 回滚演练、真实登录 OAuth（缺 callback/redeem）。

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

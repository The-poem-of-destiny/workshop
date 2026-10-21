# API 设计（第一性原理）

更新：2026-10-21  
性质：目标契约。实现与本文不一致时，以本文推导的职责边界为准，并在同一改动中修正实现或明确延期。

## 1. 用户旅程

1. **匿名发现**：浏览/搜索/筛选公开项目，查看公开摘要、封面、预计算条目索引；不接触 release 字节。
2. **登录与准入**：Discord OAuth 完成身份、公会/身份组校验，得到 opaque session；浏览不需要登录。
3. **获取内容**：已登录且客户端 channel/version 精确匹配；服务端授权唯一当前 release，票据取字节；安装状态由本地世界书与客户端记录。
4. **创作**：创建项目、编辑 working revision、上传不可变资产、提交冻结 revision；写操作带 `If-Match`。
5. **审核**：只拉 `pending` 工作队列；DO 自动检查决定 pass/warn/block；人工决定绑定 submission + manifest + checker revision。
6. **个人状态**：点赞、订阅、评分为私有关系；公开计数是展示投影。
7. **分发**：客户端/checker 按 channel + 不可变版本对象分发；稳定指针只做指针。

## 2. 领域不变量

- 公开读只来自 `published_revision_id` + `public` + 未删除；不泄露私有 release。
- 订阅是用户意图；下载事件是计量；安装状态只在本地。三者不互相替代（D-35）。
- 下载计数只在字节成功返回时发生；票据申请不计数，失败不计数。
- 审核队列只包含可执行工作 `pending`；`checking` 只作为计数。
- 发布只移动 `published_revision_id`；R2 字节不可变，不复制保留资产。
- 客户端 channel/version 必须精确匹配；缺失不得视为兼容（D-06）。
- 公开计数允许短暂展示延迟，但个人写操作必须读己所写。

## 3. 状态归属

| 状态 | 权威 | 说明 |
|---|---|---|
| 身份/角色/session | D1 | 每请求校验 |
| 项目/working/published revision | D1 | `If-Match` 并发控制 |
| 发布字节 | R2 | 不可变对象，按 revision/asset 引用 |
| 订阅/点赞/评分 | D1 | 私有用户关系 |
| 下载事件/计数 | D1 | user/project/day 幂等，仅计量 |
| 已安装/已下载/可更新 | 本地 ST + 客户端 | 服务端不建 install 表 |
| 客户端/checker 版本 | D1 `client_channels` + R2 | channel 指针 + 不可变版本对象 |
| 公开列表/详情 | D1 投影 + 可选 Public 缓存 | 公开且可失效 |

## 4. 缓存与一致性

- 动态私有 API：`private, no-store`。
- 公开投影（列表/详情/发现/榜单/推荐）允许 30 秒 Workers Cache，键含 `cache_epoch`；tag purge 与网关级缓存未验收前不宣称完成（D-37）。
- 计数器是展示投影，允许有界 TTL/SWR；不以缓存值做权限或写入判断。
- 文件票据/内容响应永不 public cache。
- `/api/v1/client/compatibility` 与 `/client/*` 因无 session、跨 SillyTavern 源加载，允许 `Access-Control-Allow-Origin: *`；其余 API 使用 Origin 白名单。

## 5. 资源与端点

```text
# 公开目录
GET    /api/v1/projects?cursor=&sort=&q=&type=&tag=&author=
GET    /api/v1/projects/:id
GET    /api/v1/projects/:id/entries
GET    /api/v1/discoveries/current
GET    /api/v1/home
GET    /api/v1/site
GET    /api/v1/reference-sets
GET    /api/v1/reference-sets/:id

# 身份
POST   /api/v1/auth/flows
GET    /api/v1/auth/flows/:id
POST   /api/v1/auth/flows/:id/redeem
GET    /api/v1/auth/callback
GET    /api/v1/me
DELETE /api/v1/sessions/current

# 个人状态
GET    /api/v1/me/state?ids=
GET    /api/v1/me/subscriptions
PUT    /api/v1/me/likes/:id
DELETE /api/v1/me/likes/:id
PUT    /api/v1/me/subscriptions/:id
DELETE /api/v1/me/subscriptions/:id
PUT    /api/v1/me/ratings/:id
DELETE /api/v1/me/ratings/:id

# 获取（唯一协议）
POST   /api/v1/projects/:id/acquisitions
GET    /api/v1/acquisitions/:ticket

# 创作
POST   /api/v1/projects                              If-Match
GET    /api/v1/me/projects
GET    /api/v1/projects/:id/draft
PATCH  /api/v1/projects/:id                          If-Match
DELETE /api/v1/projects/:id                          If-Match
PATCH  /api/v1/projects/:id/visibility               If-Match
POST   /api/v1/projects/:id/revisions                If-Match
PUT    /api/v1/projects/:id/revisions/:rid/assets/:kind
DELETE /api/v1/projects/:id/revisions/:rid/entries/:kind/:key If-Match
POST   /api/v1/projects/:id/revisions/:rid/submissions
GET    /api/v1/me/projects/:id/submissions

# 审核
GET    /api/v1/admin/review-queue?cursor=
GET    /api/v1/admin/submissions/:id
POST   /api/v1/admin/submissions/:id/recheck
POST   /api/v1/admin/submissions/:id/decision
```

## 6. 获取契约

```json
POST /api/v1/projects/:id/acquisitions
X-Client-Channel: stable|staging
X-Client-Version: <exact version>

{
  "release": {
    "revisionId": "...",
    "manifestHash": "...",
    "files": [
      {"kind": "worldbook", "sha256": "...", "bytes": 123, "mime": "application/json"}
    ]
  },
  "tickets": [
    {"kind": "worldbook", "url": "/api/v1/acquisitions/<token>", "expiresAt": "..."}
  ]
}
```

- 缺 channel/version 或 channel 不匹配：`426 upgrade_required`。
- 票据短时、单次、绑定 session version；字节成功返回时计数。
- 裸 release 文件路由只作为迁移期兼容；新客户端只走 acquisitions。旧的 `/projects/:id/install` 已移除。

## 7. 队列契约

```text
GET /api/v1/admin/review-queue?cursor=<keyset>&limit=20
```

```json
{
  "counts": {"pending": 12, "checking": 3, "approved": 40, "rejected": 7, "superseded": 9},
  "items": [ ...pending only... ],
  "nextCursor": "..."
}
```

- 默认/唯一工作队列是 `pending`；`checking` 只出现在 counts。
- cursor 为 `(submitted_at,id)` keyset；不承诺 snapshot。
- 审核动作条件更新兜底重复；审核台本地推进，不重新拉整页。

## 8. 错误与并发

- `400` 请求/cursor 非法；`401` 无 session；`403` 角色/权限；`404` 隐藏受保护资源。
- `409` 状态机冲突；`412` `If-Match` 过期；`426` 客户端版本不匹配。
- `412` 的 `details` 带 `resource/expectedVersion/currentVersion`。
- 外部端点必须有 shared request/response schema；Web 不维护平行 DTO。

## 9. 本轮落地顺序

1. 获取协议：版本门禁 + 单次计数 + 票票据；保留旧 install 兼容但标记迁移。
2. 审核队列默认 `pending` + counts；历史查询单独资源。
3. 公开目录固定 24 + keyset cursor。
4. 条目索引在 revision 冻结时持久化。
5. 删除条目不复制 R2 保留资产。
6. contracts 覆盖所有外部响应。

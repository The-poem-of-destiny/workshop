# 前端设计语言对照（`../workshop-legacy` → 当前实现）

更新：2026-10-22  
性质：逐页对照记录。legacy 只做只读参考，不复制其多货架信息架构。

## 1. 共同语言

| 维度 | legacy 证据 | 当前实现 |
|---|---|---|
| 背景 | `styles.ts`：`--bg-color:#0f1012`，卡片 `#1b1c1f` / `#151619` | `--bg:#0f1012`，`--surface:#18191c`，`--surface-2:#202228` |
| 内容色 | `--text-color:#ececea`，金色 `--highlight-color:#bea47d` | `--fg:#f8fafc`，金色 `--accent:#b89d76` |
| 字体 | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto...`；标题用 `LXGW WenKai Lite` / `Microsoft YaHei` | 正文 `Noto Sans SC`/`Microsoft YaHei`/system-ui；标题同字体但加 750 字重与金色渐变 |
| 卡片 | 20px 圆角，深色渐变，hover 上浮 + 冷色描边 | 16px 圆角，深色渐变，hover 上浮 + 金色描边；蓝色留给主操作 |
| 详情 | 居中 modal，`max-width:860px`，`#18191c` | 右侧 sheet + backdrop；移动全屏。保留同色表面和 180ms 动效 |
| 管理/审核 | 大 modal、深色表头、金色图标 | 面板 + 审核双栏；减少全屏 modal 层级 |
| 动效 | `.18s ease` / `.25s` | 160ms ease；`prefers-reduced-motion` 直接降为 1ms |

## 2. 逐页差异与理由

### 首页 / 浏览

- legacy：桌面 204px 侧栏 + 搜索/榜单/编辑精选多货架 + 10:3 大 banner。
- 当前：顶部品牌/搜索/导航 + 一个 4 卡发现栏 + 唯一主列表；banner 压到 88px。
- 理由：D-26/D-27/D-32 要求去重复货架、主列表唯一；窄 banner 让首屏优先内容。

### 项目卡片

- legacy：整卡可点，标签/作者/下载/点赞信息密集。
- 当前：`article` + 封面按钮/标题按钮；条件 Discord 链接；保留作者、条目数、版本、更新时间。
- 理由：避免嵌套可交互元素，保留键盘可达性；Discord 是独立 secondary 操作。

### 详情

- legacy：居中大 modal，信息纵向堆叠。
- 当前：右侧 sheet，`role=dialog`、`aria-modal`、Escape、焦点陷阱/恢复；作者说明/注意事项/版本信息分组。
- 理由：当前浏览上下文保留在背后；移动全屏；可访问性显式验收。

### 作者工作区

- legacy：项目编辑大 modal + 上传预览。
- 当前：左侧项目列表 + 右侧编辑面板；preflight 状态（无文件/检查中/pass/warn/block）就地显示。
- 理由：当前功能需要频繁切换项目；大 modal 会遮住列表，降低批量操作效率。

### 审核台 / 管理

- legacy：审核/管理各自大 modal，颜色体系偏重。
- 当前：双栏队列 + 详情；原始报告折叠；管理工具分 tab。
- 理由：D-36 要求 pending 工作队列与本地推进；减少 Worker 往返，层级保持紧凑。

## 3. 关键 token 对照

| Token | legacy | 当前 |
|---|---|---|
| 背景 | `#0f1012` | `#0f1012` |
| 表面 | `#1b1c1f` / `#151619` | `#18191c` / `#202228` |
| 金色 | `#bea47d` / `#a28b6b` | `#b89d76` |
| 主操作 | 金色（旧系统） | 蓝色 `#3b82f6`（当前 action） |
| 边框 | `rgba(255,255,255,.07~.09)` | `--border: rgba(255,255,255,.08)` / `--border-strong:.15` |
| 警告/危险 | 黄/红混用 | `--warning:#e7b968` / `--danger:#ef7b7b`，独立样式 |

## 4. 截图证据

`docs/plans/refactor-2026-10/screenshots/`：

- `browse-desktop.png`
- `browse-mobile.png`
- `detail-desktop.png`
- `detail-mobile.png`
- `author-workspace.png`
- `review-detail.png`
- `admin-tools.png`

状态：截图已由本地 E2E 真实 Chromium 生成；**视觉签收待用户确认**。当前自动检查覆盖单发现栏、banner 高度、移动端无横向溢出、dialog 语义与焦点、Escape 关闭。

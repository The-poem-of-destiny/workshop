# SillyTavern 宿主协议

本参考描述工坊页面与 Tavern 客户端之间的 `postMessage` 协议；服务端认证、获取内容和下载接口见 [Worker API](worker-api.md)。类型定义以 [`install.ts`](../../packages/contracts/src/install.ts) 为准，宿主实现见 [`index.ts`](../../apps/tavern-client/src/index.ts)，页面桥接见 [`install-bridge.ts`](../../apps/worker/web/src/lib/install-bridge.ts)。

## 连接与信任边界

客户端在 SillyTavern 中打开工坊 iframe，URL 带 `embed=1`、`clientVersion` 和 `clientChannel`。打开前请求客户端兼容性接口：明确不兼容时阻止加载；引导模式或网络检查失败不阻止打开。服务地址可在宿主设置中修改，仅应使用可信工坊；地址归一化为 HTTP(S) origin，无效值回退到构建时默认值。

页面从 `document.referrer`，或其为空时从 `hostOrigin` 查询参数取得 HTTP(S) 宿主 origin；无有效 origin 或没有父窗口时不创建安装桥。桥要求精确 origin，不接受 `*`、`null` 或非 origin URL。页面发送 `cw:ready`，宿主也响应 `cw:request-context`，返回 `cw:context`；`cw:close` 请求关闭 iframe。宿主只接受当前活动 iframe 的 `source` 和配置工坊 origin 均匹配的消息，回复也发送到该 origin。页面只接受来自 `window.parent` 且 origin 匹配的上下文；安装响应还必须匹配请求 ID、响应类型和布尔 `ok`。这些校验限制通信对象，并不替代对工坊地址的信任或服务端权限检查。

成功的 `cw:context` 包含 `connected: true`、`characterName`、`worldbooks: { primary, additional, available }`、`installationScan` 和 `clientVersion`；获取失败时返回 `connected: false` 和 `error`。上下文与扫描会暴露当前角色名称、世界书名称和安装实例摘要给可信工坊页面；不是完整宿主数据的传输。

## 安装消息

页面请求都带随机生成的 `requestId`，宿主回复类型为请求类型加 `-result`，回显 `requestId`，成功为 `{ ok: true, result }`，失败为 `{ ok: false, message }`。

| 请求 | 附加载荷 | 成功结果 |
| --- | --- | --- |
| `cw:scan` | 无 | `InstallScan` |
| `cw:preview-install` | `intent: InstallIntent` | `InstallPreview` |
| `cw:confirm-install` | `previewId` | `{ instanceId, action, scan }` |
| `cw:cancel-install` | `previewId` | `{ cancelled: boolean }` |

`InstallIntent.action` 为 `install`、`update`、`uninstall` 或 `migrate`。`instanceId` 指定已有实例；安装和更新提供 `project`（`id`、`version`，可选 `title`、`projectType`）及 `files`（可选 `worldbook`、`regex` JSON 文本）。目标选择使用 `targetWorldbook`、`createWorldbook` 和 `bindWorldbook`。新安装不能指定已有实例；其他操作须指定有效实例；卸载不能携带项目、文件或变更目标和绑定。具体校验还包括角色匹配、来源和目标可读、目标身份无歧义及不能在同一目标重复安装同一项目。

`InstallScan` 返回 `instances`、`scope`、`failures` 和 `ambiguous`。实例包含 ID、项目、版本、世界书及角色位置、`native`/`legacy` 来源、`clean`/`localChanged`/`baselineUnknown` 状态和条目数量。`scope.worldbooks` 是扫描的世界书名称，`scope.character` 是当前角色；正则范围为 `current-character-only`，其他角色标记 `not-scanned`。读取失败与身份存疑不等同于未安装。

预览返回 `previewId`、`instanceId`、`action`、原 `instance` 或 null、`target`、`playerChanges` 和 `changes`。差异项有 `kind`（`worldbook` 或 `regex`）、`key`、`before`、`after`，null 表示该侧不存在。`playerChanges` 是相对基线的差异；基线未知时列出当前归属内容，并不证明全是玩家修改。预览不写入宿主数据。

新上传的世界书条目名称在保存时加上 `[WS]`，作者预览显示最终名称，作者负责相应修改按名称查找的引用；动态 EJS 无法完全自动检查。安装、更新和迁移保留文件或已有实例中的名称，不在宿主端重命名；历史发布内容因此保留原名以免破坏引用。标记本身不证明归属，缺少可靠身份的 `[WS]` 条目会阻止对应位置的操作，不能自动认领或删除。`[DLC]`、`[工坊]` 或旧名称本身不是归属证据，也不会仅因名称而被认领。已有可靠身份的旧条目仍可管理。位置判断按世界书完整名称和角色范围区分。

## 生命周期与失败

预览保存在宿主内存；取消只删除对应待确认预览，`cancelled: false` 表示没有删除到预览，并不撤销已开始的写入。确认会消费预览，不能重复确认；宿主同一时间只执行一个确认。确认前重新采集快照，检测到变化则要求重新预览；世界书写入前比较并在写入后重读，但宿主更新并非原子比较交换，不能防止外部并发编辑被覆盖。写入可能部分成功，失败不自动回滚，应重新扫描并核对实际内容。

关闭或替换宿主覆盖层会清除该会话所有待确认预览，并取消仍在采集的预览和确认；已经开始写入的操作不会回滚。旧 iframe 的异步回复不会发给新 iframe。

页面桥默认等待 30 秒；超时只结束本地等待，不取消宿主操作，迟到的响应被忽略。尤其确认超时表示**写入结果未知**：关闭并重新扫描，核对目标实例和实际内容，勿重复确认。页面关闭或桥释放会拒绝本地待处理请求，也不保证中止宿主写入。对尚未确认的预览，页面关闭对话框时尝试取消；取消失败须按提示处理。

## 宿主数据与权限

扫描读取所有可用世界书、当前角色绑定及当前角色正则和客户端安装记录；不扫描其他角色正则。世界书内容写入所选目标，正则仅写入当前角色；可选择新建世界书并绑定到当前角色。更新整体替换实例拥有的内容，卸载删除其拥有内容，迁移移动实例的世界书内容；玩家修改不会自动合并或恢复。身份存疑、读取失败或角色变化可能阻止操作。应先备份角色卡及相关世界书，再确认完整差异。

同意使用说明是宿主本地操作，并非服务端授权；工坊界面的安装、更新、迁移和卸载均要求登录，审核等服务端操作还受账号角色权限限制。协议不提供绕过权限的安装地址或其他角色扫描能力。

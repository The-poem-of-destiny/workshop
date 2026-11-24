const TOKEN_KEY = "cw_session_token";
let sessionGeneration = 0;
const sessionListeners = new Set<() => void>();

export function getSessionGeneration(): number {
  return sessionGeneration;
}

export function subscribeSessionChange(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

function token(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function hasSessionToken(): boolean {
  return Boolean(token());
}

export function setSessionToken(value: string | null): void {
  const previous = token();
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sandboxed iframe */
  }
  if (previous !== token()) {
    sessionGeneration += 1;
    for (const listener of sessionListeners) listener();
  }
}

function authHeaders(): Record<string, string> {
  const value = token();
  return value ? { authorization: `Bearer ${value}` } : {};
}

const DISCORD_THREAD_REASON_MESSAGES: Record<string, string> = {
  "too-long": "Discord 讨论链接过长，请检查后重试。",
  "invalid-url": "Discord 讨论链接格式无效，请输入完整的 https://discord.com/channels/... 链接。",
  "not-https": "Discord 讨论链接必须以 https:// 开头。",
  credentials: "Discord 讨论链接不能包含账号或密码信息。",
  "not-discord-host": "请输入 discord.com 域名下的讨论串链接。",
  "not-a-thread-url": "请输入具体的 Discord 帖子或子区链接（格式为 https://discord.com/channels/服务器ID/帖子ID）。",
  "invalid-snowflake": "Discord 讨论链接中的服务器或帖子编号格式不正确。",
  "guild-not-allowed": "该讨论链接不属于当前工坊允许的 Discord 社区服务器。",
};

const EXACT_ERROR_MESSAGES: Record<string, string> = {
  "Original release unavailable; refresh and start a new acquisition":
    "当前发布版本已变更或已下架，请刷新页面后重新安装。",
  "Daily acquisition limit reached": "今日获取或安装次数已达上限，请明天再试。",
  "Too many metadata updates; retry in a minute": "资料保存过于频繁，请稍等一分钟后再试。",
  "Submitted metadata is frozen; create a new revision to edit it": "当前版本已提交或已锁定，请新建版本后再修改。",
  "Revision is no longer editable": "当前版本已提交或已锁定，请新建版本后再修改。",
  "Public image withdrawal pending; retry": "公开图片正在后台清理中，请稍后重试。",
  "Public gallery withdrawal pending; retry": "公开展示图正在后台清理中，请稍后重试。",
  "Banner changed or is being updated; refresh and try again": "站点横幅刚刚已更新或正在处理中，请刷新页面后重试。",
  "Banner is too large": "横幅图片超过大小限制。",
  "Empty banner": "横幅图片内容为空，请重新选择图片。",
  "Gallery image exceeds 1MiB limit": "展示图不能超过 1 MiB。",
  "Image format does not match content type": "图片实际格式与文件类型不一致，请重新导出后再试。",
  "Entry cannot be deleted from this revision": "当前版本无法删除此条目，请刷新页面或新建版本后重试。",
  "Cannot demote the last owner": "无法取消最后一位站长的权限，站点至少需要保留一名站长。",
  "Submission has already been reviewed": "该提交已被处理，请刷新列表查看最新状态。",
  "Submission is already resolved": "该提交已被处理，请刷新列表查看最新状态。",
  "Checker is already running": "自动检查正在运行中，请稍候。",
  "Project not found": "未找到该项目，可能已下架或已删除。",
  "Release not found": "未找到对应的发布版本，可能已下架或更新，请刷新后重试。",
  "Published version not found": "未找到对应的公开版本，可能已下架或更新，请刷新后重试。",
  "Project version not found": "未找到对应的项目版本，请刷新后重试。",
  "Project preview not found": "暂时无法读取条目预览，请稍后重试。",
  "Project preview unavailable": "暂时无法读取条目预览，请稍后重试。",
  "Submission not found": "未找到该审核记录，请刷新队列后重试。",
  "Member not found": "未找到该成员。",
  "Recommendation not found": "未找到该推荐记录，可能已被移除。",
  "Recommendation not allowed": "当前项目不满足推荐条件。",
  "Retained note not found": "未找到这条旧备忘，可能已被删除。",
  "Owner role required": "只有站长可以执行此操作。",
  "Reviewer role required": "只有审核员或站长可以执行此操作。",
  "Reviewer access required": "只有审核员或站长可以执行此操作。",
  "Auth flow expired": "登录验证已过期，请重新发起登录。",
  "Auth flow was already redeemed": "登录凭据已被使用，请重新发起登录。",
  "Auth flow not found": "登录验证状态无效或已过期，请重新发起登录。",
  "Auth flow does not belong to this browser": "登录验证状态无效或已过期，请重新发起登录。",
  "Invalid redeem secret": "登录验证状态无效或已过期，请重新发起登录。",
  "Auth flow is not ready for redemption": "登录验证尚未完成，请稍后重试。",
  "Origin is not allowed": "当前访问来源未被允许，请从官方地址打开创意工坊。",
  "Invalid project metadata": "项目资料填写有误，请检查标题、分类、标签或链接后重试。",
  "Invalid revision metadata": "版本资料填写有误，请检查标题、分类、标签或链接后重试。",
  "Project metadata failed validation": "项目资料未通过校验，请检查填写内容后重试。",
  "Invalid site settings": "站点设置内容格式有误，请检查后重试。",
  "No site settings provided": "未提供要保存的站点设置内容。",
  "Invalid experience note": "备忘内容格式有误，请检查评分与字数后重试。",
  "Invalid version recommendation": "推荐内容格式有误，请检查后重试。",
  "Invalid recommendation": "推荐内容格式有误，请检查后重试。",
  "Invalid review": "审核决定填写有误，请检查说明后重试。",
  "Invalid project batch response": "项目列表数据返回异常，请稍后重试。",
};

function extractFindingMessages(details: unknown): string | null {
  const list = Array.isArray(details)
    ? details
    : details && typeof details === "object" && "findings" in details && Array.isArray(details.findings)
      ? details.findings
      : null;
  if (!list) return null;
  const messages: string[] = [];
  for (const item of list) {
    if (item && typeof item === "object" && "message" in item && typeof item.message === "string") {
      const text = item.message.trim();
      if (text && !messages.includes(text)) messages.push(text);
    }
  }
  return messages.length > 0 ? messages.join("；") : null;
}

function translateDiscordThreadMessage(message: string): string | null {
  const prefix = "Discord 线程地址无效：";
  if (message.startsWith(prefix)) {
    const slug = message.slice(prefix.length).trim();
    return DISCORD_THREAD_REASON_MESSAGES[slug] ?? "Discord 讨论链接无效，请检查链接格式后重试。";
  }
  for (const [slug, localized] of Object.entries(DISCORD_THREAD_REASON_MESSAGES)) {
    if (message === slug) return localized;
  }
  return null;
}

function fallbackByStatusOrCode(status: number, code: string | null): string {
  if (code === "maintenance") return "工坊正在维护中，请稍后刷新页面再试。";
  if (code === "quota_exceeded") return "今日云端服务额度已用完，请稍后再试。";
  if (code === "upgrade_required" || status === 426) return "当前工坊客户端版本已过期，请更新脚本后重开工坊。";
  if (code === "rate_limited" || status === 429) return "操作过于频繁或今日次数已达上限，请稍后再试。";
  if (code === "precondition_failed" || status === 412) return "内容已在其他操作中更新，请刷新后重试。";
  if (code === "payload_too_large" || status === 413) return "上传文件超过大小限制。";
  if (code === "unsupported_media_type" || status === 415) return "文件格式不支持。";
  if (code === "unauthorized" || status === 401) return "登录已失效，请重新登录。";
  if (code === "turnstile_required") return "请先完成人机验证后再继续。";
  if (code === "forbidden" || status === 403) return "当前账号无权执行此操作。";
  if (code === "not_found" || status === 404) return "请求的内容不存在或已下架。";
  if (code === "conflict" || status === 409) return "当前内容状态已变化，请刷新页面后重试。";
  if (code === "bad_request" || status === 400) return "提交的内容格式有误，请检查后重试。";
  if (status >= 500) return "服务暂时繁忙，请稍后刷新页面再试。";
  return "请求未完成，请稍后重试。";
}

export function formatApiErrorMessage(
  status: number,
  code: string | null,
  rawMessage: string,
  details?: unknown,
): string {
  const trimmed = rawMessage.trim();
  if (code === "quota_exceeded" && trimmed && /[\u4e00-\u9fff]/.test(trimmed)) return trimmed;
  if (status >= 500 && code !== "maintenance") {
    return trimmed && /[\u4e00-\u9fff]/.test(trimmed) ? trimmed : "服务暂时繁忙，请稍后刷新页面再试。";
  }
  const findingText = extractFindingMessages(details);
  if (findingText) return findingText;
  const discordText = translateDiscordThreadMessage(trimmed);
  if (discordText) return discordText;
  const exact = EXACT_ERROR_MESSAGES[trimmed];
  if (exact) return exact;
  if (trimmed && /[\u4e00-\u9fff]/.test(trimmed)) return trimmed;
  return fallbackByStatusOrCode(status, code);
}

export function formatUserError(reason: unknown): string {
  if (reason instanceof ApiError) return reason.message;
  if (reason instanceof SyntaxError) return "JSON 格式有误，请检查括号、引号与逗号后重试。";
  const raw =
    reason instanceof Error ? reason.message : typeof reason === "string" ? reason : reason ? String(reason) : "";
  const cleaned = raw
    .trim()
    .replace(/^(?:ApiError|TypeError|SyntaxError|Error):\s*/i, "")
    .replace(/^\d{3}\s+[a-z_]+:\s*/i, "")
    .trim();
  if (!cleaned) return "操作未完成，请稍后重试。";
  const discordText = translateDiscordThreadMessage(cleaned);
  if (discordText) return discordText;
  const exact = EXACT_ERROR_MESSAGES[cleaned];
  if (exact) return exact;
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(cleaned)) {
    return "网络连接失败，请检查网络后重试。";
  }
  if (/aborted|aborterror/i.test(cleaned)) {
    return "操作已取消，请重试。";
  }
  if (/[\u4e00-\u9fff]/.test(cleaned)) return cleaned;
  return "操作未完成，请稍后重试。";
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: unknown;

  constructor(status: number, _statusText: string, code: string | null, message: string, details: unknown) {
    super(formatApiErrorMessage(status, code, message, details));
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function throwApiError(response: Response): Promise<never> {
  let message = "";
  let code: string | null = null;
  let details: unknown;
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      if ("message" in body && typeof body.message === "string") message = body.message;
      if ("error" in body && typeof body.error === "object" && body.error !== null && !Array.isArray(body.error)) {
        if ("message" in body.error && typeof body.error.message === "string") message = body.error.message;
        if ("code" in body.error && typeof body.error.code === "string") code = body.error.code;
        if ("details" in body.error) details = body.error.details;
      }
    }
  } catch {
    /* non-json error */
  }
  throw new ApiError(response.status, response.statusText, code, message, details);
}

export async function requestJsonWithHeaders<T>(
  path: string,
  init: RequestInit = {},
  publicRead = false,
): Promise<{ data: T; headers: Headers }> {
  const response = await fetch(path, {
    ...init,
    ...(publicRead ? { credentials: "omit" as const } : {}),
    headers: { accept: "application/json", ...(publicRead ? {} : authHeaders()), ...(init.headers ?? {}) },
  });
  if (!response.ok) await throwApiError(response);
  if (response.status === 204) return { data: undefined as T, headers: response.headers };
  return { data: (await response.json()) as T, headers: response.headers };
}

export async function requestJson<T>(path: string, init: RequestInit = {}, publicRead = false): Promise<T> {
  const result = await requestJsonWithHeaders<T>(path, init, publicRead);
  return result.data;
}

export function jsonRequest<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  return requestJson<T>(path, {
    method,
    headers: { "content-type": "application/json", ...(extraHeaders ?? {}) },
    body: JSON.stringify(body),
  });
}

function isSameOriginUrl(url: string): boolean {
  try {
    if (typeof location === "undefined") {
      return url.startsWith("/") && !url.startsWith("//");
    }
    return new URL(url, location.origin).origin === location.origin;
  } catch {
    return false;
  }
}

export async function requestBlob(url: string): Promise<Blob> {
  const response = await fetch(url, { headers: isSameOriginUrl(url) ? authHeaders() : {} });
  if (!response.ok) await throwApiError(response);
  return response.blob();
}

export async function requestText(url: string, extraHeaders?: Record<string, string>): Promise<string> {
  const headers = isSameOriginUrl(url) ? { ...authHeaders(), ...(extraHeaders ?? {}) } : {};
  const response = await fetch(url, { headers });
  if (!response.ok) await throwApiError(response);
  return response.text();
}

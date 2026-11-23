import type { AuthFlowMode } from "@workshop/contracts";
import {
  authFlowCreateSchema,
  authFlowRedeemSchema,
  authFlowResponseSchema,
  authFlowStatusSchema,
  authSessionResponseSchema,
} from "@workshop/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { dataClient } from "../../data-client.js";
import type { Env } from "../../env";
import { jsonError } from "../errors.js";
import { sessionToken } from "../session.js";

interface AuthFlowRow {
  id: string;
  code_verifier: string | null;
  code_challenge: string | null;
  redeem_hash: string | null;
  origin: string;
  mode: AuthFlowMode;
  status: "pending" | "authorized" | "redeemed" | "expired";
  user_id: string | null;
  error: string | null;
  expires_at: string;
  browser_binding_hash: string | null;
}

const authFlowBindSchema = z.object({
  binding: z.string().min(1).max(256),
});

const BINDING_COOKIE_NAMES = ["__Host-cw_oauth_binding", "cw_oauth_binding", "cw_oauth_binding_p"] as const;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const CALLBACK_PATH = "/api/v1/auth/callback";
const FLOW_TTL_MS = 10 * 60 * 1000;
const DISCORD_API = "https://discord.com/api";

function randomToken(bytes = 32): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  let binary = "";
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function s256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function deriveFlowState(id: string, verifier: string, binding: string): Promise<string> {
  return s256(`cw-oauth-state-v1:${id}:${verifier}:${binding}`);
}

async function buildDiscordAuthorizeUrl(
  c: { env: Env; req: { url: string } },
  id: string,
  state: string,
  verifier: string,
  fallbackOrigin: string,
  requiredRoles: Map<string, Set<string>>,
): Promise<string> {
  const scopes = ["identify", "guilds"];
  if (requiredRoles.size > 0) scopes.push("guilds.members.read");
  if (!c.env.DISCORD_CLIENT_ID) {
    return `${fallbackOrigin}/auth/pending?flow=${encodeURIComponent(id)}`;
  }
  const query = new URLSearchParams({
    client_id: c.env.DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: `${publicOrigin(c)}${CALLBACK_PATH}`,
    scope: scopes.join(" "),
    state,
    code_challenge: await s256(verifier),
    code_challenge_method: "S256",
  });
  return `https://discord.com/oauth2/authorize?${query.toString()}`;
}

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function allowedGuilds(env: Env): string[] {
  return (env.DISCORD_ALLOWED_GUILD_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function roleRequirements(env: Env): Map<string, Set<string>> | null {
  const raw = (env.DISCORD_GUILD_ROLE_IDS ?? "").trim();
  if (!raw) return new Map();
  const requirements = new Map<string, Set<string>>();
  for (const entry of raw.split(";")) {
    const item = entry.trim();
    if (!item) continue;
    const separator = item.indexOf(":");
    if (separator <= 0) return null;
    const guildId = item.slice(0, separator).trim();
    const roleIds = item
      .slice(separator + 1)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!/^\d{17,20}$/.test(guildId) || roleIds.length === 0) return null;
    if (roleIds.some((roleId) => !/^\d{17,20}$/.test(roleId))) return null;
    const merged = requirements.get(guildId) ?? new Set<string>();
    for (const roleId of roleIds) merged.add(roleId);
    requirements.set(guildId, merged);
  }
  return requirements.size > 0 ? requirements : null;
}

function publicOrigin(c: { env: Env; req: { url: string } }): string {
  return (c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin).replace(/\/+$/, "");
}

function cookieValues(c: { req: { header: (name: string) => string | undefined } }, name: string): string[] {
  const header = c.req.header("cookie") ?? "";
  const values: string[] = [];
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      const value = rest.join("=");
      if (value) values.push(value);
    }
  }
  return values;
}

function allBindingCookieValues(c: { req: { header: (name: string) => string | undefined } }): string[] {
  return BINDING_COOKIE_NAMES.flatMap((name) => cookieValues(c, name));
}

async function bindingMatches(
  c: { req: { header: (name: string) => string | undefined } },
  flow: AuthFlowRow,
): Promise<boolean> {
  if (!flow.browser_binding_hash) return false;
  for (const value of allBindingCookieValues(c)) {
    if ((await sha256Hex(value)) === flow.browser_binding_hash) return true;
  }
  return false;
}

function setBindingCookies(
  c: { req: { url: string }; header: (name: string, value: string, options?: { append?: boolean }) => void },
  value: string,
): void {
  const secure = new URL(c.req.url).protocol === "https:";
  if (secure) {
    c.header("set-cookie", `__Host-cw_oauth_binding=${value}; Path=/; HttpOnly; Max-Age=600; SameSite=Lax; Secure`, {
      append: true,
    });
    c.header(
      "set-cookie",
      `cw_oauth_binding_p=${value}; Path=/api/v1/auth; HttpOnly; Max-Age=600; SameSite=None; Secure; Partitioned`,
      { append: true },
    );
  } else {
    c.header("set-cookie", `cw_oauth_binding=${value}; Path=/api/v1/auth; HttpOnly; Max-Age=600; SameSite=Lax`, {
      append: true,
    });
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function htmlResponse(body: string, status = 200, allowConnectSelf = false) {
  const connectSrc = allowConnectSelf ? " connect-src 'self';" : "";
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": `default-src 'none';${connectSrc} script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

function launchHtml(flowId: string): string {
  return `<!doctype html><meta charset="utf-8"><title>创意工坊登录</title>
<body style="font:14px system-ui;background:#111;color:#ddd;padding:24px">
<p id="status">正在连接创意工坊准备登录…</p>
<script>
(() => {
  const flowId = ${safeScriptJson(flowId)};
  const statusEl = document.getElementById("status");
  if (!window.opener) {
    statusEl.textContent = "未检测到原创意工坊页面，请返回创意工坊重新发起登录。";
    return;
  }
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    window.removeEventListener("message", onMessage);
    statusEl.textContent = "登录连接超时，请关闭此窗口并返回创意工坊重新发起登录。";
  }, 10000);
  async function onMessage(event) {
    if (done || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.type !== "cw:oauth-launch-bind" || data.flowId !== flowId || typeof data.binding !== "string" || !data.binding) {
      return;
    }
    done = true;
    clearTimeout(timer);
    window.removeEventListener("message", onMessage);
    try {
      const response = await fetch("/api/v1/auth/flows/" + encodeURIComponent(flowId) + "/bind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ binding: data.binding }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || typeof result.url !== "string") {
        statusEl.textContent = "登录状态无效或已过期，请返回创意工坊重新发起登录。";
        return;
      }
      location.replace(result.url);
    } catch {
      statusEl.textContent = "登录跳转失败，请关闭此窗口并返回创意工坊重试。";
    }
  }
  window.addEventListener("message", onMessage);
  window.opener.postMessage({ type: "cw:oauth-launch-ready", flowId }, location.origin);
})();
</script></body>`;
}

function callbackHtml(payload: Record<string, unknown>, requiresOpener = false): string {
  return `<!doctype html><meta charset="utf-8"><title>创意工坊登录</title>
<body style="font:14px system-ui;background:#111;color:#ddd;padding:24px">
<p id="status">正在完成登录…</p>
<script>
try {
  const payload = ${safeScriptJson(payload)};
  const requiresOpener = ${requiresOpener ? "true" : "false"};
  if (requiresOpener && !window.opener) {
    document.getElementById("status").textContent = "未检测到原创意工坊页面，请返回创意工坊重新发起登录。";
  } else {
    if (window.opener && payload.targetOrigin) window.opener.postMessage(payload, payload.targetOrigin);
    document.getElementById("status").textContent = "登录结果已发送，可以关闭此页面。";
    setTimeout(() => window.close(), 400);
  }
} catch (error) {
  document.getElementById("status").textContent = "登录结果发送失败，请回到创意工坊重试。";
}
</script></body>`;
}

function errorHtml(message: string, options?: { inviteUrl?: string; openerPayload?: Record<string, unknown> }): string {
  const inviteBlock = options?.inviteUrl
    ? `<div style="margin-top:16px;padding:12px 14px;border:1px solid #3a3222;border-radius:8px;background:#1a1814;max-width:440px">
<p style="margin:0 0 8px;color:#b8b0a0;font-size:13px">尚未加入社区服务器，或尚未完成服务器内身份验证？</p>
<a href="${escapeHtml(options.inviteUrl)}" target="_blank" rel="noopener noreferrer" style="color:#d4b36a;text-decoration:none;font-weight:600">前往 Discord 社区服务器 →</a>
</div>`
    : "";
  const scriptBlock = options?.openerPayload
    ? `<script>
try {
  const payload = ${safeScriptJson(options.openerPayload)};
  if (window.opener && payload.targetOrigin) window.opener.postMessage(payload, payload.targetOrigin);
} catch {}
</script>`
    : "";
  return `<!doctype html><meta charset="utf-8"><title>登录失败</title>
<body style="font:14px/1.6 system-ui;background:#111215;color:#e5e1d8;padding:24px">
<p style="margin:0 0 8px;font-weight:600">${escapeHtml(message)}</p>
<p style="margin:0;color:#9c9689">可以关闭此页面并回到创意工坊重试。</p>
${inviteBlock}${scriptBlock}</body>`;
}

async function exchangeDiscord(c: { env: Env; req: { url: string } }, flow: AuthFlowRow, code: string) {
  if (!c.env.DISCORD_CLIENT_ID || !c.env.DISCORD_CLIENT_SECRET) {
    throw new Error("服务器未配置 Discord 登录");
  }
  const redirectUri = `${publicOrigin(c)}${CALLBACK_PATH}`;
  const body = new URLSearchParams({
    client_id: c.env.DISCORD_CLIENT_ID,
    client_secret: c.env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  if (flow.code_verifier) body.set("code_verifier", flow.code_verifier);
  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenResponse.ok) throw new Error("Discord 授权码兑换失败");
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("Discord 未返回访问令牌");

  const headers = { authorization: `Bearer ${token.access_token}` };
  const [userResponse, guildsResponse] = await Promise.all([
    fetch(`${DISCORD_API}/users/@me`, { headers }),
    fetch(`${DISCORD_API}/users/@me/guilds`, { headers }),
  ]);
  if (!userResponse.ok || !guildsResponse.ok) throw new Error("无法读取 Discord 账号信息");
  const user = (await userResponse.json()) as {
    id?: string;
    username?: string;
    global_name?: string | null;
    avatar?: string | null;
  };
  if (!user.id || !user.username) throw new Error("Discord 账号信息不完整");
  const guilds = (await guildsResponse.json()) as Array<{ id?: string }>;
  const allowed = new Set(allowedGuilds(c.env));
  if (allowed.size === 0) throw new Error("服务器未配置允许的 Discord 服务器");
  const requiredRoles = roleRequirements(c.env);
  if (!requiredRoles) throw new Error("服务器 Discord 身份组配置无效");
  const candidates = guilds.filter((item): item is { id: string } => Boolean(item.id && allowed.has(item.id)));
  if (candidates.length === 0) throw new Error("你的账号不在允许的 Discord 服务器中");
  const identity = {
    user: { id: user.id, username: user.username, global_name: user.global_name, avatar: user.avatar },
  };

  for (const guild of candidates) {
    const roles = requiredRoles.get(guild.id);
    if (!roles) return { ...identity, guildId: guild.id };
    const memberResponse = await fetch(`${DISCORD_API}/users/@me/guilds/${guild.id}/member`, { headers });
    if (memberResponse.status === 404) continue;
    if (!memberResponse.ok) throw new Error("无法读取 Discord 身份组");
    const member = (await memberResponse.json()) as { roles?: string[] };
    if (member.roles?.some((roleId) => roles.has(roleId))) return { ...identity, guildId: guild.id };
  }

  throw new Error("你的账号缺少允许的 Discord 身份组");
}

export const authRoutes = new Hono<{ Bindings: Env }>();
export const sessionRoutes = new Hono<{ Bindings: Env }>();

sessionRoutes.delete("/current", async (c) => {
  const token = sessionToken(c);
  if (!token || !(await dataClient(c.executionCtx).identityRevoke(token))) {
    return jsonError(c, "unauthorized", "Login required");
  }
  return c.body(null, 204);
});

authRoutes.post("/flows", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "bad_request", "Invalid JSON body");
  }
  const requestOrigin = c.req.header("origin");
  if (!requestOrigin || !allowedOrigins(c.env).includes(requestOrigin)) {
    return jsonError(c, "forbidden", "Origin is not allowed");
  }
  const parsed = authFlowCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid auth flow", parsed.error.flatten());
  if (parsed.data.mode === "embed" && !parsed.data.codeChallenge) {
    return jsonError(c, "bad_request", "Embed flow requires a PKCE challenge");
  }
  const requiredRoles = roleRequirements(c.env);
  if (!requiredRoles) return jsonError(c, "internal", "服务器 Discord 身份组配置无效");

  const id = crypto.randomUUID();
  const verifier = randomToken(48);
  const deviceCode = parsed.data.mode === "device" ? randomToken(32) : null;
  const binding = randomToken(32);
  const state = await deriveFlowState(id, verifier, binding);
  const expiresAt = new Date(Date.now() + FLOW_TTL_MS).toISOString();
  await dataClient(c.executionCtx).identityCreateFlow({
    id,
    state,
    verifier,
    codeChallenge: parsed.data.codeChallenge ?? null,
    redeemHash: deviceCode ? await sha256Hex(deviceCode) : null,
    origin: publicOrigin(c),
    mode: parsed.data.mode,
    expiresAt,
    browserBindingHash: await sha256Hex(binding),
  });
  setBindingCookies(c, binding);
  c.header("x-oauth-binding", binding);
  c.header("cache-control", "no-store");

  const url = await buildDiscordAuthorizeUrl(c, id, state, verifier, requestOrigin, requiredRoles);
  return c.json(
    authFlowResponseSchema.parse({
      id,
      state,
      url,
      expiresAt,
      mode: parsed.data.mode,
      ...(deviceCode ? { deviceCode } : {}),
    }),
    201,
  );
});

authRoutes.get("/flows/:id/launch", (c) => {
  return htmlResponse(launchHtml(c.req.param("id")), 200, true);
});

authRoutes.post("/flows/:id/bind", async (c) => {
  const requestOrigin = c.req.header("origin");
  if (!requestOrigin || !allowedOrigins(c.env).includes(requestOrigin)) {
    return jsonError(c, "forbidden", "Origin is not allowed");
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "bad_request", "Invalid JSON body");
  }
  const parsed = authFlowBindSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid bind request", parsed.error.flatten());
  const requiredRoles = roleRequirements(c.env);
  if (!requiredRoles) return jsonError(c, "internal", "服务器 Discord 身份组配置无效");
  const result = await dataClient(c.executionCtx).identityFlowForLaunch(c.req.param("id"), parsed.data.binding);
  if (!result.ok) {
    if (result.error === "not_found") return jsonError(c, "not_found", "Auth flow not found");
    if (result.error === "binding") return jsonError(c, "forbidden", "Auth flow does not belong to this browser");
    return jsonError(c, "conflict", "Auth flow is no longer pending");
  }
  setBindingCookies(c, parsed.data.binding);
  c.header("cache-control", "no-store");
  const url = await buildDiscordAuthorizeUrl(
    c,
    result.flow.id,
    result.flow.state,
    result.flow.codeVerifier,
    requestOrigin,
    requiredRoles,
  );
  return c.json({ url });
});

authRoutes.get("/flows/:id", async (c) => {
  const deviceSecret = c.req.query("deviceCode") ?? c.req.header("x-device-secret") ?? "";
  const flow = await dataClient(c.executionCtx).identityFlowStatus(
    c.req.param("id"),
    allBindingCookieValues(c),
    deviceSecret,
  );
  if (!flow) return jsonError(c, "not_found", "Auth flow not found");
  return c.json(authFlowStatusSchema.parse(flow));
});

authRoutes.post("/flows/:id/redeem", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "bad_request", "Invalid JSON body");
  }
  const parsed = authFlowRedeemSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid redeem request", parsed.error.flatten());
  const result = await dataClient(c.executionCtx).identityRedeemFlow(
    c.req.param("id"),
    allBindingCookieValues(c),
    parsed.data,
  );
  if (!result.ok) {
    if (result.error === "binding") return jsonError(c, "forbidden", "Auth flow does not belong to this browser");
    if (result.error === "secret") return jsonError(c, "forbidden", "Invalid redeem secret");
    if (result.error === "expired") return jsonError(c, "conflict", "Auth flow expired");
    if (result.error === "redeemed") return jsonError(c, "conflict", "Auth flow was already redeemed");
    if (result.error === "user_not_found") return jsonError(c, "internal", "User not found");
    return jsonError(c, "conflict", "Auth flow is not ready for redemption");
  }
  return c.json(authSessionResponseSchema.parse(result));
});

authRoutes.get("/callback", async (c) => {
  const state = c.req.query("state") ?? "";
  const code = c.req.query("code") ?? "";
  const oauthError = c.req.query("error");
  const flow = state ? await dataClient(c.executionCtx).identityFlowByState(state) : null;
  if (!flow) return htmlResponse(errorHtml("登录状态无效或已过期。"), 400);
  if (flow.mode !== "browser" && !(await bindingMatches(c, flow))) {
    return htmlResponse(errorHtml("登录状态无效或已过期。"), 400);
  }
  if (oauthError) {
    const message = "Discord 未完成授权。";
    await dataClient(c.executionCtx).identityFlowError(flow.id, message);
    const openerPayload =
      flow.mode === "browser"
        ? {
            type: "oauth-error",
            source: "creative-workshop-auth-callback",
            state,
            error: message,
            targetOrigin: flow.origin,
          }
        : undefined;
    return htmlResponse(errorHtml(message, { openerPayload }), 400);
  }
  if (flow.status !== "pending" || flow.error || Date.parse(flow.expires_at) <= Date.now()) {
    return htmlResponse(errorHtml("登录状态无效或已过期。"), 400);
  }
  if (!code) return htmlResponse(errorHtml("缺少 Discord 授权码。"), 400);

  const result = await exchangeDiscord(c, flow, code).catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : "登录失败";
    await dataClient(c.executionCtx).identityFlowError(flow.id, message);
    const needsGuildInvite =
      message.includes("不在允许的 Discord 服务器中") || message.includes("缺少允许的 Discord 身份组");
    const inviteUrl = needsGuildInvite
      ? await dataClient(c.executionCtx)
          .distributionCommunityInviteUrl()
          .catch(() => undefined)
      : undefined;
    const openerPayload =
      flow.mode === "browser"
        ? {
            type: "oauth-error",
            source: "creative-workshop-auth-callback",
            state,
            error: message,
            ...(inviteUrl ? { inviteUrl } : {}),
            targetOrigin: flow.origin,
          }
        : undefined;
    return htmlResponse(errorHtml(message, { inviteUrl, openerPayload }), 400);
  });
  if (result instanceof Response) return result;
  const redeemCode = flow.mode === "embed" ? randomToken(32) : null;
  const authorized = await dataClient(c.executionCtx).identityAuthorizeFlow(
    flow.id,
    result.user,
    result.guildId,
    redeemCode,
  );
  if (!authorized) return htmlResponse(errorHtml("登录状态已被使用。"), 409);
  if (flow.mode === "browser") {
    return htmlResponse(
      callbackHtml(
        {
          type: "oauth-success",
          source: "creative-workshop-auth-callback",
          state,
          token: authorized.token,
          targetOrigin: flow.origin,
        },
        true,
      ),
    );
  }
  if (flow.mode === "embed") {
    return htmlResponse(
      callbackHtml({
        type: "oauth-code",
        source: "creative-workshop-auth-callback",
        state,
        code: redeemCode,
        flowId: flow.id,
        targetOrigin: flow.origin,
      }),
    );
  }
  return htmlResponse(
    callbackHtml({
      type: "oauth-authorized",
      source: "creative-workshop-auth-callback",
      state,
      flowId: flow.id,
      targetOrigin: flow.origin,
    }),
  );
});

import type { AuthFlowMode } from "@workshop/contracts";
import {
  authFlowCreateSchema,
  authFlowRedeemSchema,
  authFlowResponseSchema,
  authFlowStatusSchema,
  authSessionResponseSchema,
} from "@workshop/contracts";
import { Hono } from "hono";
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

function cookieValue(c: { req: { header: (name: string) => string | undefined } }, name: string): string {
  const header = c.req.header("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

async function bindingMatches(
  c: { req: { header: (name: string) => string | undefined } },
  flow: AuthFlowRow,
): Promise<boolean> {
  if (!flow.browser_binding_hash) return false;
  for (const name of ["cw_oauth_binding", "cw_oauth_binding_p"]) {
    const value = cookieValue(c, name);
    if (value && (await sha256Hex(value)) === flow.browser_binding_hash) return true;
  }
  return false;
}

function setBindingCookies(
  c: { req: { url: string }; header: (name: string, value: string, options?: { append?: boolean }) => void },
  value: string,
): void {
  const secure = new URL(c.req.url).protocol === "https:";
  const base = `Path=/api/v1/auth; HttpOnly; Max-Age=600; SameSite=Lax${secure ? "; Secure" : ""}`;
  c.header("set-cookie", `cw_oauth_binding=${value}; ${base}`, { append: true });
  if (secure) {
    c.header(
      "set-cookie",
      `cw_oauth_binding_p=${value}; Path=/api/v1/auth; HttpOnly; Max-Age=600; SameSite=None; Secure; Partitioned`,
      { append: true },
    );
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

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

function callbackHtml(payload: string): string {
  return `<!doctype html><meta charset="utf-8"><title>创意工坊登录</title>
<body style="font:14px system-ui;background:#111;color:#ddd;padding:24px">
<p id="status">正在完成登录…</p>
<script>
try {
  const payload = ${payload};
  if (window.opener) window.opener.postMessage(payload, payload.targetOrigin || "*");
  document.getElementById("status").textContent = "登录结果已发送，可以关闭此页面。";
  setTimeout(() => window.close(), 400);
} catch (error) {
  document.getElementById("status").textContent = "登录结果发送失败，请回到创意工坊重试。";
}
</script></body>`;
}

function errorHtml(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>登录失败</title>
<body style="font:14px system-ui;background:#111;color:#ddd;padding:24px">
<p>${escapeHtml(message)}</p><p>可以关闭此页面并回到创意工坊重试。</p></body>`;
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
  if (!token || !(await c.executionCtx.exports.DataService.identityRevoke(token))) {
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
  const state = randomToken();
  const verifier = randomToken(48);
  const deviceCode = parsed.data.mode === "device" ? randomToken(32) : null;
  const binding = randomToken(32);
  const expiresAt = new Date(Date.now() + FLOW_TTL_MS).toISOString();
  await c.executionCtx.exports.DataService.identityCreateFlow({
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

  const scopes = ["identify", "guilds"];
  if (requiredRoles.size > 0) scopes.push("guilds.members.read");
  let url = `${requestOrigin}/auth/pending?flow=${encodeURIComponent(id)}`;
  if (c.env.DISCORD_CLIENT_ID) {
    const query = new URLSearchParams({
      client_id: c.env.DISCORD_CLIENT_ID,
      response_type: "code",
      redirect_uri: `${publicOrigin(c)}${CALLBACK_PATH}`,
      scope: scopes.join(" "),
      state,
      code_challenge: await s256(verifier),
      code_challenge_method: "S256",
    });
    url = `https://discord.com/oauth2/authorize?${query.toString()}`;
  }
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

authRoutes.get("/flows/:id", async (c) => {
  const deviceSecret = c.req.query("deviceCode") ?? c.req.header("x-device-secret") ?? "";
  const flow = await c.executionCtx.exports.DataService.identityFlowStatus(
    c.req.param("id"),
    [cookieValue(c, "cw_oauth_binding"), cookieValue(c, "cw_oauth_binding_p")].filter(Boolean),
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
  const result = await c.executionCtx.exports.DataService.identityRedeemFlow(
    c.req.param("id"),
    [cookieValue(c, "cw_oauth_binding"), cookieValue(c, "cw_oauth_binding_p")].filter(Boolean),
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
  const flow = state ? await c.executionCtx.exports.DataService.identityFlowByState(state) : null;
  if (!flow) return htmlResponse(errorHtml("登录状态无效或已过期。"), 400);
  if (flow.mode !== "browser" && !(await bindingMatches(c, flow))) {
    return htmlResponse(errorHtml("登录状态无效或已过期。"), 400);
  }
  if (oauthError) {
    await c.executionCtx.exports.DataService.identityFlowError(flow.id, `Discord 返回错误：${oauthError}`);
    return htmlResponse(errorHtml("Discord 未完成授权。"), 400);
  }
  if (flow.status !== "pending" || Date.parse(flow.expires_at) <= Date.now()) {
    return htmlResponse(errorHtml("登录状态无效或已过期。"), 400);
  }
  if (!code) return htmlResponse(errorHtml("缺少 Discord 授权码。"), 400);

  try {
    const result = await exchangeDiscord(c, flow, code);
    const redeemCode = flow.mode === "embed" ? randomToken(32) : null;
    const authorized = await c.executionCtx.exports.DataService.identityAuthorizeFlow(
      flow.id,
      result.user,
      result.guildId,
      redeemCode,
    );
    if (!authorized) return htmlResponse(errorHtml("登录状态已被使用。"), 409);
    if (flow.mode === "browser") {
      const token = authorized.token;
      return htmlResponse(
        callbackHtml(
          JSON.stringify({
            type: "oauth-success",
            source: "creative-workshop-auth-callback",
            state,
            token,
            targetOrigin: flow.origin,
          }),
        ),
      );
    }

    if (flow.mode === "embed") {
      return htmlResponse(
        callbackHtml(
          JSON.stringify({
            type: "oauth-code",
            source: "creative-workshop-auth-callback",
            state,
            code: redeemCode,
            flowId: flow.id,
          }),
        ),
      );
    }
    return htmlResponse(
      callbackHtml(
        JSON.stringify({
          type: "oauth-authorized",
          source: "creative-workshop-auth-callback",
          state,
          flowId: flow.id,
        }),
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    await c.executionCtx.exports.DataService.identityFlowError(flow.id, message);
    return htmlResponse(errorHtml(message), 400);
  }
});

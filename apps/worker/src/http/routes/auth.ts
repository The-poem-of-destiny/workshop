import { Hono } from "hono";
import {
  authFlowCreateSchema,
  authFlowRedeemSchema,
  authFlowResponseSchema,
  authFlowStatusSchema,
  authSessionResponseSchema,
} from "@workshop/contracts";
import type { Env } from "../../env";
import { getAuthFlowStatus, getMe, revokeSessionByToken, sha256Hex } from "../../storage/identity.js";
import {
  createOpaqueSession,
  getFlowById,
  getFlowByState,
  insertOAuthFlow,
  markFlowAuthorized,
  markFlowError,
  markFlowRedeemed,
  upsertDiscordUser,
  type AuthFlowRow,
} from "../../storage/oauth.js";
import { jsonError } from "../errors.js";
import { requireSession } from "../session.js";

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
  return (env.ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean);
}

function allowedGuilds(env: Env): string[] {
  return (env.DISCORD_ALLOWED_GUILD_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean);
}

function publicOrigin(c: { env: Env; req: { url: string } }): string {
  return (c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin).replace(/\/+$/, "");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]!));
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
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
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) throw new Error("Discord 未返回访问令牌");

  const headers = { authorization: `Bearer ${token.access_token}` };
  const [userResponse, guildsResponse] = await Promise.all([
    fetch(`${DISCORD_API}/users/@me`, { headers }),
    fetch(`${DISCORD_API}/users/@me/guilds`, { headers }),
  ]);
  if (!userResponse.ok || !guildsResponse.ok) throw new Error("无法读取 Discord 账号信息");
  const user = await userResponse.json() as {
    id?: string;
    username?: string;
    global_name?: string | null;
    avatar?: string | null;
  };
  if (!user.id || !user.username) throw new Error("Discord 账号信息不完整");
  const guilds = await guildsResponse.json() as Array<{ id?: string }>;
  const allowed = new Set(allowedGuilds(c.env));
  if (allowed.size === 0) throw new Error("服务器未配置允许的 Discord 服务器");
  const guild = guilds.find(item => item.id && allowed.has(item.id));
  if (!guild?.id) throw new Error("你的账号不在允许的 Discord 服务器中");
  return { user: { id: user.id, username: user.username, global_name: user.global_name, avatar: user.avatar }, guildId: guild.id };
}

export const authRoutes = new Hono<{ Bindings: Env }>();
export const sessionRoutes = new Hono<{ Bindings: Env }>();

sessionRoutes.delete("/current", async c => {
  const session = await requireSession(c);
  if (!session) return jsonError(c, "unauthorized", "Login required");
  const authorization = c.req.header("authorization");
  const token = authorization?.slice("Bearer ".length);
  if (!token) return jsonError(c, "unauthorized", "Login required");
  await revokeSessionByToken(c.env.DB, token);
  return c.body(null, 204);
});

authRoutes.post("/flows", async c => {
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

  const id = crypto.randomUUID();
  const state = randomToken();
  const verifier = randomToken(48);
  const deviceCode = parsed.data.mode === "device" ? randomToken(32) : null;
  const expiresAt = new Date(Date.now() + FLOW_TTL_MS).toISOString();
  await insertOAuthFlow(c.env.DB, {
    id,
    state,
    verifier,
    codeChallenge: parsed.data.codeChallenge ?? null,
    redeemHash: deviceCode ? await sha256Hex(deviceCode) : null,
    origin: publicOrigin(c),
    mode: parsed.data.mode,
    expiresAt,
  });

  let url = `${requestOrigin}/auth/pending?flow=${encodeURIComponent(id)}`;
  if (c.env.DISCORD_CLIENT_ID) {
    const query = new URLSearchParams({
      client_id: c.env.DISCORD_CLIENT_ID,
      response_type: "code",
      redirect_uri: `${publicOrigin(c)}${CALLBACK_PATH}`,
      scope: "identify guilds",
      state,
      code_challenge: await s256(verifier),
      code_challenge_method: "S256",
    });
    url = `https://discord.com/oauth2/authorize?${query.toString()}`;
  }
  return c.json(authFlowResponseSchema.parse({
    id,
    state,
    url,
    expiresAt,
    mode: parsed.data.mode,
    ...(deviceCode ? { deviceCode } : {}),
  }), 201);
});

authRoutes.get("/flows/:id", async c => {
  const deviceSecret = c.req.query("deviceCode") ?? c.req.header("x-device-secret") ?? "";
  const status = await getAuthFlowStatus(c.env.DB, c.req.param("id"), deviceSecret);
  if (!status) return jsonError(c, "not_found", "Auth flow not found");
  return c.json(authFlowStatusSchema.parse(status));
});

authRoutes.post("/flows/:id/redeem", async c => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "bad_request", "Invalid JSON body");
  }
  const parsed = authFlowRedeemSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid redeem request", parsed.error.flatten());
  const flow = await getFlowById(c.env.DB, c.req.param("id"));
  if (!flow || flow.status !== "authorized" || !flow.user_id) {
    return jsonError(c, "conflict", "Auth flow is not ready for redemption");
  }
  if (Date.parse(flow.expires_at) <= Date.now()) return jsonError(c, "conflict", "Auth flow expired");

  let secretOk = false;
  if (flow.mode === "device") {
    secretOk = Boolean(parsed.data.deviceCode && flow.redeem_hash
      && await sha256Hex(parsed.data.deviceCode) === flow.redeem_hash);
  } else if (flow.mode === "embed") {
    const codeOk = Boolean(parsed.data.code && flow.redeem_hash
      && await sha256Hex(parsed.data.code) === flow.redeem_hash);
    const verifierOk = Boolean(parsed.data.verifier && flow.code_challenge
      && await s256(parsed.data.verifier) === flow.code_challenge);
    secretOk = codeOk && verifierOk;
  }
  if (!secretOk) return jsonError(c, "forbidden", "Invalid redeem secret");

  if (!await markFlowRedeemed(c.env.DB, flow.id)) {
    return jsonError(c, "conflict", "Auth flow was already redeemed");
  }
  const { token, expiresAt } = await createOpaqueSession(c.env.DB, flow.user_id);
  const me = await getMe(c.env.DB, flow.user_id);
  if (!me) return jsonError(c, "internal", "User not found");
  return c.json(authSessionResponseSchema.parse({ token, expiresAt, user: me.user }));
});

authRoutes.get("/callback", async c => {
  const state = c.req.query("state") ?? "";
  const code = c.req.query("code") ?? "";
  const oauthError = c.req.query("error");
  const flow = state ? await getFlowByState(c.env.DB, state) : null;
  if (!flow) return htmlResponse(errorHtml("登录状态无效或已过期。"), 400);
  if (oauthError) {
    await markFlowError(c.env.DB, flow.id, `Discord 返回错误：${oauthError}`);
    return htmlResponse(errorHtml("Discord 未完成授权。"), 400);
  }
  if (flow.status !== "pending" || Date.parse(flow.expires_at) <= Date.now()) {
    return htmlResponse(errorHtml("登录状态无效或已过期。"), 400);
  }
  if (!code) return htmlResponse(errorHtml("缺少 Discord 授权码。"), 400);

  try {
    const result = await exchangeDiscord(c, flow, code);
    await upsertDiscordUser(c.env.DB, result.user);
    if (flow.mode === "browser") {
      if (!await markFlowAuthorized(c.env.DB, flow.id, result.user.id, result.guildId, null)) {
        return htmlResponse(errorHtml("登录状态已被使用。"), 409);
      }
      const { token } = await createOpaqueSession(c.env.DB, result.user.id);
      await markFlowRedeemed(c.env.DB, flow.id);
      return htmlResponse(callbackHtml(JSON.stringify({
        type: "oauth-success",
        source: "creative-workshop-auth-callback",
        state,
        token,
        targetOrigin: flow.origin,
      })));
    }

    const redeemCode = flow.mode === "embed" ? randomToken(32) : null;
    if (!await markFlowAuthorized(c.env.DB, flow.id, result.user.id, result.guildId, redeemCode)) {
      return htmlResponse(errorHtml("登录状态已被使用。"), 409);
    }
    if (flow.mode === "embed") {
      return htmlResponse(callbackHtml(JSON.stringify({
        type: "oauth-code",
        source: "creative-workshop-auth-callback",
        state,
        code: redeemCode,
        flowId: flow.id,
      })));
    }
    return htmlResponse(callbackHtml(JSON.stringify({
      type: "oauth-authorized",
      source: "creative-workshop-auth-callback",
      state,
      flowId: flow.id,
    })));
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    await markFlowError(c.env.DB, flow.id, message);
    return htmlResponse(errorHtml(message), 400);
  }
});

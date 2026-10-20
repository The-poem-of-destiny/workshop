import { Hono } from "hono";
import {
  authFlowCreateSchema,
  authFlowResponseSchema,
  authFlowStatusSchema,
} from "@workshop/contracts";
import type { Env } from "../../env";
import { getAuthFlowStatus, insertAuthFlow, revokeSessionByToken } from "../../storage/identity.js";
import { jsonError } from "../errors.js";
import { requireSession } from "../session.js";

const CALLBACK_PATH = "/api/v1/auth/callback";

type DiscordEnv = Env & { DISCORD_CLIENT_ID?: string };

function randomToken(bytes = 32): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  let binary = "";
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export const authRoutes = new Hono<{ Bindings: Env }>();

// Session revocation is exported separately so the parent can mount it at
// /api/v1/sessions without making this auth flow route handle that prefix.
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
  const bodyRecord = typeof body === "object" && body !== null ? body as Record<string, unknown> : null;
  const requestedOrigin = typeof bodyRecord?.origin === "string" ? bodyRecord.origin : undefined;
  const configuredOrigins = (c.env.ALLOWED_ORIGINS ?? "").split(",").map(origin => origin.trim()).filter(Boolean);
  if (!requestedOrigin || !configuredOrigins.includes(requestedOrigin)) {
    return jsonError(c, "forbidden", "Origin is not allowed");
  }
  const parsed = authFlowCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, "bad_request", "Invalid auth flow", parsed.error.flatten());

  const id = crypto.randomUUID();
  const state = randomToken();
  const verifier = randomToken(48);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await insertAuthFlow(c.env.DB, {
    id,
    state,
    verifier,
    origin: parsed.data.origin,
    mode: parsed.data.mode,
    expiresAt,
  });

  const discordClientId = (c.env as DiscordEnv).DISCORD_CLIENT_ID;
  let url = `${parsed.data.origin}/auth/pending?flow=${encodeURIComponent(id)}`;
  if (discordClientId) {
    const callback = new URL(CALLBACK_PATH, parsed.data.origin).toString();
    const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    let challengeBinary = "";
    for (const value of new Uint8Array(challengeBytes)) challengeBinary += String.fromCharCode(value);
    const challenge = btoa(challengeBinary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const query = new URLSearchParams({
      client_id: discordClientId,
      response_type: "code",
      redirect_uri: callback,
      scope: "identify",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    url = `https://discord.com/oauth2/authorize?${query.toString()}`;
  }
  return c.json(authFlowResponseSchema.parse({ id, state, url, expiresAt }), 201);
});

authRoutes.get("/flows/:id", async c => {
  const status = await getAuthFlowStatus(c.env.DB, c.req.param("id"));
  if (!status) return jsonError(c, "not_found", "Auth flow not found");
  return c.json(authFlowStatusSchema.parse(status));
});

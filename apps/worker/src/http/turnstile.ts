import type { Context } from "hono";
import type { Env } from "../env";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;

export const TURNSTILE_HEADER = "x-turnstile-token";
export const TURNSTILE_REQUIRED_MESSAGE = "请先完成人机验证后再继续。";

export function turnstilePublicConfig(env: Pick<Env, "TURNSTILE_SITE_KEY" | "TURNSTILE_SECRET_KEY">): {
  enabled: boolean;
  siteKey: string | null;
} {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() || "";
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim() || "";
  if (!siteKey || !secretKey) {
    return { enabled: false, siteKey: null };
  }
  return { enabled: true, siteKey };
}

export async function verifyTurnstileRequest(
  c: Context<{ Bindings: Env }>,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: "missing" | "invalid" | "unavailable" }> {
  const config = turnstilePublicConfig(c.env);
  if (!config.enabled) return { ok: true };

  const token = c.req.header(TURNSTILE_HEADER)?.trim() ?? "";
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "missing" };
  }

  const secret = c.env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  const body = new URLSearchParams({ secret, response: token });
  const remoteIp = c.req.header("cf-connecting-ip")?.trim();
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const response = await fetcher(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const payload = (await response.json()) as { success?: unknown };
    return payload.success === true ? { ok: true } : { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

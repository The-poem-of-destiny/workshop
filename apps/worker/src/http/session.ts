import type { Context } from "hono";
import type { Env } from "../env";
import { getSessionByToken } from "../storage/sessions.js";

export async function requireSession(c: Context<{ Bindings: Env }>) {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return getSessionByToken(c.env.DB, header.slice("Bearer ".length), c.env.SESSION_HASH_SECRET);
}

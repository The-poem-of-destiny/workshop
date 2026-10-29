import type { Context } from "hono";
import type { Env } from "../env";

export function sessionToken(c: Context<{ Bindings: Env }>): string {
  const header = c.req.header("authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

export async function requireSession(c: Context<{ Bindings: Env }>) {
  const token = sessionToken(c);
  if (!token) return null;
  return c.executionCtx.exports.DataService.identitySession(token);
}

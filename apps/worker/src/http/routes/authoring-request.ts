import type { Context } from "hono";
import type { Env } from "../../env.js";
import { jsonError } from "../errors.js";
import { requireSession } from "../session.js";

export function ifMatchVersion(value: string | undefined): number | null {
  if (!value) return null;
  const unquoted = value.trim().replace(/^"|"$|^'|'$/g, "");
  const parsed = Number(unquoted);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function sessionOrError(c: Context<{ Bindings: Env }>) {
  const session = await requireSession(c);
  if (!session) return { response: jsonError(c, "unauthorized", "Login required") };
  return { session };
}

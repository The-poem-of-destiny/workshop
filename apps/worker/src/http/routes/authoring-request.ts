import type { Context } from "hono";
import type { Env } from "../../env.js";
import { jsonError } from "../errors.js";
import { requireSession } from "../session.js";

export async function sessionOrError(c: Context<{ Bindings: Env }>) {
  const session = await requireSession(c);
  if (!session) return { response: jsonError(c, "unauthorized", "Login required") };
  return { session };
}

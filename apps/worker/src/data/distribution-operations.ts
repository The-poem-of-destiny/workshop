import type { SiteSettings } from "@workshop/contracts";
import {
  adminSiteUpdateSchema,
  companionScriptIdSchema,
  companionVersionInputSchema,
  companionVersionSchema,
  referenceSetListResponseSchema,
  referenceSetSchema,
  siteSettingsSchema,
} from "@workshop/contracts";
import { updateAdminSite } from "../storage/admin-site.js";
import { getClientChannel } from "../storage/client.js";
import { getCompanionVersion, publishCompanionVersion } from "../storage/companion.js";
import { getBanner, getSiteContent, listRecommendations } from "../storage/home.js";
import { getReferenceSet, listReferenceSets } from "../storage/references.js";
import { getSessionByToken } from "../storage/sessions.js";
import type { DataEnv } from "./env.js";

async function owner(env: DataEnv, authorization: string | null | undefined) {
  const session = authorization?.startsWith("Bearer ")
    ? await getSessionByToken(env.DB, authorization.slice(7), env.SESSION_HASH_SECRET)
    : null;
  if (!session) return { kind: "unauthorized" as const };
  if (session.role !== "owner") return { kind: "forbidden" as const };
  return { kind: "ok" as const, session };
}

export async function distributionSite(env: DataEnv) {
  return siteSettingsSchema.parse({ banner: await getBanner(env.DB), siteContent: await getSiteContent(env.DB) });
}
export async function distributionRecommendations(env: DataEnv) {
  return { items: await listRecommendations(env.DB) };
}
export async function distributionReferences(env: DataEnv) {
  return referenceSetListResponseSchema.parse({ items: await listReferenceSets(env.DB) });
}
export async function distributionReference(env: DataEnv, id: string) {
  const set = await getReferenceSet(env.DB, id);
  return set ? referenceSetSchema.parse(set) : null;
}
export async function distributionClientChannel(env: DataEnv, channel: "stable" | "staging") {
  return getClientChannel(env.DB, channel);
}
export async function distributionCompanion(env: DataEnv, id: string, version?: string) {
  return getCompanionVersion(env.DB, id, version);
}
export async function distributionPublishCompanion(
  env: DataEnv,
  authorization: string | undefined,
  id: string,
  version: string,
  body: unknown,
) {
  const auth = await owner(env, authorization);
  if (auth.kind !== "ok") return auth;
  const script = companionScriptIdSchema.safeParse(id);
  const release = companionVersionSchema.safeParse(version);
  const input = companionVersionInputSchema.safeParse(body);
  if (!script.success || !release.success || !input.success) return { kind: "invalid" as const };
  return {
    kind: "ok" as const,
    data: await publishCompanionVersion(env.DB, auth.session.userId, script.data, release.data, input.data),
  };
}
export async function distributionUpdateSite(
  env: DataEnv,
  authorization: string | undefined,
  body: unknown,
): Promise<
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "empty" }
  | { kind: "invalid"; formErrors: string[]; fieldErrors: Array<{ field: string; messages: string[] }> }
  | { kind: "ok"; data: { banner: SiteSettings["banner"]; siteContent: string | number | boolean | object | null } }
> {
  const auth = await owner(env, authorization);
  if (auth.kind !== "ok") return auth;
  const parsed = adminSiteUpdateSchema.safeParse(body);
  if (!parsed.success) {
    const flattened = parsed.error.flatten();
    const fieldErrors: Array<{ field: string; messages: string[] }> = [];
    for (const [field, messages] of Object.entries(flattened.fieldErrors)) {
      if (messages) fieldErrors.push({ field, messages });
    }
    return { kind: "invalid" as const, formErrors: flattened.formErrors, fieldErrors };
  }
  if (parsed.data.banner === undefined && parsed.data.siteContent === undefined) return { kind: "empty" as const };
  const result = await updateAdminSite(env.DB, auth.session.userId, parsed.data.banner, parsed.data.siteContent);
  return {
    kind: "ok" as const,
    data: siteSettingsSchema.parse({
      banner: result.banner ?? (await getBanner(env.DB)),
      siteContent: result.siteContent === undefined ? await getSiteContent(env.DB) : result.siteContent,
    }),
  };
}

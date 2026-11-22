import type { SiteSettings } from "@workshop/contracts";
import {
  adminSiteUpdateSchema,
  companionScriptIdSchema,
  companionVersionInputSchema,
  companionVersionSchema,
  siteSettingsSchema,
} from "@workshop/contracts";
import { parseDiscordInviteUrl } from "@workshop/domain";
import { updateAdminSite } from "../storage/admin-site.js";
import { getClientChannel } from "../storage/client.js";
import { getCompanionVersion, publishCompanionVersion } from "../storage/companion.js";
import {
  type BannerState,
  bannerSourceKey,
  bannerSourceUrl,
  getBanner,
  getCommunityInviteUrl,
  getSiteContent,
  listRecommendations,
  publicBannerPrefix,
  publicBannerUrl,
  readBannerState,
} from "../storage/home.js";
import { getSessionByToken } from "../storage/sessions.js";
import type { DataEnv } from "./env.js";
import { withdrawPublicBanner } from "./public-banner.js";

async function owner(env: DataEnv, authorization: string | null | undefined) {
  const session = authorization?.startsWith("Bearer ")
    ? await getSessionByToken(env.DB, authorization.slice(7), env.SESSION_HASH_SECRET)
    : null;
  if (!session) return { kind: "unauthorized" as const };
  if (!session.policyAccepted || session.role !== "owner") return { kind: "forbidden" as const };
  return { kind: "ok" as const, session };
}

export function distributionCommunityInviteUrl(env: DataEnv) {
  return getCommunityInviteUrl(env.DB);
}

export async function distributionSite(env: DataEnv) {
  return siteSettingsSchema.parse({ banner: await getBanner(env.DB, env), siteContent: await getSiteContent(env.DB) });
}
export async function distributionRecommendations(env: DataEnv) {
  return { items: await listRecommendations(env.DB, env.PUBLIC_ASSETS_BASE_URL) };
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

function normalizeCommunityInvite(siteContent: unknown) {
  if (!siteContent || typeof siteContent !== "object" || Array.isArray(siteContent)) return;
  const content = siteContent as Record<string, unknown>;
  const invite = content.communityInviteUrl;
  if (invite === null || invite === undefined) return;
  if (typeof invite !== "string") return "社区邀请链接必须是字符串";
  const checked = parseDiscordInviteUrl(invite);
  if (!checked.ok) return checked.reason;
  content.communityInviteUrl = checked.value;
}

function resolveBannerImage(env: DataEnv, current: BannerState | null, input: string | null, source: string | null) {
  if (input === null || input === source) return input;
  const inputKey = bannerSourceKey(input, env.PUBLIC_ORIGIN);
  if (inputKey) return inputKey === bannerSourceKey(source, env.PUBLIC_ORIGIN) ? source : undefined;
  const base = env.PUBLIC_ASSETS_BASE_URL;
  if (!base || !URL.canParse(input)) return input;
  const candidate = new URL(input);
  const namespace = new URL(publicBannerUrl(base, publicBannerPrefix));
  if (candidate.origin !== namespace.origin || !candidate.pathname.startsWith(namespace.pathname)) return input;
  return current?.phase === "ready" && current.object_key && input === publicBannerUrl(base, current.object_key)
    ? source
    : undefined;
}

export async function distributionUpdateSite(
  env: DataEnv,
  authorization: string | undefined,
  body: unknown,
): Promise<
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "empty" }
  | { kind: "conflict"; message: string }
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
  const inviteError = normalizeCommunityInvite(parsed.data.siteContent);
  if (inviteError !== undefined) {
    return {
      kind: "invalid",
      formErrors: [inviteError],
      fieldErrors: [{ field: "communityInviteUrl", messages: [inviteError] }],
    };
  }
  const banner = parsed.data.banner;
  const current = banner ? await readBannerState(env.DB) : null;
  const conflict = { kind: "conflict" as const, message: "Banner changed or is being updated; refresh and try again" };
  if (banner) {
    const source = bannerSourceUrl(current);
    const image = resolveBannerImage(env, current, banner.imageUrl, source);
    if (image === undefined) return conflict;
    banner.imageUrl = image;
    if (banner.imageUrl !== source && !(await withdrawPublicBanner(env, current))) return conflict;
  }
  const result = await updateAdminSite(
    env.DB,
    auth.session.userId,
    banner ? { banner, current } : undefined,
    parsed.data.siteContent,
  );
  if (!result) return conflict;
  return {
    kind: "ok" as const,
    data: siteSettingsSchema.parse({
      banner: await getBanner(env.DB, env),
      siteContent: result.siteContent === undefined ? await getSiteContent(env.DB) : result.siteContent,
    }),
  };
}

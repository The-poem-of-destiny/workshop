import type { JsonValue, SiteSettings } from "@workshop/contracts";
import { DEFAULT_COMMUNITY_INVITE_URL, parseDiscordInviteUrl } from "@workshop/domain";

export interface ParsedSiteContent {
  communityInviteUrl: string;
  customInviteUrl: string;
  announcement: string;
  extra: Record<string, JsonValue>;
}

export function parseSiteContent(site: SiteSettings | null | undefined): ParsedSiteContent {
  const raw = site?.siteContent;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      communityInviteUrl: DEFAULT_COMMUNITY_INVITE_URL,
      customInviteUrl: "",
      announcement: "",
      extra: {},
    };
  }
  const record = raw as Record<string, JsonValue>;
  const { communityInviteUrl: rawInvite, announcement: rawAnnouncement, ...extra } = record;
  let communityInviteUrl = DEFAULT_COMMUNITY_INVITE_URL;
  let customInviteUrl = "";
  if (typeof rawInvite === "string" && rawInvite.trim()) {
    const checked = parseDiscordInviteUrl(rawInvite);
    if (checked.ok && checked.value) {
      communityInviteUrl = checked.value;
      customInviteUrl = checked.value;
    }
  }
  const announcement = typeof rawAnnouncement === "string" ? rawAnnouncement.trim() : "";
  return { communityInviteUrl, customInviteUrl, announcement, extra };
}

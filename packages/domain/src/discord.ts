const DISCORD_HOSTS = ["discord.com", "www.discord.com"] as const;
const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export type DiscordThreadParse =
  | { ok: true; value: string | null; guildId: string | null; threadId: string | null }
  | { ok: false; reason: string };

/**
 * Shape-only parse for a project community thread URL. Guild admission is a
 * separate runtime policy so contracts can reject malformed URLs without
 * knowing deployment configuration.
 */
export function parseDiscordThreadUrl(value: unknown): DiscordThreadParse {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: true, value: null, guildId: null, threadId: null };
  if (raw.length > 500) return { ok: false, reason: "too-long" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "not-https" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (!(DISCORD_HOSTS as readonly string[]).includes(url.hostname.toLowerCase())) {
    return { ok: false, reason: "not-discord-host" };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "channels") {
    return { ok: false, reason: "not-a-thread-url" };
  }
  const guildId = parts[1];
  const threadId = parts[2];
  if (!guildId || !threadId || !DISCORD_SNOWFLAKE_PATTERN.test(guildId) || !DISCORD_SNOWFLAKE_PATTERN.test(threadId)) {
    return { ok: false, reason: "invalid-snowflake" };
  }

  return {
    ok: true,
    value: `https://discord.com/channels/${guildId}/${threadId}`,
    guildId,
    threadId,
  };
}

export function normalizeDiscordThreadUrl(
  value: unknown,
  allowedGuildIds: readonly string[],
): { ok: true; value: string | null } | { ok: false; reason: string } {
  const parsed = parseDiscordThreadUrl(value);
  if (!parsed.ok) return parsed;
  if (parsed.value === null) return { ok: true, value: null };
  if (!allowedGuildIds.includes(parsed.guildId!)) {
    return { ok: false, reason: "guild-not-allowed" };
  }
  return { ok: true, value: parsed.value };
}

const DISCORD_AVATAR_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const DISCORD_AVATAR_USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DISCORD_AVATAR_HASH_PATTERN = /^(?:a_)?[A-Za-z0-9_-]{2,128}$/;

export function discordAvatarUrl(userId: string, avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  if (avatar.startsWith("https://")) {
    if (avatar.length > 2048 || /[\u0000-\u001F\u007F\s]/.test(avatar)) return null;
    let url: URL;
    try {
      url = new URL(avatar);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || url.username || url.password || !DISCORD_AVATAR_HOSTS.has(url.hostname)) {
      return null;
    }
    return avatar;
  }
  if (!DISCORD_AVATAR_USER_ID_PATTERN.test(userId) || !DISCORD_AVATAR_HASH_PATTERN.test(avatar)) {
    return null;
  }
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`;
}

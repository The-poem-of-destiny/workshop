import { describe, expect, it } from "vitest";
import { discordAvatarUrl, normalizeDiscordThreadUrl, parseDiscordThreadUrl } from "../src/discord.js";
import { DEFAULT_COMMUNITY_INVITE_URL, parseDiscordInviteUrl } from "../src/policy.js";

const GUILD = "123456789012345678";
const THREAD = "223456789012345678";

describe("Discord thread URL policy", () => {
  it("accepts only canonical discord.com thread URLs in an allowed guild", () => {
    expect(normalizeDiscordThreadUrl(`https://www.discord.com/channels/${GUILD}/${THREAD}?x=1#y`, [GUILD])).toEqual({
      ok: true,
      value: `https://discord.com/channels/${GUILD}/${THREAD}`,
    });
    expect(normalizeDiscordThreadUrl("", [GUILD])).toEqual({ ok: true, value: null });
  });

  it.each([
    ["https://discord.gg/invite", "not-discord-host"],
    ["http://discord.com/channels/123456789012345678/223456789012345678", "not-https"],
    ["https://discord.com/channels/1/2", "invalid-snowflake"],
    ["https://discord.com/channels/123456789012345678", "not-a-thread-url"],
    ["https://discord.com/channels/123456789012345678/223456789012345678/extra", "not-a-thread-url"],
    ["https://user:pass@discord.com/channels/123456789012345678/223456789012345678", "credentials"],
    ["https://discordapp.com/channels/123456789012345678/223456789012345678", "not-discord-host"],
  ])("rejects %s", (url, reason) => {
    expect(parseDiscordThreadUrl(url)).toEqual({ ok: false, reason });
  });

  it("rejects a well-formed thread from another guild", () => {
    expect(normalizeDiscordThreadUrl(`https://discord.com/channels/323456789012345678/${THREAD}`, [GUILD])).toEqual({
      ok: false,
      reason: "guild-not-allowed",
    });
    expect(normalizeDiscordThreadUrl(`https://discord.com/channels/${GUILD}/${THREAD}`, [])).toEqual({
      ok: false,
      reason: "guild-not-allowed",
    });
  });

  it("normalizes valid Discord invite URLs and rejects unsafe or thread URLs", () => {
    expect(parseDiscordInviteUrl(DEFAULT_COMMUNITY_INVITE_URL)).toEqual({
      ok: true,
      value: "https://discord.gg/KNy8yV5w44",
    });
    expect(parseDiscordInviteUrl("https://discord.com/invite/KNy8yV5w44")).toEqual({
      ok: true,
      value: "https://discord.gg/KNy8yV5w44",
    });
    expect(parseDiscordInviteUrl("")).toEqual({ ok: true, value: null });
    expect(parseDiscordInviteUrl("javascript:alert(1)")).toEqual({ ok: false, reason: "not-https" });
    expect(parseDiscordInviteUrl(`https://discord.com/channels/${GUILD}/${THREAD}`)).toEqual({
      ok: false,
      reason: "not-discord-invite",
    });
  });

  it("permits Discord CDN avatar URLs or URL-safe user IDs with valid avatar hashes", () => {
    expect(discordAvatarUrl(GUILD, "a_123456abcdef_-99")).toBe(
      `https://cdn.discordapp.com/avatars/${GUILD}/a_123456abcdef_-99.png`,
    );
    expect(discordAvatarUrl("e2e-author", "abcdef123456")).toBe(
      "https://cdn.discordapp.com/avatars/e2e-author/abcdef123456.png",
    );
    expect(discordAvatarUrl("u1", "abcdef123456")).toBe("https://cdn.discordapp.com/avatars/u1/abcdef123456.png");
    expect(discordAvatarUrl(GUILD, "https://cdn.discordapp.com/embed/avatars/0.png")).toBe(
      "https://cdn.discordapp.com/embed/avatars/0.png",
    );
    expect(discordAvatarUrl(GUILD, "https://media.discordapp.net/avatars/123456789012345678/abc.webp")).toBe(
      "https://media.discordapp.net/avatars/123456789012345678/abc.webp",
    );

    expect(discordAvatarUrl(GUILD, null)).toBeNull();
    expect(discordAvatarUrl("", "abcdef123456")).toBeNull();
    expect(discordAvatarUrl("../other", "abcdef123456")).toBeNull();
    expect(discordAvatarUrl("user/2", "abcdef123456")).toBeNull();
    expect(discordAvatarUrl("a".repeat(65), "abcdef123456")).toBeNull();
    expect(discordAvatarUrl(GUILD, "../other")).toBeNull();
    expect(discordAvatarUrl(GUILD, "javascript:alert(1)")).toBeNull();
    expect(discordAvatarUrl(GUILD, "https://evil.example/a.png")).toBeNull();
    expect(discordAvatarUrl(GUILD, "https://user:pass@cdn.discordapp.com/embed/avatars/0.png")).toBeNull();
  });
});

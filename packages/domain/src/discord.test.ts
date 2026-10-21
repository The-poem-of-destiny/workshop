import { describe, expect, it } from "vitest";
import { normalizeDiscordThreadUrl, parseDiscordThreadUrl } from "./discord.js";

const GUILD = "123456789012345678";
const THREAD = "223456789012345678";

describe("Discord thread URL policy", () => {
  it("accepts only canonical discord.com thread URLs in an allowed guild", () => {
    expect(normalizeDiscordThreadUrl(
      `https://www.discord.com/channels/${GUILD}/${THREAD}?x=1#y`,
      [GUILD],
    )).toEqual({ ok: true, value: `https://discord.com/channels/${GUILD}/${THREAD}` });
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
    expect(normalizeDiscordThreadUrl(
      `https://discord.com/channels/323456789012345678/${THREAD}`,
      [GUILD],
    )).toEqual({ ok: false, reason: "guild-not-allowed" });
    expect(normalizeDiscordThreadUrl(
      `https://discord.com/channels/${GUILD}/${THREAD}`,
      [],
    )).toEqual({ ok: false, reason: "guild-not-allowed" });
  });
});

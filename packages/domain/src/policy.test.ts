import { describe, expect, it } from "vitest";
import { validateCollectionMetadata } from "./collections.js";
import {
  CURRENT_POLICY_VERSION,
  DEFAULT_COMMUNITY_INVITE_URL,
  evaluatePolicyQuiz,
  hasAcceptedCurrentPolicy,
  parseDiscordInviteUrl,
  WORKSHOP_POLICY_QUESTIONS,
} from "./policy.js";

describe("policy quiz and invite url validation", () => {
  it("accepts only when all three single-choice questions are answered accurately", () => {
    expect(WORKSHOP_POLICY_QUESTIONS).toHaveLength(3);
    expect(
      evaluatePolicyQuiz({
        "issue-handling": "contact-author",
        "content-liability": "author-responsible",
        "install-behavior": "append-and-backup",
      }),
    ).toEqual({ ok: true, incorrectQuestionIds: [] });

    expect(
      evaluatePolicyQuiz({
        "issue-handling": "contact-official",
        "content-liability": "author-responsible",
        "install-behavior": "auto-subscribe",
      }),
    ).toEqual({
      ok: false,
      incorrectQuestionIds: ["issue-handling", "install-behavior"],
    });
  });

  it("tracks exact current policy version", () => {
    expect(hasAcceptedCurrentPolicy(null)).toBe(false);
    expect(hasAcceptedCurrentPolicy("2025-01")).toBe(false);
    expect(hasAcceptedCurrentPolicy(CURRENT_POLICY_VERSION)).toBe(true);
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
    expect(parseDiscordInviteUrl("https://discord.com/channels/123456789012345678/123456789012345678")).toEqual({
      ok: false,
      reason: "not-discord-invite",
    });
  });

  it("validates collection title and description bounds", () => {
    expect(validateCollectionMetadata({ title: "  白曜城系列  ", description: " 精选合集 " })).toEqual({
      ok: true,
      title: "白曜城系列",
      description: "精选合集",
    });
    expect(validateCollectionMetadata({ title: "   " }).ok).toBe(false);
    expect(validateCollectionMetadata({ title: "含控制字符\u0000" }).ok).toBe(false);
  });
});

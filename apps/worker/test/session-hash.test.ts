import { describe, expect, it } from "vitest";
import { hashSessionToken } from "../src/storage/session-hash";

describe("session token hashing", () => {
  it("uses HMAC when a secret is configured and never returns the token", async () => {
    const token = "session-token-value";
    const withSecret = await hashSessionToken(token, "server-secret");
    const otherSecret = await hashSessionToken(token, "other-secret");
    const plain = await hashSessionToken(token);
    expect(withSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(withSecret).not.toBe(plain);
    expect(withSecret).not.toBe(otherSecret);
    expect(withSecret).not.toContain(token);
  });
});

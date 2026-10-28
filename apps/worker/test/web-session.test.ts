import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setSessionToken } from "../web/src/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("web session logout", () => {
  it("retains the session when revocation fails and clears it after a successful retry", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    setSessionToken("session-token");
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network failure"))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await expect(api.logout()).rejects.toThrow();
    expect(api.hasSession()).toBe(true);
    await expect(api.logout()).rejects.toMatchObject({ status: 500 });
    expect(api.hasSession()).toBe(true);
    await api.logout();
    expect(api.hasSession()).toBe(false);
  });
});

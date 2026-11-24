import { describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import type { Env } from "../src/env";
import { turnstilePublicConfig, verifyTurnstileRequest } from "../src/http/turnstile";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    CONTENT_SERVICE: {} as Env["CONTENT_SERVICE"],
    WRITE_BARRIER: {} as Env["WRITE_BARRIER"],
    ALLOWED_ORIGINS: "https://workshop-staging.poem-of-destiny.3378469.xyz",
    ...overrides,
  };
}

describe("Turnstile verification", () => {
  it("reports disabled config unless both site key and secret key are set", async () => {
    expect(turnstilePublicConfig({})).toEqual({ enabled: false, siteKey: null });
    expect(turnstilePublicConfig({ TURNSTILE_SITE_KEY: "site-only" })).toEqual({ enabled: false, siteKey: null });
    expect(turnstilePublicConfig({ TURNSTILE_SECRET_KEY: "secret-only" })).toEqual({ enabled: false, siteKey: null });
    expect(
      turnstilePublicConfig({ TURNSTILE_SITE_KEY: "0x4AAAAAAGQSGFBNCJcDcPsQ", TURNSTILE_SECRET_KEY: "secret" }),
    ).toEqual({ enabled: true, siteKey: "0x4AAAAAAGQSGFBNCJcDcPsQ" });

    const res = await app.fetch(
      new Request("https://workshop.test/api/v1/turnstile/config"),
      makeEnv({ TURNSTILE_SITE_KEY: "0x4AAAAAAGQSGFBNCJcDcPsQ", TURNSTILE_SECRET_KEY: "secret" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, siteKey: "0x4AAAAAAGQSGFBNCJcDcPsQ" });
  });

  it("rejects protected project content routes with 403 turnstile_required when enabled and token is missing", async () => {
    const env = makeEnv({ TURNSTILE_SITE_KEY: "0x4AAAAAAGQSGFBNCJcDcPsQ", TURNSTILE_SECRET_KEY: "test-secret" });
    const authHeaders = { authorization: "Bearer some-session-token" };

    for (const req of [
      new Request("https://workshop.test/api/v1/projects/proj-1/preview/worldbook", { headers: authHeaders }),
      new Request("https://workshop.test/api/v1/projects/proj-1/downloads", { method: "POST", headers: authHeaders }),
      new Request("https://workshop.test/api/v1/projects/proj-1/acquisitions", {
        method: "POST",
        headers: authHeaders,
      }),
    ]) {
      const res = await app.fetch(req, env);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("turnstile_required");
    }
  });

  it("still returns 401 unauthorized before checking Turnstile when Authorization header is absent", async () => {
    const env = makeEnv({ TURNSTILE_SITE_KEY: "0x4AAAAAAGQSGFBNCJcDcPsQ", TURNSTILE_SECRET_KEY: "test-secret" });
    const res = await app.fetch(new Request("https://workshop.test/api/v1/projects/proj-1/preview/worldbook"), env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("verifies token via Cloudflare siteverify and rejects invalid or unavailable responses", async () => {
    const makeContext = (token?: string) =>
      ({
        env: makeEnv({ TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" }),
        req: {
          header: (name: string) => {
            const lower = name.toLowerCase();
            if (lower === "x-turnstile-token") return token;
            if (lower === "cf-connecting-ip") return "203.0.113.10";
            return undefined;
          },
        },
      }) as Parameters<typeof verifyTurnstileRequest>[0];

    const okFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect(await verifyTurnstileRequest(makeContext("valid-tok"), okFetch)).toEqual({ ok: true });
    expect(okFetch).toHaveBeenCalledTimes(1);
    const init = okFetch.mock.calls[0]?.[1];
    expect(String(init?.body)).toContain("secret=secret");
    expect(String(init?.body)).toContain("response=valid-tok");
    expect(String(init?.body)).toContain("remoteip=203.0.113.10");

    const failFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));
    expect(await verifyTurnstileRequest(makeContext("bad-tok"), failFetch)).toEqual({ ok: false, reason: "invalid" });

    const errorFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"));
    expect(await verifyTurnstileRequest(makeContext("any-tok"), errorFetch)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("advertises x-turnstile-token in CORS preflight", async () => {
    const res = await app.fetch(
      new Request("https://workshop.test/api/v1/projects/proj-1/acquisitions", {
        method: "OPTIONS",
        headers: { origin: "https://workshop-staging.poem-of-destiny.3378469.xyz" },
      }),
      makeEnv(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("x-turnstile-token");
  });
});

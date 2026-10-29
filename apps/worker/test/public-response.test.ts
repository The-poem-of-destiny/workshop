import { describe, expect, it } from "vitest";
import { publicResponse } from "../src/http/public-response";

const request = new Request("https://workshop.test/api/v1/projects");

function wrap(expires: string | null, policy = "public, max-age=300", status = 200, extra: HeadersInit = {}) {
  const headers = new Headers(extra);
  headers.set("cache-control", policy);
  if (expires !== null) headers.set("x-workshop-generated-expires", expires);
  return publicResponse(new Response("{}", { status, headers }), request);
}

describe("public response freshness", () => {
  it("uses the remaining freshness and removes internal metadata", () => {
    const response = wrap(String(Date.now() + 100_000), "public, max-age=300", 200, {
      age: "200",
      "cloudflare-cdn-cache-control": "public, max-age=300",
    });
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1]);
    expect(maxAge).toBeGreaterThanOrEqual(99);
    expect(maxAge).toBeLessThanOrEqual(100);
    expect(response.headers.has("x-workshop-generated-expires")).toBe(false);
    expect(response.headers.has("age")).toBe(false);
    expect(response.headers.has("cloudflare-cdn-cache-control")).toBe(false);
  });

  it.each([null, "bad", "999999999999999999999999999999999999", "1", String(Date.now() + 600_000)])(
    "does not cache missing, invalid or expired deadlines (%s)",
    (expires) => {
      expect(wrap(expires).headers.get("cache-control")).toBe("private, no-store");
    },
  );

  it("never makes partial, failed or cookie-bearing responses public", () => {
    expect(wrap(String(Date.now() + 100_000), "private, no-store").headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(wrap(String(Date.now() + 100_000), "public, max-age=300", 500).headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(
      wrap(String(Date.now() + 100_000), "public, max-age=300", 200, { "set-cookie": "session=x" }).headers.get(
        "cache-control",
      ),
    ).toBe("private, no-store");
  });
});

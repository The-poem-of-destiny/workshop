import { publicCacheClass } from "./cache-policy";
import { canonicalPublicRequest } from "./public-cache";

export function publicResponse(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const expires = headers.get("x-workshop-generated-expires");
  const policy = headers.get("cache-control") ?? "";
  headers.delete("x-workshop-generated-expires");
  headers.delete("cdn-cache-control");
  headers.delete("cloudflare-cdn-cache-control");
  headers.delete("vary");
  headers.delete("age");
  headers.set("date", new Date().toUTCString());
  headers.set("access-control-allow-origin", "*");
  headers.set("x-content-type-options", "nosniff");
  const cacheable = response.status === 200 && !headers.has("set-cookie") && !/private|no-store/i.test(policy);
  headers.delete("set-cookie");
  const expiry = expires !== null && /^\d+$/.test(expires) ? Number(expires) : NaN;
  const now = Date.now();
  if (cacheable && Number.isSafeInteger(expiry) && expiry <= now + 31536000_000) {
    const seconds = Math.floor((expiry - now) / 1000);
    const suffix = /immutable/i.test(policy) ? "immutable" : "stale-if-error=0";
    headers.set("cache-control", seconds > 0 ? `public, max-age=${seconds}, ${suffix}` : "private, no-store");
  } else {
    headers.set("cache-control", "private, no-store");
  }
  const etag = headers.get("etag");
  const matches =
    etag &&
    request.headers
      .get("if-none-match")
      ?.split(",")
      .some((value) => {
        const candidate = value.trim();
        return candidate === "*" || candidate.replace(/^W\//, "") === etag.replace(/^W\//, "");
      });
  const canonical = canonicalPublicRequest(request);
  const versioned =
    canonical.kind === "public" && publicCacheClass(new URL(canonical.request.url).pathname) === "immutable";
  if (response.status === 200 && matches && versioned) {
    void response.body?.cancel();
    headers.delete("content-length");
    return new Response(null, { status: 304, headers });
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

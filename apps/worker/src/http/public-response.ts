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
  const cacheable = response.ok && !headers.has("set-cookie") && !/private|no-store/i.test(policy);
  const expiry = expires !== null && /^\d+$/.test(expires) ? Number(expires) : NaN;
  const now = Date.now();
  if (cacheable && /immutable/i.test(policy)) {
    headers.set("cache-control", policy);
  } else if (cacheable && Number.isSafeInteger(expiry) && expiry <= now + 300_000) {
    const seconds = Math.floor((expiry - now) / 1000);
    headers.set("cache-control", seconds > 0 ? `public, max-age=${seconds}, stale-if-error=0` : "private, no-store");
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
  if (response.ok && matches && /immutable/i.test(policy)) {
    void response.body?.cancel();
    headers.delete("content-length");
    return new Response(null, { status: 304, headers });
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

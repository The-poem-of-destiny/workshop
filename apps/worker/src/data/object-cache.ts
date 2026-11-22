export function fetchImmutableObject(
  context: { exports?: Cloudflare.Exports },
  target: { r2Key: string; sha256: string; identity: string },
): Promise<Response> {
  if (!context.exports) throw new Error("Worker loopback exports are unavailable");
  const path = `/objects/v1/${encodeURIComponent(target.identity)}/${target.sha256}`;
  return context.exports
    .CachedReads({ props: { kind: "object", ...target } })
    .fetch(`https://cached.workshop.invalid${path}`);
}

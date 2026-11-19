import { canonicalPublicRequest } from "./cache/public-cache";
import type { ProjectPreviewTarget } from "./data/contracts";

type LoopbackContext = { exports?: Cloudflare.Exports };

function loopback(context: LoopbackContext): Cloudflare.Exports {
  if (!context.exports) throw new Error("Worker loopback exports are unavailable");
  return context.exports;
}

export function dataClient(context: LoopbackContext) {
  return loopback(context).DataService;
}

export function fetchPublic(context: LoopbackContext, request: Request): Promise<Response> {
  const canonical = canonicalPublicRequest(request);
  if (canonical.kind !== "public") {
    return Promise.resolve(
      Response.json(
        { error: { code: "bad_request", message: "Invalid public query" } },
        {
          status: 400,
          headers: { "cache-control": "private, no-store" },
        },
      ),
    );
  }
  const url = new URL(canonical.request.url);
  url.pathname = `/public/v1${url.pathname}`;
  return loopback(context)
    .CachedReads({ props: { kind: "public" } })
    .fetch(new Request(url, { method: canonical.request.method }));
}

export function fetchProjectPreview(context: LoopbackContext, target: ProjectPreviewTarget): Promise<Response> {
  if (!target.r2Key || !target.sha256) {
    return Promise.resolve(
      Response.json(
        { error: { code: "not_found", message: "Project preview not found" } },
        {
          status: 404,
          headers: { "cache-control": "private, no-store" },
        },
      ),
    );
  }
  const path = `/preview/v1/${encodeURIComponent(target.projectId)}/${encodeURIComponent(target.versionId)}/${target.kind}/${target.sha256}`;
  return loopback(context)
    .CachedReads({ props: { kind: "preview", target } })
    .fetch(`https://cached.workshop.invalid${path}`);
}

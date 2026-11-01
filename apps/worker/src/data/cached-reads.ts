import { WorkerEntrypoint } from "cloudflare:workers";
import { projectPreviewSchema } from "@workshop/contracts";
import { cacheTtl, publicCacheClass } from "../http/cache-policy";
import { canonicalPublicRequest } from "../http/public-cache";
import { loadProjectPreview } from "../storage/content-index";
import type { ProjectPreviewTarget } from "./contracts";
import type { DataEnv } from "./env";
import { publicProjection } from "./public-projections";

export type ReadProps =
  | { kind: "public" }
  | { kind: "preview"; target: ProjectPreviewTarget }
  | { kind: "object"; r2Key: string; sha256: string; identity: string };

function noStore(status: number, message: string): Response {
  return Response.json(
    { error: { code: status === 400 ? "bad_request" : "not_found", message } },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

function eligible(response: Response): boolean {
  return (
    response.status === 200 &&
    !response.headers.has("set-cookie") &&
    !/(?:^|,)\s*\*\s*(?:,|$)/.test(response.headers.get("vary") ?? "") &&
    !/\b(?:no-store|private)\b/i.test(response.headers.get("cache-control") ?? "")
  );
}

function withoutBody(response: Response): Response {
  void response.body?.cancel();
  return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function validateRead(url: URL, props: ReadProps): Response | null {
  const path = url.pathname;
  if (!props || typeof props !== "object" || !["public", "preview", "object"].includes(props.kind)) {
    return noStore(400, "Invalid read properties");
  }
  if (props.kind === "public") {
    if (!path.startsWith("/public/v1/")) return noStore(404, "Not found");
    const outer = new URL(url);
    outer.pathname = path.slice("/public/v1".length);
    const canonical = canonicalPublicRequest(new Request(outer));
    if (
      canonical.kind !== "public" ||
      new URL(canonical.request.url).pathname !== outer.pathname ||
      new URL(canonical.request.url).search !== outer.search
    ) {
      return noStore(400, "Invalid public query");
    }
  } else if (props.kind === "preview") {
    const target = props.target;
    if (
      !target ||
      typeof target.projectId !== "string" ||
      !target.projectId ||
      typeof target.revisionId !== "string" ||
      !target.revisionId ||
      typeof target.r2Key !== "string" ||
      !target.r2Key ||
      typeof target.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(target.sha256) ||
      !Number.isSafeInteger(target.entryCount) ||
      target.entryCount < 0 ||
      (target.kind !== "worldbook" && target.kind !== "regex") ||
      path !==
        `/preview/v1/${encodeURIComponent(target.projectId)}/${encodeURIComponent(target.revisionId)}/${target.kind}/${target.sha256}`
    ) {
      return noStore(400, "Invalid read properties");
    }
  } else if (props.kind === "object") {
    if (
      typeof props.r2Key !== "string" ||
      !props.r2Key ||
      typeof props.identity !== "string" ||
      !props.identity ||
      typeof props.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(props.sha256) ||
      path !== `/objects/v1/${encodeURIComponent(props.identity)}/${props.sha256}`
    ) {
      return noStore(400, "Invalid read properties");
    }
  } else return noStore(400, "Invalid read properties");
  return null;
}

async function readSource(url: URL, props: ReadProps, env: DataEnv): Promise<Response> {
  if (props.kind === "public") {
    return publicProjection(new Request(url, { method: "GET" }), env);
  }
  if (props.kind === "preview") {
    const preview = await loadProjectPreview(env.R2, props.target);
    return preview ? Response.json(projectPreviewSchema.parse(preview)) : noStore(404, "Project preview not found");
  }
  const object = await env.R2.get(props.r2Key);
  return object
    ? new Response(object.body, {
        headers: {
          "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
          "content-length": String(object.size),
        },
      })
    : noStore(404, "Object not found");
}

export class CachedReads extends WorkerEntrypoint<DataEnv, ReadProps> {
  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { "cache-control": "private, no-store", allow: "GET, HEAD" } });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    const props = this.ctx.props;
    const invalid = validateRead(url, props);
    if (invalid) return request.method === "HEAD" ? withoutBody(invalid) : invalid;

    const category = props.kind === "public" ? publicCacheClass(path.slice("/public/v1".length)) : "internal";
    const ttl = cacheTtl(this.env, category);
    const version = this.env.VERSION_METADATA?.id;
    let key: Request | undefined;
    if (ttl > 0 && typeof version === "string" && version.trim().length > 0) {
      const bytes = new TextEncoder().encode(JSON.stringify([version, ttl, url.pathname, url.search, props]));
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      const digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
      key = new Request(`https://cache.workshop.invalid/v1/${digest}`);
      try {
        const hit = await caches.default.match(key);
        if (hit) {
          const expiry = Number(hit.headers.get("x-workshop-generated-expires"));
          if (eligible(hit) && Number.isSafeInteger(expiry) && expiry > Date.now()) {
            return request.method === "HEAD" ? withoutBody(hit) : hit;
          }
          void hit.body?.cancel();
        }
      } catch {
        // Cache API is optional; source reads remain authoritative on failure.
      }
    }

    let response = await readSource(url, props, this.env);
    const headers = new Headers(response.headers);
    headers.delete("cdn-cache-control");
    headers.delete("cloudflare-cdn-cache-control");
    if (ttl > 0 && eligible(response)) {
      const expiry = Date.now() + ttl * 1000;
      headers.set("x-workshop-generated-expires", String(expiry));
      headers.set(
        "cache-control",
        `public, max-age=${ttl}${category === "immutable" || category === "internal" ? ", immutable" : ", stale-if-error=0"}`,
      );
    } else {
      headers.delete("x-workshop-generated-expires");
      headers.set("cache-control", "private, no-store");
    }
    response = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    if (key && ttl > 0 && eligible(response)) {
      if (request.method === "HEAD") {
        const result = new Response(null, { status: response.status, statusText: response.statusText, headers });
        try {
          this.ctx.waitUntil(caches.default.put(key, response).catch(() => {}));
        } catch {
          void response.body?.cancel();
        }
        return result;
      }
      try {
        this.ctx.waitUntil(caches.default.put(key, response.clone()).catch(() => {}));
      } catch {
        // A failed cache write must not affect the source response.
      }
    }
    return request.method === "HEAD" ? withoutBody(response) : response;
  }
}

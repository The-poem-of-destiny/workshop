import { cache, WorkerEntrypoint } from "cloudflare:workers";
import { projectPreviewSchema } from "@workshop/contracts";
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
    {
      status,
      headers: { "cache-control": "private, no-store" },
    },
  );
}

export class CachedReads extends WorkerEntrypoint<DataEnv, ReadProps> {
  async invalidatePublic(pathPrefixes: string[]): Promise<void> {
    try {
      const result = await cache.purge({ pathPrefixes: pathPrefixes.map((path) => `/public/v1${path}`) });
      if (!result.success) console.error("Internal public cache purge rejected", result.errors);
    } catch (error) {
      console.error("Internal public cache purge failed", error);
    }
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { "cache-control": "private, no-store", allow: "GET, HEAD" } });
    }
    const path = new URL(request.url).pathname;
    const props = this.ctx.props;
    if (!props || typeof props !== "object" || !["public", "preview", "object"].includes(props.kind)) {
      return noStore(400, "Invalid read properties");
    }
    if (props.kind === "public" && path.startsWith("/public/v1/")) {
      const response = await publicProjection(request, this.env);
      const headers = new Headers(response.headers);
      const policy = headers.get("cache-control") ?? "";
      if (response.ok && !headers.has("set-cookie") && !/no-store|private/i.test(policy)) {
        if (!/immutable/i.test(policy)) {
          const expiresAt = Date.now() + 300_000;
          headers.set("x-workshop-generated-expires", String(expiresAt));
          headers.set("cache-control", "public, max-age=300, stale-if-error=0");
        }
      } else {
        headers.set("cache-control", "private, no-store");
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    if (props.kind === "preview" && path.startsWith("/preview/v1/")) {
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
        (target.kind !== "worldbook" && target.kind !== "regex")
      )
        return noStore(400, "Invalid read properties");
      const expected = `/preview/v1/${encodeURIComponent(target.projectId)}/${encodeURIComponent(target.revisionId)}/${target.kind}/${target.sha256}`;
      if (path !== expected) return noStore(400, "Invalid read properties");
      const preview = await loadProjectPreview(this.env.R2, target);
      if (!preview) return noStore(404, "Project preview not found");
      return Response.json(projectPreviewSchema.parse(preview), {
        headers: { "cache-control": "public, max-age=86400, immutable" },
      });
    }
    if (props.kind === "object" && path.startsWith("/objects/v1/")) {
      if (
        typeof props.r2Key !== "string" ||
        !props.r2Key ||
        typeof props.identity !== "string" ||
        !props.identity ||
        typeof props.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(props.sha256) ||
        path !== `/objects/v1/${encodeURIComponent(props.identity)}/${props.sha256}`
      )
        return noStore(400, "Invalid read properties");
      const object = await this.env.R2.get(props.r2Key);
      if (!object) return noStore(404, "Object not found");
      return new Response(object.body, {
        headers: {
          "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
          "content-length": String(object.size),
          "cache-control": "public, max-age=86400, immutable",
        },
      });
    }
    return noStore(404, "Not found");
  }
}

import { homeResponseSchema, projectBatchQuerySchema, projectListQuerySchema } from "@workshop/contracts";
import { getHome } from "../storage/home";
import { getPublishedProjectsByIds } from "../storage/projects";
import { distributionImage } from "./distribution-images";
import * as distribution from "./distribution-operations";
import { distributionClientAsset } from "./distribution-streams";
import type { DataEnv } from "./env";
import * as projects from "./project-operations";

const noStore = { "cache-control": "private, no-store" };

function error(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: noStore });
}

async function projectBatch(url: URL, env: DataEnv): Promise<Response> {
  if ([...url.searchParams.keys()].some((name) => name !== "ids") || url.searchParams.getAll("ids").length !== 1) {
    return error(400, "bad_request", "Invalid query");
  }
  const parsed = projectBatchQuerySchema.safeParse({ ids: url.searchParams.get("ids") });
  if (!parsed.success) return error(400, "bad_request", "Invalid query");
  const found = await getPublishedProjectsByIds(env.DB, parsed.data.ids);
  const items = parsed.data.ids.flatMap((id) => {
    const project = found.get(id);
    return project ? [project] : [];
  });
  return Response.json({ items, missingIds: parsed.data.ids.filter((id) => !found.has(id)) });
}

async function projectionDetail(path: string, env: DataEnv): Promise<Response> {
  const reference = /^\/api\/v1\/reference-sets\/([^/]+)$/.exec(path);
  const project = /^\/api\/v1\/projects\/([^/]+)(\/entries)?$/.exec(path);
  try {
    if (reference) {
      const data = await distribution.distributionReference(env, decodeURIComponent(reference[1]!));
      return data ? Response.json(data) : error(404, "not_found", "Reference set not found");
    }
    if (project) {
      const id = decodeURIComponent(project[1]!);
      const data = project[2] ? await projects.projectEntries(env, id) : await projects.projectDetail(env, id);
      return data ? Response.json(data) : error(404, "not_found", "Project not found");
    }
  } catch (cause) {
    if (cause instanceof URIError) return error(400, "bad_request", "Invalid path");
    throw cause;
  }
  return error(404, "not_found", "Not found");
}

export async function publicProjection(request: Request, env: DataEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice("/public/v1".length);
  if (!path.startsWith("/api/v1/") && !path.startsWith("/client/")) return error(404, "not_found", "Not found");
  if (path.startsWith("/api/v1/public-assets/")) {
    const outer = new URL(request.url);
    outer.pathname = path;
    return distributionImage(new Request(outer, { method: request.method }), env);
  }
  if (path.startsWith("/client/checker/") || /^\/client\/v\/[a-f0-9]{8,64}\/index\.js$/.test(path)) {
    const outer = new URL(request.url);
    outer.pathname = path;
    return distributionClientAsset(new Request(outer, { method: request.method }), env);
  }
  if (path === "/api/v1/home") {
    const home = homeResponseSchema.parse(await getHome(env.DB));
    const segments = [home.site, home.discovery, home.projects];
    if (segments.every((segment) => !segment.ok)) return error(500, "internal", "Home unavailable");
    return Response.json(home, segments.every((segment) => segment.ok) ? undefined : { headers: noStore });
  }
  if (path === "/api/v1/site") return Response.json(await distribution.distributionSite(env));
  if (path === "/api/v1/recommendations") return Response.json(await distribution.distributionRecommendations(env));
  if (path === "/api/v1/reference-sets") return Response.json(await distribution.distributionReferences(env));
  if (path === "/api/v1/projects/discovery") return Response.json(await projects.projectDiscovery(env));
  if (path === "/api/v1/projects/rankings") {
    const kind = url.searchParams.get("kind") ?? "7d";
    if (kind !== "daily" && kind !== "7d" && kind !== "30d") return error(400, "bad_request", "Unknown ranking kind");
    return Response.json(await projects.projectRankings(env, kind));
  }
  if (path === "/api/v1/projects/batch") return projectBatch(url, env);
  if (path === "/api/v1/projects") {
    const parsed = projectListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return error(400, "bad_request", "Invalid query");
    const result = await projects.projectList(env, parsed.data);
    return result.ok ? Response.json(result.data) : error(400, "bad_request", "Invalid cursor");
  }
  return projectionDetail(path, env);
}

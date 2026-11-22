import { homeResponseSchema } from "@workshop/contracts";
import type { PublicRead } from "../cache/public-cache";
import { isStorageQuotaError, quotaErrorDetail, quotaExceededMessage } from "../quota-error";
import { getPublicAuthorProfile, getPublicCollection } from "../storage/collections";
import { getHome } from "../storage/home";
import { getPublishedProjectsByIds } from "../storage/projects";
import { readPublicImage } from "./distribution-images";
import * as distribution from "./distribution-operations";
import { readClientAsset } from "./distribution-streams";
import type { DataEnv } from "./env";
import * as projects from "./project-operations";

const noStore = { "cache-control": "private, no-store" };

function error(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status, headers: noStore },
  );
}

async function projectBatch(ids: string[], env: DataEnv): Promise<Response> {
  const found = await getPublishedProjectsByIds(env.DB, ids, env.PUBLIC_ASSETS_BASE_URL);
  const items = ids.flatMap((id) => {
    const project = found.get(id);
    return project ? [project] : [];
  });
  return Response.json({ items, missingIds: ids.filter((id) => !found.has(id)) });
}

export async function publicProjection(operation: PublicRead["operation"], env: DataEnv): Promise<Response> {
  try {
    switch (operation.kind) {
      case "image":
        return await readPublicImage(operation.key, env);
      case "client-asset":
        return await readClientAsset(operation.asset, env);
      case "home": {
        const home = homeResponseSchema.parse(
          await getHome(env.DB, env, (reason) =>
            isStorageQuotaError(reason)
              ? { code: "quota_exceeded", message: quotaExceededMessage(), details: quotaErrorDetail(reason) }
              : null,
          ),
        );
        const segments = [home.site, home.discovery, home.projects];
        if (segments.every((segment) => !segment.ok)) {
          const quotaSeg = segments.find((segment) => !segment.ok && segment.error.code === "quota_exceeded");
          if (quotaSeg && !quotaSeg.ok) {
            return error(503, "quota_exceeded", quotaExceededMessage(), quotaSeg.error.details);
          }
          return error(500, "internal", "Home unavailable");
        }
        return Response.json(home, segments.every((segment) => segment.ok) ? undefined : { headers: noStore });
      }
      case "site":
        return Response.json(await distribution.distributionSite(env));
      case "recommendations":
        return Response.json(await distribution.distributionRecommendations(env));
      case "project-batch":
        return await projectBatch(operation.ids, env);
      case "project-list": {
        const result = await projects.projectList(env, operation.query);
        return result.ok ? Response.json(result.data) : error(400, "bad_request", "Invalid cursor");
      }
      case "project-detail":
      case "project-entries":
      case "collection":
      case "author": {
        try {
          const id = decodeURIComponent(operation.encodedId);
          if (operation.kind === "collection") {
            const collection = await getPublicCollection(env.DB, id);
            return collection ? Response.json(collection) : error(404, "not_found", "Collection not found");
          }
          if (operation.kind === "author") {
            const profile = await getPublicAuthorProfile(env.DB, id);
            return profile ? Response.json(profile) : error(404, "not_found", "Author not found");
          }
          const project =
            operation.kind === "project-entries"
              ? await projects.projectEntries(env, id)
              : await projects.projectDetail(env, id);
          return project ? Response.json(project) : error(404, "not_found", "Project not found");
        } catch (cause) {
          if (cause instanceof URIError) return error(400, "bad_request", "Invalid path");
          throw cause;
        }
      }
    }
  } catch (cause) {
    if (isStorageQuotaError(cause)) {
      return error(503, "quota_exceeded", quotaExceededMessage(), quotaErrorDetail(cause));
    }
    throw cause;
  }
}

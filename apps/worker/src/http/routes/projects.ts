import { projectPreviewKindSchema, projectPreviewSchema } from "@workshop/contracts";
import { Hono } from "hono";
import { dataClient, fetchProjectPreview } from "../../data-client.js";
import type { Env } from "../../env";
import { jsonError } from "../errors.js";
import { sessionToken } from "../session.js";

export const projectsRoutes = new Hono<{ Bindings: Env }>();

projectsRoutes.post("/:id/downloads", async (c) => {
  const result = await dataClient(c.executionCtx).projectDownloads(
    sessionToken(c),
    c.req.param("id"),
    c.req.header("Idempotency-Key") ?? "",
  );
  if (!result.ok) {
    if (result.error === "bad_request") return jsonError(c, "bad_request", "Idempotency-Key must be a UUID v4");
    else if (result.error === "rate_limited") return jsonError(c, "rate_limited", "Daily acquisition limit reached");
    if (result.error === "conflict")
      return jsonError(c, "conflict", "Original release unavailable; refresh and start a new acquisition");
    if (result.error === "unauthorized") return jsonError(c, "unauthorized", "Login required");
    if (result.error === "forbidden") return jsonError(c, "forbidden", "请先阅读并同意工坊使用政策并完成准入问答");
    return jsonError(c, "not_found", "Release not found");
  }
  return c.json(result.data, 201);
});

projectsRoutes.get("/:id/preview/:kind", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const kind = projectPreviewKindSchema.safeParse(c.req.param("kind"));
  // Authentication takes precedence over kind validation, as in the original route.
  const result = await dataClient(c.executionCtx).projectPreviewTarget(
    sessionToken(c),
    c.req.param("id"),
    kind.success ? kind.data : null,
  );
  if (!result.ok && result.error === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (!result.ok && result.error === "forbidden")
    return jsonError(c, "forbidden", "请先阅读并同意工坊使用政策并完成准入问答");
  if (!kind.success) return jsonError(c, "bad_request", "Unknown preview kind");
  if (!result.ok) return jsonError(c, "not_found", "Project preview not found");
  if (!result.target.r2Key)
    return c.json(
      projectPreviewSchema.parse({ versionId: result.target.versionId, kind: result.target.kind, entries: [] }),
    );
  const response = await fetchProjectPreview(c.executionCtx, result.target);
  if (response.status === 404) return jsonError(c, "not_found", "Project preview not found");
  if (!response.ok) return jsonError(c, "internal", "Project preview unavailable");
  return c.json(projectPreviewSchema.parse(await response.json()));
});

projectsRoutes.post("/:id/acquisitions", async (c) => {
  const result = await dataClient(c.executionCtx).projectAcquisition(
    sessionToken(c),
    c.req.param("id"),
    c.req.header("x-client-version")?.trim(),
    c.req.header("x-client-channel")?.trim(),
    c.req.header("Idempotency-Key") ?? "",
  );
  if (!result.ok) {
    if (result.error === "bad_request") return jsonError(c, "bad_request", "Idempotency-Key must be a UUID v4");
    if (result.error === "rate_limited") return jsonError(c, "rate_limited", "Daily acquisition limit reached");
    if (result.error === "conflict")
      return jsonError(c, "conflict", "Original release unavailable; refresh and start a new acquisition");
    if (result.error === "unauthorized") return jsonError(c, "unauthorized", "Login required");
    if (result.error === "forbidden") return jsonError(c, "forbidden", "请先阅读并同意工坊使用政策并完成准入问答");
    if (result.error === "upgrade_required") return jsonError(c, "upgrade_required", result.message, result.details);
    return jsonError(c, "not_found", "Release not found");
  }
  return c.json(result.data, 201);
});

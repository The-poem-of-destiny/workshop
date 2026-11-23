import {
  authorCollectionListResponseSchema,
  authorProjectListResponseSchema,
  authorSubmissionListResponseSchema,
  experienceNoteInputSchema,
  experienceNotesResponseSchema,
  meResponseSchema,
  meStateResponseSchema,
  policyAcceptanceInputSchema,
  policyAcceptanceResponseSchema,
} from "@workshop/contracts";
import { Hono } from "hono";
import { dataClient } from "../../data-client.js";
import type { Env } from "../../env";
import { jsonError } from "../errors.js";
import { sessionToken } from "../session.js";

const POLICY_REQUIRED_MESSAGE = "请先阅读并同意工坊使用政策并完成准入问答";

export const meRoutes = new Hono<{ Bindings: Env }>();

meRoutes.get("/", async (c) => {
  const result = await dataClient(c.executionCtx).identityMe(sessionToken(c), { kind: "me" });
  if (!result.ok) return jsonError(c, "unauthorized", "Login required");
  return c.json(meResponseSchema.parse(result.data));
});

meRoutes.post("/policy-acceptance", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "bad_request", "请求内容不是有效的 JSON");
  }
  const parsed = policyAcceptanceInputSchema.safeParse(body);
  if (!parsed.success) return jsonError(c, "bad_request", "请先勾选同意政策并完成全部题目", parsed.error.flatten());
  const result = await dataClient(c.executionCtx).identityMe(sessionToken(c), {
    kind: "accept_policy",
    input: parsed.data,
  });
  if (!result.ok) {
    if (result.error === "unauthorized") return jsonError(c, "unauthorized", "Login required");
    if (result.error === "version_mismatch")
      return jsonError(c, "bad_request", "使用政策版本已更新，请刷新页面后重新阅读同意");
    if (result.error === "quiz_failed") {
      return jsonError(c, "bad_request", "部分题目回答不正确，请核对使用说明后重试", {
        incorrectQuestionIds: result.incorrectQuestionIds,
      });
    }
    return jsonError(c, "forbidden", POLICY_REQUIRED_MESSAGE);
  }
  return c.json(policyAcceptanceResponseSchema.parse(result.data));
});

meRoutes.get("/collections", async (c) => {
  const result = await dataClient(c.executionCtx).authorListCollections(sessionToken(c));
  if (result.kind === "unauthorized") return jsonError(c, "unauthorized", "Login required");
  if (result.kind === "forbidden") return jsonError(c, "forbidden", POLICY_REQUIRED_MESSAGE);
  return c.json(authorCollectionListResponseSchema.parse(result.data));
});

meRoutes.get("/projects", async (c) => {
  const result = await dataClient(c.executionCtx).identityMe(sessionToken(c), { kind: "projects" });
  if (!result.ok)
    return result.error === "policy_required"
      ? jsonError(c, "forbidden", POLICY_REQUIRED_MESSAGE)
      : jsonError(c, "unauthorized", "Login required");
  return c.json(authorProjectListResponseSchema.parse(result.data));
});

meRoutes.get("/projects/:id/submissions", async (c) => {
  const result = await dataClient(c.executionCtx).identityMe(sessionToken(c), {
    kind: "submissions",
    projectId: c.req.param("id"),
  });
  if (!result.ok) {
    if (result.error === "unauthorized") return jsonError(c, "unauthorized", "Login required");
    if (result.error === "policy_required") return jsonError(c, "forbidden", POLICY_REQUIRED_MESSAGE);
    return jsonError(c, "not_found", "Project not found");
  }
  return c.json(authorSubmissionListResponseSchema.parse(result.data));
});

meRoutes.get("/subscriptions", async (c) => {
  const result = await dataClient(c.executionCtx).identityMe(sessionToken(c), { kind: "subscriptions" });
  if (!result.ok)
    return result.error === "policy_required"
      ? jsonError(c, "forbidden", POLICY_REQUIRED_MESSAGE)
      : jsonError(c, "unauthorized", "Login required");
  return c.json(result.data);
});

meRoutes.get("/state", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const result = await dataClient(c.executionCtx).identityMe(sessionToken(c), { kind: "state", ids });
  if (!result.ok) {
    if (result.error === "too_many_ids") return jsonError(c, "bad_request", "At most 50 project IDs are allowed");
    if (result.error === "policy_required") return jsonError(c, "forbidden", POLICY_REQUIRED_MESSAGE);
    return jsonError(c, "unauthorized", "Login required");
  }
  return c.json(meStateResponseSchema.parse(result.data));
});

for (const [path, kind] of [
  ["likes", "like"],
  ["subscriptions", "subscription"],
] as const) {
  for (const [method, enabled] of [
    ["put", true],
    ["delete", false],
  ] as const) {
    meRoutes[method](`/${path}/:id`, async (c) => {
      const result = await dataClient(c.executionCtx).identityMe(sessionToken(c), {
        kind,
        projectId: c.req.param("id"),
        enabled,
      });
      if (!result.ok) {
        if (result.error === "unauthorized") return jsonError(c, "unauthorized", "Login required");
        if (result.error === "policy_required") return jsonError(c, "forbidden", POLICY_REQUIRED_MESSAGE);
        return jsonError(c, "not_found", "Project not found");
      }
      return c.body(null, 204);
    });
  }
}

meRoutes.get("/experience-notes/:id", async (c) => {
  const result = await dataClient(c.executionCtx).identityMe(sessionToken(c), {
    kind: "experience_notes",
    projectId: c.req.param("id"),
  });
  if (!result.ok) {
    if (result.error === "unauthorized") return jsonError(c, "unauthorized", "Login required");
    if (result.error === "policy_required") return jsonError(c, "forbidden", POLICY_REQUIRED_MESSAGE);
    return jsonError(c, "not_found", "Project not found");
  }
  return c.json(experienceNotesResponseSchema.parse(result.data));
});

meRoutes.put("/experience-notes/:id/versions/:versionId", async (c) => {
  let body: unknown;
  let invalidJson = false;
  try {
    body = await c.req.json();
  } catch {
    invalidJson = true;
  }
  const parsed = experienceNoteInputSchema.safeParse(body);
  const result = await dataClient(c.executionCtx).identityMe(sessionToken(c), {
    kind: "experience_note",
    projectId: c.req.param("id"),
    projectVersionId: c.req.param("versionId"),
    input: invalidJson ? "invalid_json" : parsed.success ? parsed.data : "invalid_note",
  });
  if (!result.ok) {
    if (result.error === "unauthorized") return jsonError(c, "unauthorized", "Login required");
    if (result.error === "policy_required") return jsonError(c, "forbidden", POLICY_REQUIRED_MESSAGE);
    if (result.error === "invalid_json") return jsonError(c, "bad_request", "Invalid JSON body");
    if (result.error === "invalid_note" && !parsed.success)
      return jsonError(c, "bad_request", "Invalid experience note", parsed.error.flatten());
    return jsonError(c, "not_found", "Project version not found");
  }
  return c.body(null, 204);
});

meRoutes.delete("/experience-notes/:id/versions/:versionId", async (c) => {
  const result = await dataClient(c.executionCtx).identityMe(sessionToken(c), {
    kind: "experience_note",
    projectId: c.req.param("id"),
    projectVersionId: c.req.param("versionId"),
    input: null,
  });
  if (!result.ok) {
    if (result.error === "unauthorized") return jsonError(c, "unauthorized", "Login required");
    if (result.error === "policy_required") return jsonError(c, "forbidden", POLICY_REQUIRED_MESSAGE);
    return jsonError(c, "not_found", "Project version not found");
  }
  return c.body(null, 204);
});

meRoutes.delete("/experience-notes/:id/unversioned", async (c) => {
  const result = await dataClient(c.executionCtx).identityMe(sessionToken(c), {
    kind: "delete_unversioned_note",
    projectId: c.req.param("id"),
  });
  if (!result.ok) {
    if (result.error === "unauthorized") return jsonError(c, "unauthorized", "Login required");
    if (result.error === "policy_required") return jsonError(c, "forbidden", POLICY_REQUIRED_MESSAGE);
    return jsonError(c, "not_found", "Retained note not found");
  }
  return c.body(null, 204);
});

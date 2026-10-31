import type { ProjectEntryIndex } from "@workshop/contracts";
import {
  extractProjectEntries,
  inspectProjectMetadata,
  type ProjectEntryKind,
  validateProjectContentText,
} from "@workshop/domain";
import { analyzeFiles, REVIEW_CHECKER_REVISION, routeGate } from "./content-checker";
import type { Env } from "./env";
import { validateContentStream } from "./streaming-content";

interface RunTarget {
  id: string;
  project_id: string;
  revision_id: string;
  base_published_revision_id: string | null;
  status: string;
  check_status: string;
  check_attempts: number;
  client_gate: string | null;
  review_checker_revision: string | null;
}

const MAX_ATTEMPTS = 3;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildEntryIndex(
  files: ReadonlyArray<{ kind: ProjectEntryKind; text: string | null }>,
): Promise<ProjectEntryIndex["entries"]> {
  const entries: ProjectEntryIndex["entries"] = [];
  for (const file of files) {
    if (file.text === null) throw new Error(`Content index asset is missing: ${file.kind}`);
    let raw: unknown;
    try {
      raw = JSON.parse(file.text);
    } catch {
      throw new Error(`Content index asset is not valid JSON: ${file.kind}`);
    }
    for (const ref of extractProjectEntries(raw, file.kind)) {
      const content =
        typeof ref.entry.content === "string"
          ? ref.entry.content
          : typeof ref.entry.replaceString === "string"
            ? ref.entry.replaceString
            : "";
      const name = [ref.entry.name, ref.entry.comment, ref.entry.scriptName].find(
        (value): value is string => typeof value === "string" && !!value.trim(),
      );
      entries.push({
        kind: file.kind,
        entryKey: ref.entryKey,
        name: name ?? ref.entryKey,
        contentHash: await sha256(content),
        contentLength: Array.from(content).length,
      });
    }
  }
  return entries;
}

async function baselineConflict(
  text: string,
  findConflict: (fingerprints: string[]) => Promise<string | null>,
): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const refs = extractProjectEntries(parsed, "worldbook");
  if (refs.length === 0) return null;
  const fingerprints = await Promise.all(
    refs.flatMap((ref) => {
      const entry = ref.entry;
      const name = String(entry.comment ?? entry.name ?? "")
        .replace(/\r\n/g, "\n")
        .trim();
      const content = String(entry.content ?? "")
        .replace(/\r\n/g, "\n")
        .trim();
      const names = name.startsWith("[WS] ") ? [name, name.slice(5)] : [name];
      return names.map((candidate) => sha256(JSON.stringify({ name: candidate, content })));
    }),
  );
  return findConflict(fingerprints);
}

export class ContentService implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
    const url = new URL(request.url);
    if (url.pathname === "/validate-stream" || url.pathname === "/normalize-worldbook") {
      const kind = url.searchParams.get("kind");
      if (
        (kind !== "worldbook" && kind !== "regex") ||
        !request.body ||
        (url.pathname === "/normalize-worldbook" && kind !== "worldbook")
      ) {
        return Response.json({ error: "bad_request" }, { status: 400 });
      }
      const result = await validateContentStream(request.body, kind, url.pathname === "/normalize-worldbook");
      return result instanceof Response ? result : Response.json(result);
    }
    let submissionId = "";
    let validateRevision = "";
    let validateProjectId = "";
    try {
      const body = (await request.json()) as {
        submissionId?: unknown;
        validateRevision?: unknown;
        projectId?: unknown;
      };
      if (typeof body.submissionId === "string") submissionId = body.submissionId;
      if (typeof body.validateRevision === "string") validateRevision = body.validateRevision;
      if (typeof body.projectId === "string") validateProjectId = body.projectId;
    } catch {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    if (validateRevision) {
      return this.validateRevision(validateRevision, validateProjectId);
    }
    if (!submissionId) return Response.json({ error: "bad_request" }, { status: 400 });
    return this.runSubmission(submissionId);
  }

  private async runSubmission(submissionId: string): Promise<Response> {
    const data = this.state.exports.DataService;
    const target = await data.contentGetTarget(submissionId);
    if (!target) return Response.json({ error: "not_found" }, { status: 404 });
    if (target.status === "approved" || target.status === "rejected" || target.status === "superseded") {
      return Response.json({ skipped: "resolved" });
    }
    if (target.check_attempts >= MAX_ATTEMPTS) {
      await data.contentNeedsHuman(submissionId, "检查超时次数已达上限，转人工审核。", null);
      return Response.json({ skipped: "attempts" });
    }
    if (target.check_status === "done" || target.check_status === "needs_human") {
      return Response.json({ skipped: target.check_status });
    }
    if (target.review_checker_revision && target.review_checker_revision !== REVIEW_CHECKER_REVISION) {
      await data.contentNeedsHuman(submissionId, "固定检查器版本不可用，转人工审核。", null);
      return Response.json({ skipped: "checker_revision_unavailable" });
    }

    if (!(await data.contentClaim(submissionId))) return Response.json({ skipped: "not_claimed" });

    try {
      return await this.checkSubmission(target, submissionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = target.check_attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await data.contentNeedsHuman(submissionId, message, null);
      } else {
        await data.contentRequeue(submissionId, message);
      }
      return Response.json({ ok: false, error: message, attempts }, { status: 500 });
    }
  }

  private async checkSubmission(target: RunTarget, submissionId: string): Promise<Response> {
    const data = this.state.exports.DataService;
    const startedAt = Date.now();
    const { files: inputFiles, metadata } = await data.contentLoadSubmission(target.revision_id);
    if (inputFiles.length === 0) throw new Error("冻结内容没有世界书或正则文件");
    const files = inputFiles.map((file) => {
      if (file.text === null) throw new Error(`冻结文件缺失：${file.kind}`);
      return { fileName: `${file.kind}.json`, type: file.kind, text: file.text };
    });
    const report = analyzeFiles(files);
    if (!metadata) throw new Error("冻结资料缺失");
    const metadataReport = inspectProjectMetadata({
      title: metadata.title,
      description: metadata.description,
      authorNote: metadata.author_note,
      precautions: metadata.precautions,
      versionLabel: metadata.version_label,
      tags: JSON.parse(metadata.tags),
      coverPositionX: metadata.cover_position_x,
      coverPositionY: metadata.cover_position_y,
      coverZoom: metadata.cover_zoom,
    });
    const contentRoute = routeGate(report);
    const route =
      contentRoute === "block" || metadataReport.gate === "block"
        ? "block"
        : contentRoute === "warn" || metadataReport.gate === "warn"
          ? "warn"
          : "pass";
    const storedReport = JSON.stringify({
      ...report,
      metadata: metadataReport,
      routeGate: route,
      reviewCheckerRevision: REVIEW_CHECKER_REVISION,
    });
    const reportHash = await sha256(storedReport);
    const checkedAt = new Date().toISOString();
    await data.contentRecordRun(submissionId, route, storedReport, reportHash, Date.now() - startedAt, checkedAt);

    if (route === "block") {
      await data.contentNeedsHuman(submissionId, "自动检查要求人工审核。", {
        report: storedReport,
        hash: reportHash,
        checkedAt,
      });
      return Response.json({ ok: true, routeGate: route, revision: REVIEW_CHECKER_REVISION });
    }
    if (target.status === "pending" || target.client_gate === "block" || target.client_gate === "missing") {
      await data.contentNeedsHuman(
        submissionId,
        target.status === "pending" ? "人工重检完成，等待审核决定。" : "客户端检查未通过或缺失，转人工审核。",
        {
          report: storedReport,
          hash: reportHash,
          checkedAt,
        },
      );
      return Response.json({ ok: true, routeGate: route, revision: REVIEW_CHECKER_REVISION, manual: true });
    }

    if (!(await data.contentAutoPublish(target, storedReport, reportHash, checkedAt))) {
      throw new Error("自动发布前置条件已变化");
    }
    return Response.json({ ok: true, routeGate: route, revision: REVIEW_CHECKER_REVISION, published: true });
  }

  private async validateRevision(validateRevision: string, validateProjectId: string): Promise<Response> {
    if (!validateProjectId) return Response.json({ error: "bad_request" }, { status: 400 });
    const data = this.state.exports.DataService;
    const files = await data.contentLoadRevision(validateRevision, validateProjectId);
    const presence: Record<ProjectEntryKind, boolean> = { worldbook: false, regex: false };
    const counts: Record<ProjectEntryKind, number> = { worldbook: 0, regex: 0 };
    const hashes: Partial<Record<ProjectEntryKind, string>> = {};
    let conflict: string | null = null;
    let error: string | null = null;
    for (const file of files) {
      const kind = file.kind;
      if (file.text === null) {
        error = "项目文件缺失，请重新上传";
        break;
      }
      const text = file.text;
      const result = validateProjectContentText(text, kind);
      if (!result.valid) {
        error = result.error;
        break;
      }
      presence[kind] = true;
      counts[kind] = result.entryCount;
      hashes[kind] = await sha256(text);
      if (kind === "worldbook") {
        conflict = await baselineConflict(text, (fingerprints) => data.contentBaselineConflict(fingerprints));
        if (conflict) break;
      }
    }
    const entries = error || conflict ? [] : await buildEntryIndex(files);
    return Response.json({ presence, counts, hashes, conflict, error, entries });
  }
}

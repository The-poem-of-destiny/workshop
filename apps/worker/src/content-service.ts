import { type ProjectEntryIndex, requirementsSchema } from "@workshop/contracts";
import {
  extractProjectEntries,
  inspectProjectMetadata,
  type ProjectEntryKind,
  validateProjectContentPresence,
  validateProjectContentText,
} from "@workshop/domain";
import { analyzeFiles, REVIEW_CHECKER_VERSION, routeGate } from "./content-checker";
import type { Env } from "./env";
import { validateContentStream } from "./streaming-content";
import { maintenanceUnavailable, withWriteBarrier } from "./write-barrier";

interface RunTarget {
  id: string;
  project_id: string;
  version_id: string;
  base_published_version_id: string | null;
  status: string;
  check_status: string;
  check_attempts: number;
  lease_token: string | null;
  lease_until: string | null;
  client_gate: string | null;
  checker_version: string | null;
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

export class ContentService implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
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
    let validateVersion = "";
    let validateProjectId = "";
    try {
      const body = (await request.json()) as {
        submissionId?: unknown;
        validateVersion?: unknown;
        projectId?: unknown;
      };
      if (typeof body.submissionId === "string") submissionId = body.submissionId;
      if (typeof body.validateVersion === "string") validateVersion = body.validateVersion;
      if (typeof body.projectId === "string") validateProjectId = body.projectId;
    } catch {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    if (validateVersion) {
      return this.validateVersion(validateVersion, validateProjectId);
    }
    if (!submissionId) return Response.json({ error: "bad_request" }, { status: 400 });
    try {
      const result = await withWriteBarrier(this.env, "content", () => this.runSubmission(submissionId));
      return result.admitted ? result.value : maintenanceUnavailable();
    } catch (error) {
      console.error("Maintenance barrier content work failed", error);
      return maintenanceUnavailable();
    }
  }

  private async runSubmission(submissionId: string): Promise<Response> {
    const data = this.state.exports.DataService;
    const target = await data.contentGetTarget(submissionId);
    if (!target) return Response.json({ error: "not_found" }, { status: 404 });
    if (target.status === "approved" || target.status === "rejected" || target.status === "superseded") {
      return Response.json({ skipped: "resolved" });
    }
    if (target.check_status === "running" && target.lease_until && Date.parse(target.lease_until) > Date.now()) {
      return Response.json({ skipped: "leased" });
    }
    if (target.check_attempts >= MAX_ATTEMPTS) {
      await data.contentNeedsHuman(submissionId, "检查超时次数已达上限，转人工审核。", target.lease_token);
      return Response.json({ skipped: "attempts" });
    }
    if (target.check_status === "done" || target.check_status === "needs_human") {
      return Response.json({ skipped: target.check_status });
    }
    if (target.checker_version && target.checker_version !== REVIEW_CHECKER_VERSION) {
      await data.contentNeedsHuman(submissionId, "固定检查器版本不可用，转人工审核。", target.lease_token);
      return Response.json({ skipped: "checker_version_unavailable" });
    }

    const leaseToken = await data.contentClaim(submissionId);
    if (!leaseToken) return Response.json({ skipped: "not_claimed" });

    try {
      return await this.checkSubmission(target, submissionId, leaseToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = target.check_attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await data.contentNeedsHuman(submissionId, message, leaseToken);
      } else {
        await data.contentRequeue(submissionId, message, leaseToken);
      }
      return Response.json({ ok: false, error: message, attempts }, { status: 500 });
    }
  }

  private async checkSubmission(target: RunTarget, submissionId: string, leaseToken: string): Promise<Response> {
    const data = this.state.exports.DataService;
    const startedAt = Date.now();
    const { files: inputFiles, metadata } = await data.contentLoadSubmission(target.version_id);
    if (inputFiles.length === 0) throw new Error("冻结内容没有世界书或正则文件");
    const files = inputFiles.map((file) => {
      if (file.text === null) throw new Error(`冻结文件缺失：${file.kind}`);
      const validation = validateProjectContentText(file.text, file.kind);
      if (!validation.valid) throw new Error(`冻结文件无效：${file.kind}：${validation.error}`);
      return { fileName: `${file.kind}.json`, type: file.kind, text: file.text };
    });
    const report = analyzeFiles(files);
    if (!metadata) throw new Error("冻结资料缺失");
    const metadataReport = inspectProjectMetadata({
      title: metadata.title,
      description: metadata.description,
      requirements: metadata.requirements === null ? null : requirementsSchema.parse(JSON.parse(metadata.requirements)),
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
      checkerVersion: REVIEW_CHECKER_VERSION,
    });
    const reportHash = await sha256(storedReport);
    const checkedAt = new Date().toISOString();
    if (
      !(await data.contentRecordRun(
        submissionId,
        leaseToken,
        route,
        storedReport,
        reportHash,
        Date.now() - startedAt,
        checkedAt,
      ))
    ) {
      return Response.json({ skipped: "lease_replaced" });
    }

    if (route === "block") {
      await data.contentNeedsHuman(submissionId, "自动检查要求人工审核。", leaseToken);
      return Response.json({ ok: true, routeGate: route, revision: REVIEW_CHECKER_VERSION });
    }
    if (target.status === "pending" || target.client_gate === "block" || target.client_gate === "missing") {
      await data.contentNeedsHuman(
        submissionId,
        target.status === "pending" ? "人工重检完成，等待审核决定。" : "客户端检查未通过或缺失，转人工审核。",
        leaseToken,
      );
      return Response.json({ ok: true, routeGate: route, revision: REVIEW_CHECKER_VERSION, manual: true });
    }

    if (!(await data.contentAutoPublish(target, leaseToken))) {
      throw new Error("自动发布前置条件已变化");
    }
    return Response.json({ ok: true, routeGate: route, revision: REVIEW_CHECKER_VERSION, published: true });
  }

  private async validateVersion(validateVersion: string, validateProjectId: string): Promise<Response> {
    if (!validateProjectId) return Response.json({ error: "bad_request" }, { status: 400 });
    const data = this.state.exports.DataService;
    const files = await data.contentLoadVersion(validateVersion, validateProjectId);
    const presence: Record<ProjectEntryKind, boolean> = { worldbook: false, regex: false };
    const counts: Record<ProjectEntryKind, number> = { worldbook: 0, regex: 0 };
    const hashes: Partial<Record<ProjectEntryKind, string>> = {};
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
    }
    if (!error) {
      const validation = validateProjectContentPresence(presence);
      if (!validation.valid) error = validation.error;
    }
    const entries = error ? [] : await buildEntryIndex(files);
    return Response.json({ presence, counts, hashes, error, entries });
  }
}

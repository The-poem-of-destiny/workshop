import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { DataEnv } from "../src/data/env";
import { getSubmissionDiff } from "../src/storage/diff";
import { parseCheckReport } from "../web/src/features/review/check-report";
import { buildReviewMarkdown } from "../web/src/features/review/export-markdown";
import { applySchema } from "./support/schema";

const bindings = env as unknown as DataEnv;

describe("review metadata evidence", () => {
  it("retains metadata-only reports and exports valid findings", () => {
    const report = parseCheckReport({
      metadata: {
        gate: "warn",
        findings: [
          { field: "tags", severity: "warn", message: "duplicate tags" },
          { field: "title", severity: "block", message: "invalid title" },
          { field: "ignored", severity: "unknown", message: "invalid finding" },
          null,
        ],
      },
    });
    expect(report?.metadata).toEqual({
      gate: "warn",
      findings: [
        { field: "tags", severity: "warn", message: "duplicate tags" },
        { field: "title", severity: "block", message: "invalid title" },
      ],
    });
    const detail = {
      submission: { id: "s", submittedAt: "now", checkStatus: "completed" },
      project: { id: "p", author: { name: "author" }, visibility: "private" },
      revision: { id: "r", revisionNo: 1, title: "title" },
      checkRuns: [],
    } as unknown as Parameters<typeof buildReviewMarkdown>[0]["detail"];
    const markdown = buildReviewMarkdown({ detail, report, diff: null, sources: [], reason: "" });
    expect(markdown).toContain("提示 · tags：duplicate tags");
    expect(markdown).toContain("阻断 · title：invalid title");
    expect(markdown).not.toContain("invalid finding");
  });

  it("handles reports without metadata and malformed metadata findings", () => {
    expect(parseCheckReport({ gate: "pass" })?.metadata).toBeNull();
    expect(parseCheckReport({ metadata: { gate: "pass", findings: "invalid" } })?.metadata).toEqual({
      gate: "pass",
      findings: [],
    });
  });
});

describe("submission metadata diff", () => {
  beforeAll(async () => {
    await applySchema(bindings.DB);
  });

  it("compares schema versions against the frozen published revision", async () => {
    await bindings.DB.prepare(
      "INSERT INTO users (id, username, role) VALUES ('diff-user', 'diff-user', 'member')",
    ).run();
    await bindings.DB.prepare(
      "INSERT INTO projects (id, author_id, title, visibility) VALUES ('diff-project', 'diff-user', 'project', 'private')",
    ).run();
    await bindings.DB.prepare(`INSERT INTO project_revisions
      (id, project_id, revision_no, title, schema_version, created_by) VALUES
      ('diff-old', 'diff-project', 1, 'project', '1.0', 'diff-user'),
      ('diff-new', 'diff-project', 2, 'project', '2.0', 'diff-user')`).run();
    await bindings.DB.prepare(`INSERT INTO submissions
      (id, project_id, revision_id, base_published_revision_id, status, submitted_by)
      VALUES ('diff-submission', 'diff-project', 'diff-new', 'diff-old', 'pending', 'diff-user')`).run();
    const diff = await getSubmissionDiff(bindings.DB, bindings.R2, "diff-submission");
    expect(diff?.metadata.before?.schema_version).toBe("1.0");
    expect(diff?.metadata.after.schema_version).toBe("2.0");
  });
});

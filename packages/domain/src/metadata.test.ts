import { describe, expect, it } from "vitest";
import { inspectProjectMetadata } from "./metadata.js";

describe("project metadata", () => {
  it("passes valid metadata", () => {
    expect(inspectProjectMetadata({
      title: "项目",
      description: "描述",
      tags: ["奇幻", "角色"],
      versionLabel: "v1",
      coverPositionX: 50,
      coverZoom: 1,
    })).toEqual({ gate: "pass", findings: [] });
  });

  it("blocks control characters and invalid cover presentation", () => {
    const result = inspectProjectMetadata({
      title: "bad\u0000title",
      coverPositionX: 120,
      coverZoom: 4,
    });
    expect(result.gate).toBe("block");
    expect(result.findings.map(item => item.field).sort()).toEqual(["coverPositionX", "coverZoom", "title"]);
  });

  it("warns on duplicate tags without blocking", () => {
    const result = inspectProjectMetadata({ title: "项目", tags: ["a", "a"] });
    expect(result.gate).toBe("warn");
    expect(result.findings[0]).toMatchObject({ field: "tags", severity: "warn" });
  });
});

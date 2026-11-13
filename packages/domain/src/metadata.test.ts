import { describe, expect, it } from "vitest";
import { inspectProjectMetadata } from "./metadata.js";

describe("project metadata", () => {
  it("passes valid metadata", () => {
    expect(
      inspectProjectMetadata({
        title: "项目",
        description: "描述",
        tags: ["奇幻", "角色"],
        versionLabel: "v1",
        coverPositionX: 50,
        coverZoom: 1,
      }),
    ).toEqual({ gate: "pass", findings: [] });
  });

  it("blocks control characters and invalid cover presentation", () => {
    const result = inspectProjectMetadata({
      title: "bad\u0000title",
      coverPositionX: 120,
      coverZoom: 4,
    });
    expect(result.gate).toBe("block");
    expect(result.findings.map((item) => item.field).sort()).toEqual(["coverPositionX", "coverZoom", "title"]);
  });

  it("blocks duplicate tags", () => {
    const result = inspectProjectMetadata({ title: "项目", tags: ["a", "a"] });
    expect(result.gate).toBe("block");
    expect(result.findings[0]).toMatchObject({ field: "tags", severity: "block" });
  });

  it("accepts twenty ordinary tags and blocks a twenty-first", () => {
    const tags = Array.from({ length: 20 }, (_, index) => `标签${index}`);
    expect(inspectProjectMetadata({ title: "项目", tags }).gate).toBe("pass");
    expect(inspectProjectMetadata({ title: "项目", tags: [...tags, "第21个"] }).gate).toBe("block");
  });

  it.each(["", " ", " tag", "tag "])("blocks a noncanonical ordinary tag (%j)", (tag) => {
    expect(inspectProjectMetadata({ title: "项目", tags: [tag] }).gate).toBe("block");
  });
});

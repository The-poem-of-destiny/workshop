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

  it.each([
    ["51 astral code points", "🧪".repeat(51)],
    ["100 astral code points", "🧪".repeat(100)],
    ["leading NUL", "\u0000x"],
    ["100 NUL code points", "\u0000".repeat(100)],
    ["U+0085 boundaries", "\u0085tag\u0085"],
  ])("accepts a canonical tag with %s", (_, tag) => {
    expect(inspectProjectMetadata({ title: "项目", tags: [tag] })).toEqual({ gate: "pass", findings: [] });
  });

  it.each([
    ["101 astral code points", "🧪".repeat(101)],
    ["102 code points across NUL", `a\u0000${"🧪".repeat(100)}`],
    ["101 NUL code points", "\u0000".repeat(101)],
  ])("blocks a tag with %s", (_, tag) => {
    const result = inspectProjectMetadata({ title: "项目", tags: [tag] });
    expect(result.gate).toBe("block");
    expect(result.findings).toEqual([{ field: "tags", severity: "block", message: "单个标签过长" }]);
  });

  it.each(["", " ", " tag", "tag ", "\ttag\t", "\uFEFFtag\uFEFF", "\u0000tag\t", "\t\u0000tag"])(
    "blocks a noncanonical ordinary tag (%j)",
    (tag) => {
      expect(inspectProjectMetadata({ title: "项目", tags: [tag] }).gate).toBe("block");
    },
  );
});

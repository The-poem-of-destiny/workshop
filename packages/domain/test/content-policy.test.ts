import { describe, expect, it } from "vitest";
import { normalizeProjectTaxonomyInput, validateProjectContentPolicy } from "../src/index.js";

describe("project content policy", () => {
  it("requires a worldbook for core projects", () => {
    const result = validateProjectContentPolicy(
      { projectType: "系统核心" },
      { worldbook: false, regex: true },
    );
    expect(result.valid).toBe(false);
  });

  it("accepts either entry kind for extensions", () => {
    const result = validateProjectContentPolicy(
      { projectType: "扩展" },
      { worldbook: false, regex: true },
    );
    expect(result).toEqual({ valid: true, baseTag: "扩展" });
  });

  it("normalizes tags into a project type", () => {
    expect(normalizeProjectTaxonomyInput({ tags: ["角色"] }).value?.projectType).toBe("角色");
  });
});

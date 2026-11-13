import { createProjectSchema, patchProjectSchema, projectListQuerySchema } from "@workshop/contracts";
import { PROJECT_TYPES } from "@workshop/domain";
import { describe, expect, it } from "vitest";
import { canonicalPublicRequest } from "../src/http/public-cache";

describe("shared taxonomy contracts", () => {
  it.each(PROJECT_TYPES)("requires exactly one primary and defaults optional metadata for %s", (projectType) => {
    expect(createProjectSchema.parse({ title: "项目", projectType })).toMatchObject({
      projectType,
      includedTypes: [],
      tags: [],
    });
  });

  it.each([undefined, null, "扩展", "系统", ["角色", "玩法"]].map((projectType) => ({ projectType })))(
    "rejects an absent or obsolete primary ($projectType)",
    ({ projectType }) => {
      expect(createProjectSchema.safeParse({ title: "项目", projectType }).success).toBe(false);
    },
  );

  it.each([
    { includedTypes: ["系统核心"] },
    { includedTypes: ["角色"] },
    { includedTypes: ["玩法", "玩法"] },
    { includedTypes: ["未知"] },
  ])("rejects invalid included categories ($includedTypes)", ({ includedTypes }) => {
    expect(createProjectSchema.safeParse({ title: "项目", projectType: "角色", includedTypes }).success).toBe(false);
  });

  it("preserves omission on patches and canonicalizes included categories", () => {
    expect(patchProjectSchema.parse({ title: "改名" })).toEqual({ title: "改名" });
    expect(
      createProjectSchema.parse({
        title: "核心",
        projectType: "系统核心",
        includedTypes: ["体验优化", "事件", "玩法", "内容扩展", "角色"],
      }).includedTypes,
    ).toEqual(["角色", "内容扩展", "玩法", "事件", "体验优化"]);
    expect(patchProjectSchema.safeParse({ projectType: "玩法", includedTypes: ["玩法"] }).success).toBe(false);
  });

  it("accepts twenty unique ordinary tags without reclassifying old shortcuts", () => {
    const tags = ["cbz", "hnh", "1011", ...Array.from({ length: 17 }, (_, index) => `自定义${index}`)];
    expect(createProjectSchema.parse({ title: "项目", projectType: "角色", tags }).tags).toEqual(tags);
    for (const invalid of [[...tags, "第21个"], ["a", " a "], [""], ["x".repeat(101)]]) {
      expect(createProjectSchema.safeParse({ title: "项目", projectType: "角色", tags: invalid }).success).toBe(false);
    }
  });

  it("deduplicates and canonically orders repeated catalogue dimensions", () => {
    expect(
      projectListQuerySchema.parse({
        projectType: ["事件", "角色", "角色", "系统核心"],
        tag: ["自定义B", "人类", "自定义A", "人类"],
      }),
    ).toMatchObject({
      projectType: ["系统核心", "角色", "事件"],
      includeContained: false,
      tag: ["人类", "自定义A", "自定义B"],
    });
    expect(projectListQuerySchema.parse({ projectType: [...PROJECT_TYPES, ...PROJECT_TYPES] }).projectType).toEqual(
      PROJECT_TYPES,
    );
    expect(projectListQuerySchema.parse({ includeContained: "true" }).includeContained).toBe(true);
    expect(projectListQuerySchema.safeParse({ includeContained: "1" }).success).toBe(false);
  });

  it("caps all unique selected tags together regardless of preset origin", () => {
    const tags = ["人类", "精灵/半精灵", "战斗", ...Array.from({ length: 9 }, (_, index) => `自定义${index}`)];
    expect(projectListQuerySchema.parse({ tag: [...tags, "人类", "自定义0"] }).tag).toHaveLength(12);
    expect(projectListQuerySchema.safeParse({ tag: [...tags, "第13个"] }).success).toBe(false);
  });
});

describe("catalogue cache identity", () => {
  it("shares equivalent repeated selections and isolates include-contained queries", () => {
    const first = canonicalPublicRequest(
      new Request(
        "https://one.test/api/v1/projects?projectType=事件&projectType=角色&tag=人类&tag=自定义&tag=人类&includeContained=false",
      ),
    );
    const equivalent = canonicalPublicRequest(
      new Request(
        "https://two.test/api/v1/projects?tag=自定义&tag=人类&projectType=角色&projectType=事件&projectType=角色",
      ),
    );
    const contained = canonicalPublicRequest(
      new Request(
        "https://one.test/api/v1/projects?projectType=角色&projectType=事件&tag=人类&tag=自定义&includeContained=true",
      ),
    );
    expect(first.kind).toBe("public");
    expect(equivalent.kind).toBe("public");
    expect(contained.kind).toBe("public");
    if (first.kind !== "public" || equivalent.kind !== "public" || contained.kind !== "public") {
      throw new Error("Expected canonical catalogue requests");
    }
    expect(first.request.url).toBe(equivalent.request.url);
    expect(first.request.url).not.toBe(contained.request.url);
  });

  it("does not admit duplicate scalar parameters or more than twelve unique tags", () => {
    expect(
      canonicalPublicRequest(
        new Request("https://workshop.test/api/v1/projects?includeContained=false&includeContained=true"),
      ).kind,
    ).toBe("invalid");
    const query = new URLSearchParams();
    for (let index = 0; index < 13; index += 1) query.append("tag", `tag${index}`);
    expect(canonicalPublicRequest(new Request(`https://workshop.test/api/v1/projects?${query}`)).kind).toBe("invalid");
  });
});

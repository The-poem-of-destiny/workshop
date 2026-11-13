import { describe, expect, it } from "vitest";
import {
  MAX_CUSTOM_TAGS,
  MAX_DISPLAY_TAGS,
  MAX_SELECTED_TAGS,
  orderedPresetTagGroups,
  PRESET_TAG_GROUPS,
  presetTagGroup,
  PROJECT_TYPES,
  validateProjectContentPresence,
} from "../src/index.js";

describe("project content presence", () => {
  it.each([
    { worldbook: true, regex: false },
    { worldbook: false, regex: true },
    { worldbook: true, regex: true },
  ])("accepts either valid nonempty file kind or both (%j)", (presence) => {
    expect(validateProjectContentPresence(presence)).toEqual({ valid: true });
  });

  it("rejects projects with no valid nonempty content", () => {
    expect(validateProjectContentPresence({ worldbook: false, regex: false }).valid).toBe(false);
  });
});

describe("project taxonomy vocabulary", () => {
  it("exposes six primaries and independent selection, authoring and display limits", () => {
    expect(PROJECT_TYPES).toEqual(["系统核心", "角色", "内容扩展", "玩法", "事件", "体验优化"]);
    expect([MAX_CUSTOM_TAGS, MAX_SELECTED_TAGS, MAX_DISPLAY_TAGS]).toEqual([20, 12, 4]);
  });

  it("maps only preset vocabulary to groups", () => {
    expect(presetTagGroup("人类")).toBe("种族");
    expect(presetTagGroup("精灵/半精灵")).toBe("种族");
    expect(presetTagGroup("合集")).toBe("组成形式");
    for (const tag of ["cbz", "hnh", "1011", "尺度", "toString", "__proto__", "自定义"]) {
      expect(presetTagGroup(tag)).toBeNull();
    }
    expect(new Set(PRESET_TAG_GROUPS.flatMap((group) => group.tags)).size)
      .toBe(PRESET_TAG_GROUPS.reduce((total, group) => total + group.tags.length, 0));
  });

  it("orders selected-category groups before common groups and retains every other group", () => {
    const groups = orderedPresetTagGroups(["角色", "玩法"]);
    expect(groups.slice(0, 5).map((group) => group.name)).toEqual(["种族", "身份", "个性", "外貌特征", "玩法方向"]);
    expect(groups.slice(5, 8).map((group) => group.name)).toEqual(["组织", "势力", "组成形式"]);
    expect(groups).toHaveLength(PRESET_TAG_GROUPS.length);
    expect(new Set(groups)).toEqual(new Set(PRESET_TAG_GROUPS));
    expect(orderedPresetTagGroups([]).slice(0, 3).map((group) => group.name)).toEqual(["组织", "势力", "组成形式"]);
  });
});

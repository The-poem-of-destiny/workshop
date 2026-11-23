import { describe, expect, it } from "vitest";
import {
  extractProjectEntries,
  markWorldbookNames,
  orderedPresetTagGroups,
  PRESET_TAG_GROUPS,
  presetTagGroup,
  validateProjectContent,
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
  it("maps only preset vocabulary to groups", () => {
    expect(presetTagGroup("人类")).toBe("种族");
    expect(presetTagGroup("精灵/半精灵")).toBe("种族");
    expect(presetTagGroup("合集")).toBe("组成形式");
    for (const tag of ["cbz", "hnh", "1011", "尺度", "toString", "__proto__", "自定义"]) {
      expect(presetTagGroup(tag)).toBeNull();
    }
    expect(new Set(PRESET_TAG_GROUPS.flatMap((group) => group.tags)).size).toBe(
      PRESET_TAG_GROUPS.reduce((total, group) => total + group.tags.length, 0),
    );
  });

  it("orders selected-category groups before common groups and retains every other group", () => {
    const groups = orderedPresetTagGroups(["角色", "规则扩展"]);
    expect(groups.slice(0, 5).map((group) => group.name)).toEqual(["种族", "身份", "个性", "外貌特征", "玩法方向"]);
    expect(groups.slice(5, 8).map((group) => group.name)).toEqual(["组织", "势力", "组成形式"]);
    expect(groups).toHaveLength(PRESET_TAG_GROUPS.length);
    expect(new Set(groups)).toEqual(new Set(PRESET_TAG_GROUPS));
    expect(
      orderedPresetTagGroups(["内容扩展"])
        .slice(0, 2)
        .map((group) => group.name),
    ).toEqual(["内容类型", "事件形式"]);
    expect(
      orderedPresetTagGroups([])
        .slice(0, 3)
        .map((group) => group.name),
    ).toEqual(["组织", "势力", "组成形式"]);
  });
});

describe("markWorldbookNames", () => {
  it("preserves SillyTavern comment titles when name is empty and avoids double-prefixing", () => {
    const raw = {
      entries: {
        "0": { uid: 0, name: "", comment: "角色设定", content: "正文" },
        "1": { uid: 1, name: "", comment: "关于 [工坊] 的说明", content: "正文" },
        "2": { uid: 2, name: "  [工坊] 已有前缀", comment: "旧备注", content: "正文" },
        "3": { uid: 3, name: "无备注条目", content: "正文" },
      },
    };
    markWorldbookNames(raw);
    expect(raw.entries["0"]).toMatchObject({ name: "[工坊] 角色设定", comment: "[工坊] 角色设定" });
    expect(raw.entries["1"]).toMatchObject({ name: "[工坊] 关于 [工坊] 的说明", comment: "[工坊] 关于 [工坊] 的说明" });
    expect(raw.entries["2"]).toMatchObject({ name: "  [工坊] 已有前缀", comment: "  [工坊] 已有前缀" });
    expect(raw.entries["3"]).toEqual({ uid: 3, name: "[工坊] 无备注条目", content: "正文" });
    expect("comment" in raw.entries["3"]).toBe(false);
  });
});

describe("project entry identity and validation", () => {
  it("falls back to positional keys when primitive ids are blank or non-finite", () => {
    const refs = extractProjectEntries(
      [
        { id: "", scriptName: "A", replaceString: "" },
        { id: "   ", scriptName: "B", replaceString: "" },
        { id: Number.NaN, scriptName: "C", replaceString: "" },
      ],
      "regex",
    );
    expect(refs.map((ref) => ref.entryKey)).toEqual(["index:0", "index:1", "index:2"]);
  });

  it("rejects duplicate entry keys, over-limit entry counts/lengths, and missing regex replaceString", () => {
    expect(
      validateProjectContent(
        {
          entries: [
            { uid: 1, comment: "A", content: "x" },
            { uid: "1", comment: "B", content: "y" },
          ],
        },
        "worldbook",
      ).valid,
    ).toBe(false);

    expect(
      validateProjectContent(
        { entries: Array.from({ length: 2001 }, (_, uid) => ({ uid, comment: "T", content: "x" })) },
        "worldbook",
      ).valid,
    ).toBe(false);

    expect(
      validateProjectContent({ entries: [{ uid: 1, comment: "x".repeat(1996), content: "x" }] }, "worldbook").valid,
    ).toBe(false);

    expect(
      validateProjectContent({ entries: [{ uid: "k".repeat(2000), comment: "T", content: "x" }] }, "worldbook").valid,
    ).toBe(false);

    expect(
      validateProjectContent([{ id: "1", scriptName: "绕过测试", replace_string: "<script>eval(1)</script>" }], "regex")
        .valid,
    ).toBe(false);

    expect(
      validateProjectContent(
        [
          { id: "", scriptName: "A", replaceString: "1" },
          { id: "", scriptName: "B", replaceString: "2" },
        ],
        "regex",
      ),
    ).toEqual({ valid: true, entryCount: 2 });
  });
});

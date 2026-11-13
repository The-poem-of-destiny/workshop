export const PROJECT_TYPES = ["系统核心", "角色", "内容扩展", "玩法", "事件", "体验优化"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const MAX_CUSTOM_TAGS = 20;
export const MAX_SELECTED_TAGS = 12;
export const MAX_DISPLAY_TAGS = 4;

export interface PresetTagGroup {
  name: string;
  projectTypes: readonly ProjectType[];
  tags: readonly string[];
}

export const PRESET_TAG_GROUPS: readonly PresetTagGroup[] = [
  {
    name: "核心风格",
    projectTypes: ["系统核心"],
    tags: ["战斗特化", "日常陪伴", "抽卡", "整活", "纯系统（无人格）"],
  },
  {
    name: "种族",
    projectTypes: ["角色"],
    tags: [
      "人类",
      "精灵/半精灵",
      "兽族",
      "翼民",
      "龙裔/龙姬",
      "人鱼",
      "血族",
      "妖精",
      "人造人/人偶",
      "构装体",
      "不死生物",
      "魔物",
      "异域生物",
      "神明",
      "英灵/诗灵",
    ],
  },
  {
    name: "身份",
    projectTypes: ["角色"],
    tags: [
      "冒险者",
      "战士",
      "骑士",
      "法师",
      "牧师/神官",
      "圣女",
      "修女",
      "炼金术士",
      "猎魔人",
      "佣兵",
      "猎人/游侠",
      "刺客/杀手",
      "盗贼",
      "商人",
      "工匠",
      "学者/研究员",
      "学生/学徒",
      "教师",
      "女仆",
      "贵族",
      "王族",
      "领主",
      "勇者",
      "旅行者",
      "侦探",
      "吟游诗人",
      "人妻",
      "老板娘",
    ],
  },
  {
    name: "个性",
    projectTypes: ["角色"],
    tags: [
      "大姐姐",
      "妈妈系",
      "妹妹系",
      "大小姐",
      "傲娇",
      "三无",
      "病娇",
      "腹黑",
      "天然呆",
      "元气",
      "温柔",
      "冷淡",
      "毒舌",
      "雌小鬼",
      "疯批",
      "笨蛋",
      "成熟",
    ],
  },
  {
    name: "外貌特征",
    projectTypes: ["角色"],
    tags: ["少女", "熟女", "巨乳", "贫乳", "肌肉", "男娘", "TS/性转", "白发红瞳"],
  },
  {
    name: "内容类型",
    projectTypes: ["内容扩展"],
    tags: [
      "地区与城市",
      "国家",
      "组织与公会",
      "种族",
      "魔物与生物",
      "神明与宗教",
      "物品与装备",
      "饮食与文化",
      "异界与位面",
    ],
  },
  {
    name: "玩法方向",
    projectTypes: ["玩法"],
    tags: [
      "战斗",
      "生产制作",
      "经济交易",
      "成长养成",
      "探索冒险",
      "好感社交",
      "经营与领地",
      "宠物与召唤",
      "检定",
      "小游戏",
    ],
  },
  {
    name: "事件形式",
    projectTypes: ["事件"],
    tags: ["单次事件", "事件链", "BOSS 战", "肉鸽挑战", "开局剧本"],
  },
  {
    name: "优化方向",
    projectTypes: ["体验优化"],
    tags: ["提示词优化", "补丁修正", "数值平衡", "界面美化", "工具脚本"],
  },
  {
    name: "组织",
    projectTypes: [],
    tags: [
      "冒险者公会",
      "魔法协会",
      "炼金公会",
      "锻造协会",
      "金狮商会",
      "苍棘之塔",
      "阴影势力",
      "雾晶学院",
      "凛冬学院",
      "教会/神殿",
    ],
  },
  {
    name: "势力",
    projectTypes: [],
    tags: ["帝国", "兽盟", "翼民圣国", "精灵王庭", "王国", "诺斯加德", "法环", "萨赫拉", "瓦伦蒂亚"],
  },
  { name: "组成形式", projectTypes: [], tags: ["合集"] },
];

const presetGroupsByTag: Record<string, string> = Object.fromEntries(
  PRESET_TAG_GROUPS.flatMap((group) => group.tags.map((tag) => [tag, group.name])),
);

export function presetTagGroup(tag: string): string | null {
  return Object.hasOwn(presetGroupsByTag, tag) ? presetGroupsByTag[tag]! : null;
}

export function orderedPresetTagGroups(projectTypes: readonly ProjectType[]): PresetTagGroup[] {
  const selected = new Set(projectTypes);
  const priority = (group: PresetTagGroup) =>
    group.projectTypes.some((type) => selected.has(type)) ? 0 : group.projectTypes.length === 0 ? 1 : 2;
  return [...PRESET_TAG_GROUPS].sort((left, right) => priority(left) - priority(right));
}

export const DEFAULT_COMMUNITY_INVITE_URL = "https://discord.gg/KNy8yV5w44";

export const CURRENT_POLICY_VERSION = "2026-11-v1";

export interface PolicyClause {
  id: string;
  title: string;
  body: string;
}

export const WORKSHOP_POLICY_CLAUSES: readonly PolicyClause[] = [
  {
    id: "ugc-liability",
    title: "用户内容责任",
    body: "创意工坊中玩家分享的所有模组均由创作者本人负责。虽然工坊设有自动检查与人工审核机制，但官方不对第三方生成内容（UGC）的合法性、准确性、兼容性及内容质量承担担保或连带责任。",
  },
  {
    id: "usage-risk",
    title: "使用风险与问题反馈",
    body: "你在使用创意工坊模组过程中的一切行为和后果由本人自行承担。若在使用特定模组时遇到报错、设定冲突或体验问题，请查阅该模组说明并联系对应的模组作者反馈，或自行卸载该模组；官方不对因此产生的直接或间接损失负责。",
  },
  {
    id: "install-and-backup",
    title: "酒馆安装机制与本地备份",
    body: "从工坊安装模组时，客户端会向你选择的目标世界书或当前角色追加该模组的条目；更新所选实例时会整体替换该模组拥有的条目（不会保留你对该模组条目的本地修改），卸载则移除该模组拥有的条目。在执行安装、更新、转换或卸载前，请务必先自行备份角色卡与相关世界书。",
  },
  {
    id: "terms-update",
    title: "政策变更与重新确认",
    body: "开发者保留根据社区运营需要更新本政策的权利。政策版本升级后，所有用户须阅读并重新完成确认后方可继续使用登录功能，未确认期间仅可以游客身份浏览。",
  },
] as const;

export interface PolicyQuizOption {
  id: string;
  label: string;
}

export interface PolicyQuizQuestion {
  id: string;
  prompt: string;
  options: readonly PolicyQuizOption[];
}

export const WORKSHOP_POLICY_QUESTIONS: readonly PolicyQuizQuestion[] = [
  {
    id: "issue-handling",
    prompt: "在使用工坊中的某个模组时遇到报错、设定冲突或内容问题，建议采取什么行动？",
    options: [
      { id: "contact-official", label: "前往官方主卡反馈区要求官方修复该模组" },
      { id: "contact-author", label: "查看模组说明并联系该模组作者反馈，或先自行卸载该模组" },
      { id: "ask-reviewer", label: "联系工坊审核员代为修改该模组内容" },
    ],
  },
  {
    id: "content-liability",
    prompt: "关于创意工坊中分享的模组内容与质量，以下哪项说法正确？",
    options: [
      { id: "official-guarantee", label: "通过工坊审核代表官方已担保该模组没有问题且适配所有存档" },
      { id: "author-responsible", label: "模组均由创作者本人负责，官方不对模组的内容、质量及使用后果承担责任" },
      { id: "official-canon", label: "只要在工坊公开发布的模组，均属于官方正式设定的一部分" },
    ],
  },
  {
    id: "install-behavior",
    prompt: "关于在 SillyTavern 中安装、更新与卸载工坊模组，以下哪项说法正确？",
    options: [
      { id: "auto-subscribe", label: "点击「订阅」就会自动把模组写进酒馆，取消订阅就会自动卸载" },
      {
        id: "append-and-backup",
        label:
          "安装会向目标世界书或当前角色追加该模组的条目；更新实例会整体替换该模组条目（不保留本地修改），操作前应自行备份角色卡与世界书",
      },
      { id: "auto-cloud-backup", label: "工坊会在云端自动备份我的原始角色卡，任何本地修改在更新后都能自动还原" },
    ],
  },
] as const;

const POLICY_CORRECT_ANSWERS: Readonly<Record<string, string>> = {
  "issue-handling": "contact-author",
  "content-liability": "author-responsible",
  "install-behavior": "append-and-backup",
};

export interface PolicyQuizEvaluation {
  ok: boolean;
  incorrectQuestionIds: string[];
}

export function evaluatePolicyQuiz(answers: Readonly<Record<string, string>>): PolicyQuizEvaluation {
  const incorrectQuestionIds: string[] = [];
  for (const question of WORKSHOP_POLICY_QUESTIONS) {
    if (answers[question.id] !== POLICY_CORRECT_ANSWERS[question.id]) {
      incorrectQuestionIds.push(question.id);
    }
  }
  return {
    ok: incorrectQuestionIds.length === 0,
    incorrectQuestionIds,
  };
}

export function hasAcceptedCurrentPolicy(acceptedVersion: string | null | undefined): boolean {
  return acceptedVersion === CURRENT_POLICY_VERSION;
}

const INVITE_CODE_PATTERN = /^[A-Za-z0-9-]{2,64}$/;

export type DiscordInviteParse = { ok: true; value: string | null } | { ok: false; reason: string };

export function parseDiscordInviteUrl(value: unknown): DiscordInviteParse {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: true, value: null };
  if (raw.length > 200) return { ok: false, reason: "too-long" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not-https" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "discord.gg" && parts.length === 1 && INVITE_CODE_PATTERN.test(parts[0]!)) {
    return { ok: true, value: `https://discord.gg/${parts[0]}` };
  }
  if (
    (host === "discord.com" || host === "www.discord.com") &&
    parts.length === 2 &&
    parts[0] === "invite" &&
    INVITE_CODE_PATTERN.test(parts[1]!)
  ) {
    return { ok: true, value: `https://discord.gg/${parts[1]}` };
  }
  return { ok: false, reason: "not-discord-invite" };
}

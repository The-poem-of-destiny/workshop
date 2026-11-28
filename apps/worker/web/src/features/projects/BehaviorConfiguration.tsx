import { ChevronDown, ChevronUp } from "lucide-react";
import type { ProjectPreview } from "../../api";
import { positionLabel } from "./authoring/preview";

type EntryBehavior = ProjectPreview["entries"][number]["behavior"];

const UNSPECIFIED = "未指定";
const STRATEGY_LABELS: Record<string, string> = {
  constant: "常驻",
  selective: "关键词",
  vectorized: "向量",
};
const LOGIC_LABELS: Record<string, string> = {
  and_any: "任一次关键词匹配",
  not_all: "并非全部次关键词匹配",
  not_any: "无次关键词匹配",
  and_all: "全部次关键词匹配",
};
const LEGACY_LOGIC = ["and_any", "not_all", "not_any", "and_all"] as const;
const ROLE_LABELS: Record<string, string> = {
  "0": "系统（system）",
  "1": "用户（user）",
  "2": "助手（assistant）",
  system: "系统（system）",
  user: "用户（user）",
  assistant: "助手（assistant）",
};

function formatBool(value: boolean | null, trueText: string, falseText: string): string {
  if (value === null) return UNSPECIFIED;
  return value ? trueText : falseText;
}

function buildWorldbookBehavior(behavior: Extract<NonNullable<EntryBehavior>, { kind: "worldbook" }>): {
  rows: [string, string | number][];
  summary: string[];
} {
  const logic =
    typeof behavior.selectiveLogic === "number"
      ? (LEGACY_LOGIC[behavior.selectiveLogic] ?? String(behavior.selectiveLogic))
      : behavior.selectiveLogic;
  const strategy =
    behavior.strategy ?? (behavior.constant === true ? "constant" : behavior.constant === false ? "selective" : null);
  const strategyText = strategy === null ? UNSPECIFIED : (STRATEGY_LABELS[strategy] ?? `未知（${strategy}）`);
  const logicText = logic === null ? UNSPECIFIED : (LOGIC_LABELS[logic] ?? `未知（${logic}）`);
  const roleText =
    behavior.role === null ? UNSPECIFIED : (ROLE_LABELS[String(behavior.role)] ?? `未知（${behavior.role}）`);
  const enabledText = formatBool(behavior.enabled, "启用", "停用");

  const rows: [string, string | number][] = [
    ["触发策略", strategyText],
    ["关键词", behavior.keys.length ? behavior.keys.join("、") : "无"],
    ["次关键词", behavior.secondaryKeys.length ? behavior.secondaryKeys.join("、") : "无"],
    ["次关键词启用", formatBool(behavior.selective, "是", "否")],
    ["次关键词逻辑", logicText],
    ["插入位置", positionLabel({ position: behavior.position })],
    ["插入顺序（order）", behavior.order ?? UNSPECIFIED],
    ["插入深度（depth）", behavior.depth ?? UNSPECIFIED],
    ["插入角色", roleText],
    ["出口名称", behavior.outletName ?? UNSPECIFIED],
    ["启用状态", enabledText],
  ];

  const summary: string[] = [strategyText];
  if (behavior.keys.length) summary.push(`${behavior.keys.length} 个关键词`);
  summary.push(enabledText);
  return { rows, summary };
}

function buildRegexBehavior(behavior: Extract<NonNullable<EntryBehavior>, { kind: "regex" }>): {
  rows: [string, string | number][];
  summary: string[];
} {
  const disabledText = formatBool(behavior.disabled, "已停用", "未停用");
  const rows: [string, string | number][] = [
    ["脚本名称", behavior.scriptName ?? UNSPECIFIED],
    ["匹配表达式（findRegex）", behavior.findRegex ?? UNSPECIFIED],
    ["停用状态", disabledText],
    ["替换内容长度", behavior.replacementLength === null ? UNSPECIFIED : `${behavior.replacementLength} 字符`],
    ["替换源码", "仅下方纯文本展示，不执行"],
  ];
  const summary: string[] = [];
  if (behavior.scriptName) summary.push(behavior.scriptName);
  if (behavior.disabled !== null) summary.push(disabledText);
  return { rows, summary };
}

export function BehaviorConfiguration({
  entry,
  open,
  onToggle,
}: {
  entry: ProjectPreview["entries"][number];
  open: boolean;
  onToggle: () => void;
}) {
  const behavior = entry.behavior;
  const view =
    behavior?.kind === "worldbook"
      ? buildWorldbookBehavior(behavior)
      : behavior?.kind === "regex"
        ? buildRegexBehavior(behavior)
        : { rows: [] as [string, string | number][], summary: [] as string[] };

  return (
    <section className={`reader-behavior${open ? " is-open" : ""}`} aria-label="行为配置">
      <button type="button" className="reader-behavior-toggle" aria-expanded={open} onClick={onToggle}>
        <span className="reader-behavior-title">行为配置</span>
        {!open && view.summary.length > 0 ? (
          <span className="reader-behavior-summary">{view.summary.join(" · ")}</span>
        ) : null}
        <span className="reader-behavior-action">
          {open ? "收起" : "展开"}
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </span>
      </button>
      {open ? (
        behavior ? (
          <dl>
            {view.rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="reader-behavior-empty">此版本未提供行为配置。</p>
        )
      ) : null}
    </section>
  );
}

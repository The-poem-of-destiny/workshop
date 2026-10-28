import type { ProjectPreview } from "../../api";
import { positionLabel } from "./authoring/preview";

export function BehaviorConfiguration({ entry }: { entry: ProjectPreview["entries"][number] }) {
  const behavior = entry.behavior;
  const unspecified = "未指定";
  const rows: [string, string | number][] = [];
  if (behavior?.kind === "worldbook") {
    const strategyLabels: Record<string, string> = {
      constant: "常驻",
      selective: "关键词",
      vectorized: "向量",
    };
    const logicLabels: Record<string, string> = {
      and_any: "任一次关键词匹配",
      not_all: "并非全部次关键词匹配",
      not_any: "无次关键词匹配",
      and_all: "全部次关键词匹配",
    };
    const legacyLogic = ["and_any", "not_all", "not_any", "and_all"];
    const logic =
      typeof behavior.selectiveLogic === "number"
        ? (legacyLogic[behavior.selectiveLogic] ?? String(behavior.selectiveLogic))
        : behavior.selectiveLogic;
    const strategy =
      behavior.strategy ?? (behavior.constant === true ? "constant" : behavior.constant === false ? "selective" : null);
    const roleLabels: Record<string, string> = {
      "0": "系统（system）",
      "1": "用户（user）",
      "2": "助手（assistant）",
      system: "系统（system）",
      user: "用户（user）",
      assistant: "助手（assistant）",
    };
    rows.push(
      ["触发策略", strategy === null ? unspecified : (strategyLabels[strategy] ?? `未知（${strategy}）`)],
      ["关键词", behavior.keys.length ? behavior.keys.join("、") : "无"],
      ["次关键词", behavior.secondaryKeys.length ? behavior.secondaryKeys.join("、") : "无"],
      ["次关键词启用", behavior.selective === null ? unspecified : behavior.selective ? "是" : "否"],
      ["次关键词逻辑", logic === null ? unspecified : (logicLabels[logic] ?? `未知（${logic}）`)],
      ["插入位置", positionLabel({ position: behavior.position })],
      ["插入顺序（order）", behavior.order ?? unspecified],
      ["插入深度（depth）", behavior.depth ?? unspecified],
      [
        "插入角色",
        behavior.role === null ? unspecified : (roleLabels[String(behavior.role)] ?? `未知（${behavior.role}）`),
      ],
      ["出口名称", behavior.outletName ?? unspecified],
      ["启用状态", behavior.enabled === null ? unspecified : behavior.enabled ? "启用" : "停用"],
    );
  } else if (behavior?.kind === "regex") {
    rows.push(
      ["脚本名称", behavior.scriptName ?? unspecified],
      ["匹配表达式（findRegex）", behavior.findRegex ?? unspecified],
      ["停用状态", behavior.disabled === null ? unspecified : behavior.disabled ? "已停用" : "未停用"],
      ["替换内容长度", behavior.replacementLength === null ? unspecified : `${behavior.replacementLength} 字符`],
      ["替换源码", "仅下方纯文本展示，不执行"],
    );
  }
  return (
    <section className="reader-behavior" aria-label="行为配置">
      <h5>行为配置</h5>
      {behavior ? (
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>此版本未提供行为配置。</p>
      )}
    </section>
  );
}

import type { Requirements } from "@workshop/contracts";
import { keyedItems } from "../../lib/keyedItems";
import { Markdown } from "../../lib/markdown";

type Target = Requirements["dependencies"][number];
function targetLabel(target: Target): string {
  switch (target.kind) {
    case "project":
      return `站内项目 ${target.projectId}${target.versionConstraint ? `（版本声明：${target.versionConstraint}）` : ""}`;
    case "original-entry":
      return `${target.entryKind === "worldbook" ? "世界书" : "正则"}原版条目 ${target.name ? `${target.name} · ` : ""}${target.key}`;
    case "external":
      return target.text;
  }
}
export function ProjectRequirements({ value }: { value: Requirements }) {
  if (!value.notes.trim() && value.dependencies.length === 0 && value.conflicts.length === 0) return null;
  return (
    <section className="detail-section detail-warning">
      <h3>依赖与冲突声明</h3>
      {value.notes.trim() ? <Markdown text={value.notes} /> : null}
      {value.dependencies.length ? (
        <>
          <h4>依赖</h4>
          <ul>
            {keyedItems(value.dependencies).map(({ item: target, key }) => (
              <li key={key}>{targetLabel(target)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {value.conflicts.length ? (
        <>
          <h4>冲突／覆盖</h4>
          <ul>
            {keyedItems(value.conflicts).map(({ item, key }) => (
              <li key={key}>
                {item.mode === "override" ? "当前项目覆盖：" : "不能正常共存："}
                {targetLabel(item.target)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="field-hint">以上为作者声明；不代表已自动解析、安装依赖或验证兼容性。</p>
    </section>
  );
}

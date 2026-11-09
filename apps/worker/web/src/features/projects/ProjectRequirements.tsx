import type { Requirements } from "@workshop/contracts";
import { useEffect, useState } from "react";
import { api } from "../../api";
import { keyedItems } from "../../lib/keyedItems";
import { Markdown } from "../../lib/markdown";

type Target = Requirements["dependencies"][number];
type Recommended = NonNullable<Requirements["recommended"]>[number];

const MAX_RESOLVED = 50;

/** Collected hard/soft targets, so the whole list resolves in one batch call. */
function projectTargetIds(value: Requirements): string[] {
  const ids = [
    ...value.dependencies,
    ...value.conflicts.map((item) => item.target),
    ...(value.recommended ?? []).map((item) => item.target),
  ]
    .filter((target): target is Extract<Target, { kind: "project" }> => target.kind === "project")
    .map((target) => target.projectId);
  // The batch endpoint caps at 50; excess targets keep their raw ID.
  return [...new Set(ids)].slice(0, MAX_RESOLVED);
}

function useProjectTitles(value: Requirements): Record<string, string> {
  const [titles, setTitles] = useState<Record<string, string>>({});
  const signature = projectTargetIds(value).join(",");
  useEffect(() => {
    if (signature === "") return;
    let active = true;
    const requested = signature.split(",");
    api
      .projectsByIds(requested)
      .then((batch) => {
        if (!active) return;
        setTitles(Object.fromEntries(batch.items.map((item) => [item.id, item.title])));
      })
      // Missing or hidden projects keep the plain ID; a suggestion must not
      // turn into a page-level error.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [signature]);
  return titles;
}

export function ProjectRequirements({ value }: { value: Requirements }) {
  const titles = useProjectTitles(value);
  const recommended = value.recommended ?? [];
  const hasHard = Boolean(value.notes.trim()) || value.dependencies.length > 0 || value.conflicts.length > 0;
  if (!hasHard && recommended.length === 0) return null;
  const targetLabel = (target: Target): string => {
    switch (target.kind) {
      case "project": {
        const title = titles[target.projectId];
        const name = title ? `《${title}》` : `站内项目 ${target.projectId}`;
        return target.versionConstraint ? `${name}（版本声明：${target.versionConstraint}）` : name;
      }
      case "original-entry":
        return `${target.entryKind === "worldbook" ? "世界书" : "正则"}原版条目 ${target.name ? `${target.name} · ` : ""}${target.key}`;
      case "external":
        return target.text;
    }
  };
  return (
    <>
      {recommended.length > 0 ? (
        <section className="detail-section detail-suggest">
          <h3>建议搭配</h3>
          <p className="detail-suggest-note">作者觉得一起用效果更好，不是安装条件；单独安装也能正常使用。</p>
          <ul className="detail-suggest-list">
            {keyedItems(recommended).map(({ item, key }: { item: Recommended; key: string }) => (
              <li key={key}>
                <span>{targetLabel(item.target)}</span>
                {item.note ? <span className="detail-suggest-reason">{item.note}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {hasHard ? (
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
      ) : null}
    </>
  );
}

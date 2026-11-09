import type { Requirements } from "@workshop/contracts";
import { useId, useRef } from "react";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { newId } from "../../../lib/newId";

type Target = Requirements["dependencies"][number];
function TargetEditor({
  value,
  disabled,
  onChange,
}: {
  value: Target;
  disabled: boolean;
  onChange: (value: Target) => void;
}) {
  const controlId = useId();
  return (
    <>
      <label>
        声明对象
        <select
          disabled={disabled}
          value={value.kind}
          onChange={(event) => {
            const kind = event.target.value;
            onChange(
              kind === "project"
                ? { kind, projectId: "" }
                : kind === "original-entry"
                  ? { kind, entryKind: "worldbook", key: "", name: "" }
                  : { kind: "external", text: "" },
            );
          }}
        >
          <option value="project">站内项目</option>
          <option value="original-entry">原版条目</option>
          <option value="external">外部内容／文字说明</option>
        </select>
      </label>
      {value.kind === "project" ? (
        <>
          <label htmlFor={`${controlId}-project`}>
            项目 ID
            <Input
              id={`${controlId}-project`}
              disabled={disabled}
              value={value.projectId}
              maxLength={80}
              onChange={(event) => onChange({ ...value, projectId: event.target.value })}
            />
          </label>
          <label htmlFor={`${controlId}-constraint`}>
            版本约束（仅声明，不自动解析）
            <Input
              id={`${controlId}-constraint`}
              disabled={disabled}
              value={value.versionConstraint ?? ""}
              maxLength={200}
              onChange={(event) => onChange({ ...value, versionConstraint: event.target.value })}
            />
          </label>
        </>
      ) : value.kind === "original-entry" ? (
        <>
          <label>
            条目类型
            <select
              disabled={disabled}
              value={value.entryKind}
              onChange={(event) =>
                onChange({ ...value, entryKind: event.target.value === "regex" ? "regex" : "worldbook" })
              }
            >
              <option value="worldbook">世界书</option>
              <option value="regex">正则</option>
            </select>
          </label>
          <label htmlFor={`${controlId}-key`}>
            条目标识
            <Input
              id={`${controlId}-key`}
              disabled={disabled}
              value={value.key}
              maxLength={1000}
              onChange={(event) => onChange({ ...value, key: event.target.value })}
            />
          </label>
          <label htmlFor={`${controlId}-name`}>
            名称
            <Input
              id={`${controlId}-name`}
              disabled={disabled}
              value={value.name ?? ""}
              maxLength={500}
              onChange={(event) => onChange({ ...value, name: event.target.value })}
            />
          </label>
        </>
      ) : (
        <label htmlFor={`${controlId}-text`}>
          内容说明
          <Textarea
            id={`${controlId}-text`}
            disabled={disabled}
            value={value.text}
            maxLength={2000}
            onChange={(event) => onChange({ ...value, text: event.target.value })}
          />
        </label>
      )}
    </>
  );
}

export function RequirementsEditor({
  value,
  disabled,
  onChange,
}: {
  value: Requirements;
  disabled: boolean;
  onChange: (value: Requirements) => void;
}) {
  const notesId = useId();
  const recommended = value.recommended ?? [];
  const keys = useRef<{ dependencies: string[]; conflicts: string[]; recommended: string[] }>({
    dependencies: [],
    conflicts: [],
    recommended: [],
  });
  for (const kind of ["dependencies", "conflicts"] as const) {
    while (keys.current[kind].length < value[kind].length) keys.current[kind].push(newId());
  }
  while (keys.current.recommended.length < recommended.length) keys.current.recommended.push(newId());
  return (
    <fieldset disabled={disabled}>
      <legend>依赖与冲突声明</legend>
      <p className="field-hint">用于说明安装条件，不会自动安装依赖或阻止安装。覆盖表示当前项目替换目标内容。</p>
      <p className="field-hint">
        依赖是「没有它就用不了」，建议搭配是「一起用更顺」；后者不会阻止安装，也只会出现在项目页的提示里。
      </p>
      <label htmlFor={notesId}>
        通用说明
        <Textarea
          id={notesId}
          value={value.notes}
          maxLength={2000}
          onChange={(event) => onChange({ ...value, notes: event.target.value })}
        />
      </label>
      <h4>依赖</h4>
      {value.dependencies.map((target, index) => (
        <fieldset key={keys.current.dependencies[index]}>
          <legend>依赖 {index + 1}</legend>
          <TargetEditor
            value={target}
            disabled={disabled}
            onChange={(next) =>
              onChange({ ...value, dependencies: value.dependencies.map((item, at) => (at === index ? next : item)) })
            }
          />
          <button
            type="button"
            onClick={() => {
              keys.current.dependencies.splice(index, 1);
              onChange({ ...value, dependencies: value.dependencies.filter((_, at) => at !== index) });
            }}
          >
            移除依赖
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={disabled || value.dependencies.length >= 100}
        onClick={() => onChange({ ...value, dependencies: [...value.dependencies, { kind: "external", text: "" }] })}
      >
        添加依赖
      </button>
      <h4>冲突／覆盖</h4>
      {value.conflicts.map((item, index) => (
        <fieldset key={keys.current.conflicts[index]}>
          <legend>冲突 {index + 1}</legend>
          <label>
            方式
            <select
              value={item.mode}
              onChange={(event) =>
                onChange({
                  ...value,
                  conflicts: value.conflicts.map((entry, at) =>
                    at === index
                      ? { ...entry, mode: event.target.value === "override" ? "override" : "conflict" }
                      : entry,
                  ),
                })
              }
            >
              <option value="conflict">冲突，不能正常共存</option>
              <option value="override">当前项目覆盖目标</option>
            </select>
          </label>
          <TargetEditor
            value={item.target}
            disabled={disabled}
            onChange={(target) =>
              onChange({
                ...value,
                conflicts: value.conflicts.map((entry, at) => (at === index ? { ...entry, target } : entry)),
              })
            }
          />
          <button
            type="button"
            onClick={() => {
              keys.current.conflicts.splice(index, 1);
              onChange({ ...value, conflicts: value.conflicts.filter((_, at) => at !== index) });
            }}
          >
            移除冲突
          </button>
        </fieldset>
      ))}
      <h4>建议搭配</h4>
      <p className="field-hint">软性推荐：作者认为配合使用效果更好，但不是前置条件。最多 50 条。</p>
      {recommended.map((item, index) => (
        <fieldset key={keys.current.recommended[index]}>
          <legend>建议 {index + 1}</legend>
          <TargetEditor
            value={item.target}
            disabled={disabled}
            onChange={(target) =>
              onChange({
                ...value,
                recommended: recommended.map((entry, at) => (at === index ? { ...entry, target } : entry)),
              })
            }
          />
          <label htmlFor={`recommendation-note-${keys.current.recommended[index]}`}>
            推荐理由（可留空）
            <Input
              id={`recommendation-note-${keys.current.recommended[index]}`}
              disabled={disabled}
              value={item.note ?? ""}
              maxLength={300}
              onChange={(event) =>
                onChange({
                  ...value,
                  recommended: recommended.map((entry, at) =>
                    at === index ? { ...entry, note: event.target.value || undefined } : entry,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            onClick={() => {
              keys.current.recommended.splice(index, 1);
              onChange({ ...value, recommended: recommended.filter((_, at) => at !== index) });
            }}
          >
            移除建议
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={disabled || recommended.length >= 50}
        onClick={() =>
          onChange({
            ...value,
            recommended: [...recommended, { target: { kind: "external", text: "" } }],
          })
        }
      >
        添加建议
      </button>
      <button
        type="button"
        disabled={disabled || value.conflicts.length >= 100}
        onClick={() =>
          onChange({
            ...value,
            conflicts: [...value.conflicts, { mode: "conflict", target: { kind: "external", text: "" } }],
          })
        }
      >
        添加冲突
      </button>
    </fieldset>
  );
}

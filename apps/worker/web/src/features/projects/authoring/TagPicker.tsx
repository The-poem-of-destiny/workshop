import { MAX_CUSTOM_TAGS, orderedPresetTagGroups, type ProjectType } from "@workshop/domain";
import { useState } from "react";
import { Input } from "../../../components/ui/input";

/** Chip picker for official taxonomy tags plus custom `tags: string[]` keywords. */
export function TagPicker({
  idPrefix,
  value,
  projectType,
  disabled = false,
  onChange,
}: {
  idPrefix: string;
  value: readonly string[];
  projectType: ProjectType | "";
  disabled?: boolean;
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const groups = orderedPresetTagGroups(projectType ? [projectType] : []);
  const atLimit = value.length >= MAX_CUSTOM_TAGS;

  function commit(raw: string): void {
    const incoming = Array.from(
      new Set(
        raw
          .split(/[,，\n]/)
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0 && !value.includes(tag)),
      ),
    );
    const room = Math.max(0, MAX_CUSTOM_TAGS - value.length);
    const accepted = incoming.slice(0, room);
    setLimitMessage(incoming.length > accepted.length ? `标签最多 ${MAX_CUSTOM_TAGS} 个。` : null);
    setDraft("");
    if (accepted.length > 0) onChange([...value, ...accepted]);
  }

  function toggle(tag: string): void {
    if (value.includes(tag)) {
      setLimitMessage(null);
      onChange(value.filter((item) => item !== tag));
      return;
    }
    if (atLimit) {
      setLimitMessage(`标签最多 ${MAX_CUSTOM_TAGS} 个。`);
      return;
    }
    setLimitMessage(null);
    onChange([...value, tag]);
  }

  return (
    <div className="tag-picker">
      <div className="tag-chips">
        {value.length === 0 ? <span className="tag-empty">还没有选择标签。</span> : null}
        {value.map((tag) => (
          <span className="tag-chip" key={tag}>
            {tag}
            <button
              type="button"
              aria-label={`移除标签 ${tag}`}
              title="移除"
              disabled={disabled}
              onClick={() => toggle(tag)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="tag-input-row">
        <Input
          id={`${idPrefix}-tag-input`}
          aria-label="添加项目标签"
          value={draft}
          placeholder="输入自定义标签后按 Enter 或逗号添加"
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" || event.key === "," || event.key === "，") {
              event.preventDefault();
              commit(draft);
            }
          }}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
        />
        <button type="button" disabled={disabled || !draft.trim()} onClick={() => commit(draft)}>
          添加
        </button>
      </div>
      <p className={`tag-count${atLimit ? " is-over" : ""}`}>
        已选 {value.length} / {MAX_CUSTOM_TAGS}
      </p>
      {limitMessage ? (
        <p className="asset-error" role="alert">
          {limitMessage}
        </p>
      ) : null}
      {groups.length > 0 ? (
        <div className="tag-groups">
          {groups.map((group) => (
            <details
              className="tag-group"
              key={group.name}
              open={group.tags.some((option) => value.includes(option))}
            >
              <summary>
                {group.name}（{group.tags.length}）
              </summary>
              <div className="tag-options">
                {group.tags.map((option) => (
                  <button
                    type="button"
                    key={option}
                    className={`tag-option${value.includes(option) ? " is-selected" : ""}`}
                    aria-pressed={value.includes(option)}
                    disabled={disabled || (atLimit && !value.includes(option))}
                    onClick={() => toggle(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}

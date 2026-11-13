import { PROJECT_TYPES, type ProjectType } from "@workshop/domain";

export function ProjectClassification({
  idPrefix,
  projectType,
  includedTypes,
  disabled,
  onChange,
}: {
  idPrefix: string;
  projectType: ProjectType | "";
  includedTypes: readonly ProjectType[];
  disabled: boolean;
  onChange: (projectType: ProjectType | "", includedTypes: ProjectType[]) => void;
}) {
  const availableTypes = PROJECT_TYPES.filter((type) => type !== "系统核心" && type !== projectType);
  return (
    <div className="project-classification">
      <label htmlFor={`${idPrefix}-project-type`}>
        主要分类（必选）
        <select
          id={`${idPrefix}-project-type`}
          required
          value={projectType}
          disabled={disabled}
          aria-describedby={`${idPrefix}-classification-hint`}
          onChange={(event) => {
            const primary = event.target.value as ProjectType;
            onChange(primary, includedTypes.filter((type) => type !== "系统核心" && type !== primary));
          }}
        >
          <option value="" disabled>
            请选择主要分类
          </option>
          {PROJECT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <p id={`${idPrefix}-classification-hint`} className="field-hint">
        每个项目只有一个主要分类。系统核心是陪伴玩家的「命定核心」，不是整套游戏替换。
      </p>
      <fieldset className="included-types" disabled={disabled || !projectType}>
        <legend>包含的其他类型（可选）</legend>
        <p className="field-hint">与主要分类分开记录，不占标签名额；更换主要分类会移除重复的包含类型。</p>
        <div className="included-type-options">
          {availableTypes.map((type) => (
            <label key={type}>
              <input
                type="checkbox"
                checked={includedTypes.includes(type)}
                onChange={(event) =>
                  onChange(
                    projectType,
                    event.target.checked ? [...includedTypes, type] : includedTypes.filter((value) => value !== type),
                  )
                }
              />
              {type}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

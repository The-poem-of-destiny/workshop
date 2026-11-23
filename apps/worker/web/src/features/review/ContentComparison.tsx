import type { SubmissionDiff } from "../../api";

const DIFF_FIELD_LABELS: Record<string, string> = {
  title: "标题",
  description: "作品简介",
  project_type: "主要分类",
  projectType: "主要分类",
  included_types: "包含类型",
  includedTypes: "包含类型",
  tags: "标签",
  search_tags: "标签",
  searchTags: "标签",
  schema_version: "适配卡版本",
  schemaVersion: "适配卡版本",
  version_label: "版本号",
  versionLabel: "版本号",
  requirements: "前置依赖与冲突",
  cover_position_x: "封面横向位置",
  coverPositionX: "封面横向位置",
  cover_position_y: "封面纵向位置",
  coverPositionY: "封面纵向位置",
  cover_zoom: "封面缩放",
  coverZoom: "封面缩放",
  discord_thread_url: "Discord 讨论链接",
  discordThreadUrl: "Discord 讨论链接",
  comment: "条目名称",
  name: "条目名称",
  content: "条目内容",
  key: "触发关键词",
  keysecondary: "次要关键词",
  secondary_keys: "次要关键词",
  constant: "常驻激活",
  selective: "按关键词触发",
  selectiveLogic: "关键词匹配逻辑",
  order: "顺序",
  insertion_order: "顺序",
  position: "插入位置",
  depth: "插入深度",
  disable: "停用状态",
  enabled: "启用状态",
  role: "消息角色",
  probability: "触发概率",
  useProbability: "启用概率触发",
  sticky: "持续回合数",
  cooldown: "冷却回合数",
  delay: "延迟回合数",
  group: "包含分组",
  scriptName: "脚本名称",
  findRegex: "匹配规则",
  replaceString: "替换内容",
  disabled: "停用状态",
  placement: "作用范围",
  minDepth: "最小深度",
  maxDepth: "最大深度",
  markdownOnly: "仅作用于显示",
  promptOnly: "仅作用于提示词",
  runOnEdit: "编辑时执行",
  substituteRegex: "宏替换模式",
  trimStrings: "裁剪字符串",
};

export function formatDiffFieldLabel(field: string): string {
  return DIFF_FIELD_LABELS[field] ?? field;
}

function ValueComparison({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  const fields = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  return (
    <div className="review-value-comparison">
      <div className="review-comparison-head">
        <strong>之前（公开基线）</strong>
        <strong>之后（本次提交）</strong>
      </div>
      {fields.map((field) => {
        const oldValue = before?.[field];
        const newValue = after?.[field];
        const changed = JSON.stringify(oldValue) !== JSON.stringify(newValue);
        return (
          <div className={`review-comparison-field${changed ? " is-changed" : ""}`} key={field}>
            <h5>
              {formatDiffFieldLabel(field)}
              {changed ? " · 已变化" : " · 未变"}
            </h5>
            <div className="review-comparison-values">
              <pre className={changed ? "review-before" : ""}>
                {oldValue === undefined
                  ? "（不存在）"
                  : typeof oldValue === "string"
                    ? oldValue
                    : JSON.stringify(oldValue, null, 2)}
              </pre>
              <pre className={changed ? "review-after" : ""}>
                {newValue === undefined
                  ? "（不存在）"
                  : typeof newValue === "string"
                    ? newValue
                    : JSON.stringify(newValue, null, 2)}
              </pre>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ContentComparison({ diff }: { diff: SubmissionDiff }) {
  return (
    <section className="review-section">
      <h3>冻结版本内容与前后差异</h3>
      <p className="review-baseline">
        之前：
        {diff.previousVersionId
          ? `第 ${diff.previousVersionNo ?? "?"} 版 · ${diff.previousVersionId}`
          : "无公开基线（首次提交）"}
        <br />
        之后：第 {diff.versionNo} 版 · {diff.versionId}
      </p>
      <details>
        <summary>完整资料与资料变化</summary>
        <ValueComparison before={diff.metadata.before} after={diff.metadata.after} />
      </details>
      {(["worldbook", "regex"] as const).map((kind) => {
        const changes = [...diff[kind].added, ...diff[kind].modified, ...diff[kind].deleted];
        return (
          <div key={kind}>
            <h4>{kind === "worldbook" ? "世界书" : "正则"}</h4>
            <details>
              <summary>阅读本次完整内容（{diff[kind].entries.length} 条）</summary>
              {diff[kind].entries.map((entry) => (
                <details key={entry.entryKey}>
                  <summary>
                    {entry.name} · {entry.entryKey}
                  </summary>
                  <pre className="review-full-entry">{JSON.stringify(entry.value, null, 2)}</pre>
                </details>
              ))}
              {!diff[kind].entries.length ? <p>本次提交无此类条目。</p> : null}
            </details>
            <details open>
              <summary>查看前后变化（{changes.length} 条）</summary>
              {changes.map((entry) => (
                <details key={entry.entryKey}>
                  <summary>
                    {entry.before === null ? "新增" : entry.after === null ? "删除" : "修改"} · {entry.name} ·{" "}
                    {entry.entryKey}
                  </summary>
                  <ValueComparison before={entry.before} after={entry.after} />
                </details>
              ))}
              {!changes.length ? <p>与公开基线一致。</p> : null}
            </details>
          </div>
        );
      })}
    </section>
  );
}

import type { SubmissionDiff } from "../../api";

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
              {field}
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
        {diff.previousRevisionId
          ? `#${diff.previousRevisionNo ?? "?"} · ${diff.previousRevisionId}`
          : "无公开基线（首次提交）"}
        <br />
        之后：#{diff.revisionNo} · {diff.revisionId}
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

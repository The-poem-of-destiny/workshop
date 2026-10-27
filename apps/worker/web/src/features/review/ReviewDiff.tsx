import type { SubmissionDiff } from "../../api";

import { keyedItems } from "../../lib/keyedItems";

import type { useReviewQueue } from "./useReviewQueue";

type EvidenceKind = "worldbook" | "regex" | "cover";

const kindLabels: Record<EvidenceKind, string> = {
  worldbook: "世界书",
  regex: "正则",
  cover: "封面",
};

function diffEntries(kind: SubmissionDiff["worldbook"]): Array<{
  key: string;
  entryKey: string;
  name: string;
  change: "added" | "modified" | "deleted";
  changedFields?: string[];
}> {
  return [
    ...kind.added.map((item) => ({
      key: `added-${item.entryKey}`,
      entryKey: item.entryKey,
      name: item.name,
      change: "added" as const,
    })),
    ...kind.modified.map((item) => ({
      key: `modified-${item.entryKey}`,
      entryKey: item.entryKey,
      name: item.name,
      changedFields: item.changedFields,
      change: "modified" as const,
    })),
    ...kind.deleted.map((item) => ({
      key: `deleted-${item.entryKey}`,
      entryKey: item.entryKey,
      name: item.name,
      change: "deleted" as const,
    })),
  ];
}
export function ReviewDiff({ diff }: { diff: ReturnType<typeof useReviewQueue>["diff"] }) {
  return (
    <section className="review-section">
      <div className="review-section-heading">
        <div>
          <h3>变更证据</h3>
          <p>当前 revision 与上一版本的完整差异。</p>
        </div>
        {diff ? (
          <span className="review-diff-total">
            {diff.findings.added.length + diff.findings.changed.length + diff.findings.removed.length} 条检查差异
          </span>
        ) : null}
      </div>
      {diff ? (
        <>
          <div className="review-finding-summary">
            <span>
              保留 <b>{diff.findings.accepted.length}</b>
            </span>
            <span>
              变更 <b>{diff.findings.changed.length}</b>
            </span>
            <span>
              新增 <b>{diff.findings.added.length}</b>
            </span>
            <span>
              移除 <b>{diff.findings.removed.length}</b>
            </span>
          </div>
          <div className="review-diff-grid">
            {(["worldbook", "regex"] as const).map((kind) => {
              const entries = diffEntries(diff[kind]);
              return (
                <div className="review-diff-group" key={kind}>
                  <h4>{kindLabels[kind]}</h4>
                  <p>
                    新增 {diff[kind].added.length} · 修改 {diff[kind].modified.length} · 删除{" "}
                    {diff[kind].deleted.length} · 未变 {diff[kind].unchanged}
                  </p>
                  {entries.length ? (
                    <ul>
                      {entries.map((entry) => (
                        <li key={entry.key}>
                          <span className={`review-change review-change-${entry.change}`}>
                            {entry.change === "added" ? "+" : entry.change === "modified" ? "~" : "-"}
                          </span>
                          <span>
                            {entry.name}{" "}
                            <small>
                              ({entry.entryKey})
                              {entry.changedFields?.length ? ` · ${entry.changedFields.join(", ")}` : ""}
                            </small>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="review-muted">没有条目差异</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="review-cover-diff">
            <strong>封面</strong>
            <span>{diff.cover.changed ? "已变更" : "未变更"}</span>
            <small>
              上一版本 {diff.cover.beforeSha256 ?? "无"} · 当前版本 {diff.cover.afterSha256 ?? "无"}
            </small>
          </div>
          <div className="review-findings">
            {(["accepted", "changed", "added", "removed"] as const).map((group) => (
              <details key={group}>
                <summary>
                  {group === "accepted"
                    ? "已接受规则"
                    : group === "changed"
                      ? "规则有变化"
                      : group === "added"
                        ? "新增规则"
                        : "移除规则"}{" "}
                  ({diff.findings[group].length})
                </summary>
                {diff.findings[group].length ? (
                  <ul>
                    {keyedItems(diff.findings[group]).map(({ item: finding, key }) => (
                      <li key={key}>
                        <strong>{finding.severity}</strong>
                        <span>{finding.message}</span>
                        <small>
                          {finding.file ?? "未标记文件"}
                          {finding.line === null ? "" : `:${finding.line}`}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="review-muted">没有记录。</p>
                )}
              </details>
            ))}
          </div>
        </>
      ) : (
        <p className="review-muted">差异加载中或暂无差异。</p>
      )}
    </section>
  );
}

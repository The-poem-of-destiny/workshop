import { useEffect, useState, useSyncExternalStore } from "react";
import { getSessionGeneration, subscribeSessionChange } from "../../api";
import { entryExcerpt, loadSubmissionSource, locateEntry, type SourceFile, type SourceTarget } from "./source-files";

export function SourcePanel({
  submissionId,
  kind,
  target,
}: {
  submissionId: string;
  kind: "worldbook" | "regex";
  target: SourceTarget;
}) {
  const [file, setFile] = useState<SourceFile | null>(null);
  const [expanded, setExpanded] = useState(false);
  const sessionGeneration = useSyncExternalStore(subscribeSessionChange, getSessionGeneration);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setExpanded(false);
    void loadSubmissionSource(submissionId, kind).then((next) => {
      if (!cancelled && sessionGeneration === getSessionGeneration()) setFile(next);
    });
    return () => {
      cancelled = true;
    };
  }, [submissionId, kind, sessionGeneration]);

  if (!file) {
    return (
      <p className="review-source-state review-muted" role="status">
        正在读取提交源码...
      </p>
    );
  }
  if (file.error && file.entries.length === 0) {
    return <p className="review-source-state review-muted">源码不可用：{file.error}</p>;
  }
  const entry = locateEntry(file, target);
  if (!entry) {
    return <p className="review-source-state review-muted">未能定位条目，请下载原始文件核对。</p>;
  }
  const excerpt = entryExcerpt(entry, target.line);
  const all = entry.content.replace(/\r\n?/g, "\n").split("\n");
  const window = expanded ? { start: 0, lines: all } : { start: excerpt.start, lines: excerpt.lines };
  const targetLine = target.line === null ? null : Math.min(Math.max(target.line, 1), excerpt.total);
  const collapsible = excerpt.total > excerpt.lines.length;

  return (
    <div className="review-source">
      <div className="review-source-head">
        <div>
          <strong>{entry.name}</strong>
          <span>
            {kind === "worldbook" ? "世界书" : "正则"} · 条目 {entry.key}
            {entry.uid === null ? "" : ` · uid ${entry.uid}`} · 共 {excerpt.total} 行
          </span>
        </div>
        {collapsible ? (
          <button
            className="review-button review-button-secondary"
            type="button"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "只看目标附近" : "展开整个条目"}
          </button>
        ) : null}
      </div>
      <div className="review-source-code">
        {window.lines.map((line, index) => {
          const number = window.start + index + 1;
          const isTarget = targetLine !== null && number === targetLine;
          return (
            <div className={isTarget ? "review-source-line is-target" : "review-source-line"} key={number}>
              <span className="review-source-line-no">{number}</span>
              <code>{line || " "}</code>
            </div>
          );
        })}
      </div>
      {collapsible && !expanded ? (
        <p className="review-source-hint">
          只显示目标行附近的内容（第 {excerpt.start + 1}–{excerpt.end} 行 / 共 {excerpt.total} 行）。
        </p>
      ) : null}
    </div>
  );
}

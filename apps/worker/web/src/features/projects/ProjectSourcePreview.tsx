import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type ProjectSummary } from "../../api";

type PreviewKind = "worldbook" | "regex";
type PreviewEntry = { key: string; name: string; content: string };
type PreviewData = { revisionId: string; kind: PreviewKind; entries: PreviewEntry[] };

export function ProjectSourcePreview({
  project,
  versionLabel,
}: {
  project: ProjectSummary;
  versionLabel: string | null;
}) {
  const [previewKind, setPreviewKind] = useState<PreviewKind>("worldbook");
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReload, setPreviewReload] = useState(0);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewEntryKey, setPreviewEntryKey] = useState<string | null>(null);
  const [previewReading, setPreviewReading] = useState(false);
  const previewRequest = useRef<{ generation: number } | null>(null);
  useEffect(() => {
    let active = true;
    const request = { generation: previewReload };
    previewRequest.current = request;
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(true);
    setPreviewSearch("");
    setPreviewEntryKey(null);
    setPreviewReading(false);
    api
      .projectPreview(project.id, previewKind)
      .then((value) => {
        if (!active || previewRequest.current !== request) return;
        setPreviewData(value);
        setPreviewLoading(false);
        setPreviewEntryKey(value.entries[0]?.key ?? null);
      })
      .catch((reason) => {
        if (!active || previewRequest.current !== request) return;
        setPreviewLoading(false);
        setPreviewError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [previewKind, previewReload, project.id]);
  const previewEntries = (previewData?.entries ?? []).filter((entry) => {
    const query = previewSearch.trim().toLocaleLowerCase();
    return !query || `${entry.name} ${entry.key}`.toLocaleLowerCase().includes(query);
  });
  const selectedPreview = previewEntries.find((entry) => entry.key === previewEntryKey) ?? previewEntries[0] ?? null;
  const selectedPreviewIndex = selectedPreview
    ? previewEntries.findIndex((entry) => entry.key === selectedPreview.key)
    : -1;
  const previousPreview = selectedPreviewIndex > 0 ? previewEntries[selectedPreviewIndex - 1] : undefined;
  const nextPreview = selectedPreviewIndex >= 0 ? previewEntries[selectedPreviewIndex + 1] : undefined;
  return (
    <section className="detail-section preview-section">
      <div className="preview-heading">
        <div>
          <h3>内容预览</h3>
          <p className="preview-note">仅展示已公开发布内容，正文按纯文本读取。</p>
        </div>
        {versionLabel ? <span className="preview-revision">版本 {versionLabel}</span> : null}
      </div>
      <div className="preview-tabs" role="tablist" aria-label="内容类型">
        {(["worldbook", "regex"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={previewKind === kind}
            className={previewKind === kind ? "is-active" : ""}
            onClick={() => setPreviewKind(kind)}
          >
            {kind === "worldbook" ? `世界书（${project.entries.worldbook}）` : `正则（${project.entries.regex}）`}
          </button>
        ))}
      </div>
      {previewLoading ? <p className="detail-state">正在加载预览…</p> : null}
      {previewError ? (
        <div className="detail-state detail-state-error" role="alert">
          <p>预览加载失败。</p>
          <button type="button" onClick={() => setPreviewReload((value) => value + 1)}>
            <RefreshCcw aria-hidden="true" />
            重试
          </button>
        </div>
      ) : null}
      {!previewLoading && !previewError ? (
        <div className={`preview-browser${previewReading ? " is-reading" : ""}`}>
          <label className="preview-search">
            <span className="sr-only">搜索条目</span>
            <input
              type="search"
              value={previewSearch}
              placeholder="搜索名称或键名"
              onChange={(event) => setPreviewSearch(event.target.value)}
            />
          </label>
          <div className="preview-grid">
            <div className="preview-entry-list" role="listbox" aria-label="条目列表">
              {previewEntries.length ? (
                previewEntries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    role="option"
                    aria-selected={selectedPreview?.key === entry.key}
                    className={selectedPreview?.key === entry.key ? "is-selected" : ""}
                    onClick={() => {
                      setPreviewEntryKey(entry.key);
                      setPreviewReading(true);
                    }}
                  >
                    <strong>{entry.name || entry.key}</strong>
                    <span>
                      {[entry.name ? entry.key : null, `${entry.content.length} 字符`].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                ))
              ) : (
                <p className="preview-empty">没有匹配的条目。</p>
              )}
            </div>
            <div className="preview-content">
              {selectedPreview ? (
                <>
                  <button type="button" className="preview-back" onClick={() => setPreviewReading(false)}>
                    <ArrowLeft aria-hidden="true" />
                    返回条目列表
                  </button>
                  <div className="preview-content-head">
                    <h4>{selectedPreview.name || selectedPreview.key}</h4>
                    <div className="preview-entry-nav">
                      <button
                        type="button"
                        aria-label="上一条目"
                        title="上一条目"
                        disabled={!previousPreview}
                        onClick={() => previousPreview && setPreviewEntryKey(previousPreview.key)}
                      >
                        <ChevronLeft aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="下一条目"
                        title="下一条目"
                        disabled={!nextPreview}
                        onClick={() => nextPreview && setPreviewEntryKey(nextPreview.key)}
                      >
                        <ChevronRight aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <pre>{selectedPreview.content}</pre>
                </>
              ) : (
                <p className="preview-empty">选择条目后查看内容。</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

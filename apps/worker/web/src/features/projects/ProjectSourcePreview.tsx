import { ArrowLeft, RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, formatUserError, type ProjectPreview, type ProjectPreviewKind, type ProjectSummary } from "../../api";
import { BehaviorConfiguration } from "./BehaviorConfiguration";
import { EjsHighlightedContent } from "./EjsHighlightedContent";
import "../../styles/task-workspaces.css";

type PreviewKind = ProjectPreviewKind;
type PreviewData = ProjectPreview;
type PreviewEntrySort = "default" | "name" | "length" | "order";

export function ProjectSourcePreview({
  project,
  versionLabel,
  loggedIn,
}: {
  project: ProjectSummary;
  versionLabel: string | null;
  loggedIn: boolean;
}) {
  const [previewKind, setPreviewKind] = useState<PreviewKind>(
    project.entries.worldbook > 0 || project.entries.regex === 0 ? "worldbook" : "regex",
  );
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReload, setPreviewReload] = useState(0);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewSort, setPreviewSort] = useState<PreviewEntrySort>("default");
  const [previewEntryKey, setPreviewEntryKey] = useState<string | null>(null);
  const [mobileReading, setMobileReading] = useState(false);
  const [behaviorOpen, setBehaviorOpen] = useState(false);
  const [previewRequested, setPreviewRequested] = useState(false);
  const previews = useRef<Record<string, Promise<PreviewData>>>({});
  const previewRequest = useRef<{ generation: number } | null>(null);

  useEffect(() => {
    let active = true;
    const request = { generation: previewReload };
    previewRequest.current = request;
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setPreviewSearch("");
    setPreviewEntryKey(null);
    setMobileReading(false);
    if (!loggedIn) previews.current = {};
    if (!loggedIn || !previewRequested) {
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    const key = JSON.stringify([project.id, project.publishedVersionId, previewKind]);
    let pending = previews.current[key];
    if (!pending) {
      pending = api.projectPreview(project.id, previewKind).then((value) => {
        if (project.publishedVersionId && value.versionId !== project.publishedVersionId) {
          throw new Error("项目版本已更新，请重新打开项目详情。");
        }
        return value;
      });
      previews.current[key] = pending;
      void pending.catch(() => {
        if (previews.current[key] === pending) delete previews.current[key];
      });
    }
    pending
      .then((value) => {
        if (!active || previewRequest.current !== request) return;
        setPreviewData(value);
        setPreviewLoading(false);
        setPreviewEntryKey(value.entries[0]?.key ?? null);
      })
      .catch((reason) => {
        if (!active || previewRequest.current !== request) return;
        setPreviewLoading(false);
        setPreviewError(formatUserError(reason));
      });
    return () => {
      active = false;
    };
  }, [previewKind, previewReload, project.id, project.publishedVersionId, loggedIn, previewRequested]);

  const filteredEntries = (previewData?.entries ?? []).filter((entry) => {
    const query = previewSearch.trim().toLocaleLowerCase();
    return !query || `${entry.name} ${entry.key}`.toLocaleLowerCase().includes(query);
  });
  const previewEntries =
    previewSort === "default"
      ? filteredEntries
      : [...filteredEntries].sort((a, b) => {
          if (previewSort === "name") {
            return (a.name || a.key).localeCompare(b.name || b.key, "zh-CN", { numeric: true });
          }
          if (previewSort === "length") {
            return b.content.length - a.content.length;
          }
          const orderA =
            a.behavior?.kind === "worldbook" ? (a.behavior.order ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
          const orderB =
            b.behavior?.kind === "worldbook" ? (b.behavior.order ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
          return orderA - orderB;
        });
  const selectedPreview = previewEntries.find((entry) => entry.key === previewEntryKey) ?? previewEntries[0] ?? null;
  const selectedPreviewIndex = selectedPreview
    ? previewEntries.findIndex((entry) => entry.key === selectedPreview.key)
    : -1;

  return (
    <section className="detail-section preview-section">
      <div className="preview-heading">
        <h3>条目内容预览</h3>
        {versionLabel ? <span className="preview-revision">v{versionLabel.replace(/^v/i, "")}</span> : null}
      </div>
      <div className="preview-tabs" role="tablist" aria-label="内容类型">
        {(["worldbook", "regex"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={previewKind === kind}
            className={previewKind === kind ? "is-active" : ""}
            onClick={() => {
              setPreviewKind(kind);
              if (kind === "regex" && previewSort === "order") setPreviewSort("default");
              const cacheKey = JSON.stringify([project.id, project.publishedVersionId, kind]);
              setPreviewRequested(Boolean(previews.current[cacheKey]) || previewRequested);
            }}
          >
            {kind === "worldbook" ? `世界书（${project.entries.worldbook}）` : `正则（${project.entries.regex}）`}
          </button>
        ))}
      </div>
      {previewLoading ? <p className="detail-state">正在读取条目…</p> : null}
      {previewError ? (
        <div className="detail-state detail-state-error" role="alert">
          <p>条目加载失败。</p>
          <button type="button" onClick={() => setPreviewReload((value) => value + 1)}>
            <RefreshCcw aria-hidden="true" />
            重试
          </button>
        </div>
      ) : null}
      {!loggedIn ? <p className="detail-state">登录后可在线翻阅世界书与正则条目。</p> : null}
      {loggedIn && !previewRequested ? (
        <button type="button" className="preview-open-btn" onClick={() => setPreviewRequested(true)}>
          展开{previewKind === "worldbook" ? "世界书" : "正则"}条目预览
        </button>
      ) : null}
      {loggedIn && previewRequested && !previewLoading && !previewError && previewData ? (
        <div className={`preview-browser${mobileReading ? " is-mobile-reading" : ""}`}>
          <div className="preview-sidebar-pane">
            <div className="preview-sidebar-controls">
              <label className="preview-search">
                <span className="sr-only">搜索条目</span>
                <input
                  type="search"
                  value={previewSearch}
                  placeholder="筛选条目名称…"
                  onChange={(event) => setPreviewSearch(event.target.value)}
                />
              </label>
              <select
                className="preview-sort-select"
                aria-label="条目排序"
                value={previewSort}
                onChange={(event) => setPreviewSort(event.target.value as PreviewEntrySort)}
              >
                <option value="default">默认顺序</option>
                <option value="name">按名称</option>
                <option value="length">按字数</option>
                {previewKind === "worldbook" ? <option value="order">按插入顺序</option> : null}
              </select>
            </div>
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
                      setMobileReading(true);
                    }}
                  >
                    <strong>{entry.name || entry.key}</strong>
                    <span>
                      {[entry.name && entry.name !== entry.key ? entry.key : null, `${entry.content.length} 字`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                ))
              ) : (
                <p className="preview-empty">暂无条目。</p>
              )}
            </div>
          </div>

          <article className="preview-content" key={selectedPreview?.key}>
            {selectedPreview ? (
              <>
                <button type="button" className="preview-back" onClick={() => setMobileReading(false)}>
                  <ArrowLeft aria-hidden="true" />
                  返回条目列表
                </button>
                <div className="preview-content-head">
                  <div>
                    <h4>{selectedPreview.name || selectedPreview.key}</h4>
                    <p className="reader-task-position">
                      {selectedPreviewIndex + 1} / {previewEntries.length} · {selectedPreview.content.length} 字
                    </p>
                  </div>
                </div>
                <BehaviorConfiguration
                  entry={selectedPreview}
                  open={behaviorOpen}
                  onToggle={() => setBehaviorOpen((prev) => !prev)}
                />
                {previewKind === "worldbook" ? (
                  <EjsHighlightedContent content={selectedPreview.content} />
                ) : (
                  <pre>{selectedPreview.content}</pre>
                )}
              </>
            ) : (
              <p className="preview-empty">从左侧选择一条查看内容。</p>
            )}
          </article>
        </div>
      ) : null}
    </section>
  );
}

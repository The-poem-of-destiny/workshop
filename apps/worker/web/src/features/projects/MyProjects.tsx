import { ArrowLeft, Bookmark, BookOpen, Download, Plus, RefreshCcw, ThumbsUp } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { type AuthorCollection, type AuthorProject, api } from "../../api";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import "../../styles/workspaces.css";
import "../../styles/task-workspaces.css";
import { ProjectStatusBanner } from "./authoring/StatusBanner";
import { CollectionsManager } from "./CollectionsManager";
import { ProjectEditor } from "./ProjectEditor";
import { metadataPayload, projectForm } from "./projectMetadata";

type ProjectStatus = "draft" | "public" | "review" | "rejected";

function statusOf(item: AuthorProject): ProjectStatus {
  const submission = item.latestSubmission;
  if (submission && (submission.status === "pending" || submission.status === "checking")) return "review";
  if (submission?.status === "rejected") return "rejected";
  if (item.project.visibility === "public" && item.project.publishedVersionId) return "public";
  return "draft";
}

const STATUS_LABELS: Record<ProjectStatus, string> = {
  public: "公开展示",
  review: "审核中",
  draft: "草稿",
  rejected: "已退回",
};

export function MyProjects({
  onCreate,
  onError,
  onNotice,
  initialSelectedId,
  onDirtyChange,
  onInitialSelectionConsumed,
}: {
  onCreate: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  initialSelectedId?: string | null;
  onDirtyChange?: (dirty: boolean) => void;
  onInitialSelectionConsumed?: () => void;
}) {
  const [items, setItems] = useState<AuthorProject[]>([]);
  const [collections, setCollections] = useState<AuthorCollection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ProjectStatus>("all");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failedCovers, setFailedCovers] = useState<Record<string, boolean>>({});
  const [withdrawPrompt, setWithdrawPrompt] = useState<{
    entry: AuthorProject;
    continueEdit: boolean;
  } | null>(null);
  const editorOpener = useRef<HTMLButtonElement | null>(null);
  const reportError = useRef(onError);
  useEffect(() => {
    reportError.current = onError;
  }, [onError]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [projectResult, collectionResult] = await Promise.all([
        api.myProjects(),
        api.myCollections().catch(() => ({ items: [] as AuthorCollection[] })),
      ]);
      setItems(projectResult.items);
      setCollections(collectionResult.items);
      setSelectedId((current) =>
        current && !projectResult.items.some((item) => item.project.id === current) ? null : current,
      );
    } catch (reason) {
      reportError.current(String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  const consumeInitialSelection = useEffectEvent(() => onInitialSelectionConsumed?.());
  useEffect(() => {
    void refresh();
    consumeInitialSelection();
  }, [refresh]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  function closeEditor(): void {
    if (dirty && !window.confirm("有尚未保存的资料或未上传的文件，确定放弃并返回项目列表？")) return;
    setDirty(false);
    setSelectedId(null);
  }

  async function createVersion(entry: AuthorProject): Promise<void> {
    if (dirty && !window.confirm("有尚未保存的资料或未上传的文件，确定放弃并新建版本？")) return;
    setBusy(true);
    try {
      await api.createVersion(entry.project.id, entry.rowVersion, metadataPayload(projectForm(entry.project, entry)));
      onNotice("已创建新版本，现在可以修改资料与上传文件。");
      await refresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function confirmBannerWithdraw(): Promise<void> {
    if (!withdrawPrompt || busy) return;
    const { entry, continueEdit } = withdrawPrompt;
    const submission = entry.latestSubmission;
    if (!submission) {
      setWithdrawPrompt(null);
      return;
    }
    setBusy(true);
    try {
      const withdrawn = await api.withdrawSubmission(entry.project.id, submission.id, entry.rowVersion);
      setWithdrawPrompt(null);
      if (continueEdit) {
        try {
          await api.createVersion(
            entry.project.id,
            withdrawn.rowVersion,
            metadataPayload(projectForm(entry.project, entry)),
          );
          onNotice("已撤回审核并创建新版本，可直接继续修改。");
        } catch (versionError) {
          onError(`审核已撤回，请点击「新建版本」继续修改：${String(versionError)}`);
        }
      } else {
        onNotice("本次提交已撤回，线上公开版本不受影响。");
      }
      await refresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  const statusCounts = useMemo(() => {
    const counts: Record<"all" | ProjectStatus, number> = {
      all: items.length,
      public: 0,
      review: 0,
      rejected: 0,
      draft: 0,
    };
    for (const item of items) counts[statusOf(item)] += 1;
    return counts;
  }, [items]);

  const visibleItems = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const status = statusOf(item);
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (!needle) return true;
      return [
        item.project.title,
        item.project.description ?? "",
        item.project.projectType,
        ...item.project.includedTypes,
        ...item.project.tags,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [items, search, statusFilter]);
  const selected = items.find((item) => item.project.id === selectedId) ?? null;

  return (
    <div className="workspace workspace-projects">
      <section className="workspace-section project-index">
        <div className="workspace-heading">
          <div>
            <p className="workspace-kicker">创作者工作台</p>
            <h2>我的项目</h2>
          </div>
          <div className="workspace-actions">
            <button type="button" onClick={onCreate} className="workspace-primary">
              <Plus aria-hidden="true" />
              新建项目
            </button>
            <button type="button" onClick={() => void refresh()} disabled={loading}>
              <RefreshCcw aria-hidden="true" />
              {loading ? "刷新中…" : "刷新"}
            </button>
          </div>
        </div>

        <div className="workspace-filter-bar">
          <div className="workspace-status-pills" role="tablist" aria-label="状态筛选">
            {(
              [
                ["all", "全部"],
                ["public", "公开展示"],
                ["review", "审核中"],
                ["rejected", "已退回"],
                ["draft", "草稿"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={statusFilter === key}
                className={`status-pill-tab${statusFilter === key ? " is-active" : ""}`}
                onClick={() => setStatusFilter(key)}
              >
                <span>{label}</span>
                <small>{statusCounts[key]}</small>
              </button>
            ))}
          </div>
          <label className="workspace-search-inline" htmlFor="project-search">
            <span className="sr-only">搜索项目</span>
            <input
              id="project-search"
              type="search"
              value={search}
              placeholder="搜索标题、分类或标签…"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        {loading && items.length === 0 ? <p className="workspace-state">正在加载项目…</p> : null}
        {!loading && items.length === 0 ? (
          <div className="workspace-state workspace-empty">
            <strong>还没有发布或草稿项目</strong>
            <span>新建项目并上传世界书或正则文件，即可提交发布到创意工坊。</span>
            <button type="button" className="workspace-primary" onClick={onCreate}>
              新建第一个项目
            </button>
          </div>
        ) : null}
        {!loading && items.length > 0 && visibleItems.length === 0 ? (
          <p className="workspace-state">没有匹配当前筛选条件的项目。</p>
        ) : null}
        {visibleItems.length > 0 ? (
          <div className="project-list workspace-project-list">
            {visibleItems.map((item) => {
              const status = statusOf(item);
              const p = item.project;
              const hasCover = Boolean(p.coverUrl && !failedCovers[p.id]);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`project-row workspace-project-row${p.id === selectedId ? " selected" : ""}`}
                  onClick={(event) => {
                    editorOpener.current = event.currentTarget;
                    setSelectedId(p.id);
                  }}
                >
                  <span className="workspace-row-thumb" aria-hidden="true">
                    {hasCover ? (
                      <img
                        src={p.coverUrl!}
                        alt=""
                        loading="lazy"
                        onError={() => setFailedCovers((prev) => ({ ...prev, [p.id]: true }))}
                        style={{
                          objectPosition: `${p.coverPositionX ?? 50}% ${p.coverPositionY ?? 50}%`,
                          transform: `scale(${p.coverZoom ?? 1})`,
                        }}
                      />
                    ) : (
                      <BookOpen />
                    )}
                  </span>
                  <span className="workspace-project-main">
                    <span className="workspace-row-title-line">
                      <strong>{p.title}</strong>
                      <span className={`workspace-status workspace-status-${status}`}>{STATUS_LABELS[status]}</span>
                    </span>
                    <small>
                      <span className="workspace-row-type">{p.projectType}</span>
                      {p.includedTypes.length ? ` · 兼有 ${p.includedTypes.join(" / ")}` : ""}
                      {p.versionLabel ? ` · v${p.versionLabel.replace(/^v/i, "")}` : ""}
                      {p.updatedAt ? ` · 更新 ${p.updatedAt.slice(0, 10)}` : ""}
                    </small>
                  </span>
                  <span className="workspace-row-metrics" aria-hidden="true">
                    <span className="workspace-row-entries">
                      世界书 {p.entries.worldbook} · 正则 {p.entries.regex}
                    </span>
                    {p.publishedVersionId ? (
                      <span className="workspace-row-stats">
                        <span>
                          <Download />
                          {p.counts.downloads}
                        </span>
                        <span>
                          <ThumbsUp />
                          {p.counts.likes}
                        </span>
                        <span>
                          <Bookmark />
                          {p.counts.subscriptions}
                        </span>
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      <CollectionsManager
        projects={items}
        collections={collections}
        loading={loading}
        onReload={refresh}
        onNotice={onNotice}
        onError={onError}
      />

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && closeEditor()}>
        {selected ? (
          <DialogContent
            className="task-workspace author-task mobile-sheet"
            aria-describedby="author-task-description"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              editorOpener.current?.focus({ preventScroll: true });
            }}
          >
            <header className="task-workspace-header">
              <div className="task-workspace-title-group">
                <div className="task-workspace-title-row">
                  <DialogTitle>{selected.project.title} · 编辑项目</DialogTitle>
                  <span className={`workspace-status workspace-status-${statusOf(selected)}`}>
                    {STATUS_LABELS[statusOf(selected)]}
                  </span>
                </div>
                <DialogDescription id="author-task-description">
                  草稿修改在审核通过前不会影响线上公开版本
                </DialogDescription>
              </div>
              <button type="button" className="task-return-btn" onClick={closeEditor}>
                <ArrowLeft aria-hidden="true" />
                <span>返回我的项目</span>
              </button>
            </header>
            <ProjectEditor
              entry={selected}
              collections={collections}
              statusBanner={
                <ProjectStatusBanner
                  entry={selected}
                  busy={busy}
                  onNewVersion={() => void createVersion(selected)}
                  onWithdrawAndEdit={() => setWithdrawPrompt({ entry: selected, continueEdit: true })}
                  onWithdrawOnly={() => setWithdrawPrompt({ entry: selected, continueEdit: false })}
                />
              }
              onRefresh={refresh}
              onError={onError}
              onNotice={onNotice}
              onDirtyChange={setDirty}
            />
          </DialogContent>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={withdrawPrompt !== null}
        title={withdrawPrompt?.continueEdit ? "撤回审核并继续修改" : "撤回本次审核"}
        description={
          withdrawPrompt?.continueEdit
            ? "撤回后系统将立即为你创建可编辑的新草稿版本，线上公开版本不受影响。"
            : "撤回后本次提交不再发布，线上公开版本不受影响。"
        }
        confirmLabel={withdrawPrompt?.continueEdit ? "确认撤回并修改" : "确认撤回"}
        busy={busy}
        onConfirm={() => void confirmBannerWithdraw()}
        onCancel={() => setWithdrawPrompt(null)}
      />
    </div>
  );
}

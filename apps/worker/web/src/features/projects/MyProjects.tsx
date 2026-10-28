import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { type AuthorProject, api } from "../../api";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import "../../styles/workspaces.css";
import "../../styles/task-workspaces.css";
import { ProjectStatusBanner } from "./authoring/StatusBanner";
import { ProjectEditor } from "./ProjectEditor";
import { metadataPayload, projectForm } from "./projectMetadata";

type ProjectStatus = "draft" | "public" | "review" | "rejected";

function statusOf(item: AuthorProject): ProjectStatus {
  const submission = item.latestSubmission;
  if (submission && (submission.status === "pending" || submission.status === "checking")) return "review";
  if (submission?.status === "rejected") return "rejected";
  if (item.project.visibility === "public" && item.project.publishedRevisionId) return "public";
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
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ProjectStatus>("all");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const editorOpener = useRef<HTMLButtonElement | null>(null);
  const reportError = useRef(onError);
  useEffect(() => {
    reportError.current = onError;
  }, [onError]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await api.myProjects();
      setItems(result.items);
      setSelectedId((current) =>
        current && !result.items.some((item) => item.project.id === current) ? null : current,
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
    if (dirty && !window.confirm("有尚未保存的资料或未上传的文件，确定放弃并返回项目索引？")) return;
    setDirty(false);
    setSelectedId(null);
  }

  async function createRevision(entry: AuthorProject): Promise<void> {
    if (dirty && !window.confirm("有尚未保存的资料或未上传的文件，确定放弃并新建版本？")) return;
    setBusy(true);
    try {
      const result = await api.createRevision(
        entry.project.id,
        entry.rowVersion,
        metadataPayload(projectForm(entry.project, entry)),
      );
      onNotice(`已创建新版本（版本 ${result.rowVersion}），现在可以继续修改并上传文件。`);
      await refresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  const visibleItems = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const status = statusOf(item);
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (!needle) return true;
      return [item.project.title, item.project.description ?? "", item.project.projectType ?? "", ...item.project.tags]
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
            <p className="workspace-kicker">作者工作区</p>
            <h2>我的项目</h2>
          </div>
          <div className="workspace-actions">
            <button type="button" onClick={onCreate} className="workspace-primary">
              新建项目
            </button>
            <button type="button" onClick={() => void refresh()} disabled={loading}>
              {loading ? "加载中…" : "刷新"}
            </button>
          </div>
        </div>
        <div className="workspace-toolbar">
          <label className="workspace-search" htmlFor="project-search">
            <span>搜索项目</span>
            <input
              id="project-search"
              type="search"
              value={search}
              placeholder="标题、标签或类型"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="workspace-filter" htmlFor="project-status">
            <span>状态</span>
            <select
              id="project-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | ProjectStatus)}
            >
              <option value="all">全部</option>
              <option value="draft">草稿</option>
              <option value="review">审核中</option>
              <option value="public">公开展示</option>
              <option value="rejected">已退回</option>
            </select>
          </label>
        </div>
        {loading && items.length === 0 ? <p className="workspace-state">正在加载项目…</p> : null}
        {!loading && items.length === 0 ? (
          <div className="workspace-state workspace-empty">
            <strong>还没有项目</strong>
            <span>创建一个草稿，上传文件后再提交审核。</span>
            <button type="button" className="workspace-primary" onClick={onCreate}>
              创建第一个项目
            </button>
          </div>
        ) : null}
        {!loading && items.length > 0 && visibleItems.length === 0 ? (
          <p className="workspace-state">没有符合当前搜索和状态筛选的项目。</p>
        ) : null}
        {visibleItems.length > 0 ? (
          <div className="project-list workspace-project-list">
            {visibleItems.map((item) => {
              const status = statusOf(item);
              return (
                <button
                  key={item.project.id}
                  type="button"
                  className={`project-row workspace-project-row${item.project.id === selectedId ? " selected" : ""}`}
                  onClick={(event) => {
                    editorOpener.current = event.currentTarget;
                    setSelectedId(item.project.id);
                  }}
                >
                  <span className="workspace-project-main">
                    <strong>{item.project.title}</strong>
                    <small>
                      {item.project.projectType ?? "未分类"} · v{item.project.versionLabel ?? "未标注"} ·{" "}
                      {item.project.updatedAt ? new Date(item.project.updatedAt).toLocaleDateString() : "日期未知"}
                    </small>
                  </span>
                  <span className={`workspace-status workspace-status-${status}`}>{STATUS_LABELS[status]}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </section>
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && closeEditor()}>
        {selected ? (
          <DialogContent
            className="task-workspace author-task"
            aria-describedby="author-task-description"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              editorOpener.current?.focus({ preventScroll: true });
            }}
          >
            <header className="task-workspace-header">
              <div>
                <DialogTitle>{selected.project.title} · 编辑任务</DialogTitle>
                <DialogDescription id="author-task-description">
                  资料、封面与内容作为同一快照送审，审核前不改变公开版本。
                </DialogDescription>
              </div>
              <button type="button" onClick={closeEditor}>
                返回我的项目
              </button>
            </header>
            <div className="task-workspace-body">
              <ProjectStatusBanner entry={selected} busy={busy} onNewRevision={() => void createRevision(selected)} />
              <ProjectEditor
                entry={selected}
                onRefresh={refresh}
                onError={onError}
                onNotice={onNotice}
                onDirtyChange={setDirty}
              />
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

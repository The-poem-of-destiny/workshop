import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { type AuthorProject, api } from "../../api";
import "../../styles/workspaces.css";
import { ProjectStatusBanner } from "./authoring/StatusBanner";
import { ProjectEditor } from "./ProjectEditor";
import { PublishedDisplayEditor } from "./PublishedDisplayEditor";
import { metadataPayload, projectForm } from "./projectMetadata";

type ProjectStatus = "draft" | "public" | "review" | "rejected";
type DetailTab = "draft" | "display";

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

const TAB_HINTS: Record<DetailTab, string> = {
  draft: "草稿内容：编辑标题、标签等元数据，上传世界书、正则和封面，然后提交审核。",
  display: "公开展示：审核通过后，项目页上展示的标题、简介、标签和封面可以在这里单独调整。",
};

export function MyProjects({
  onCreate,
  onError,
  onNotice,
  initialSelectedId,
}: {
  onCreate: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  initialSelectedId?: string | null;
}) {
  const [items, setItems] = useState<AuthorProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ProjectStatus>("all");
  const [tab, setTab] = useState<DetailTab>("draft");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      const result = await api.myProjects();
      setItems(result.items);
      if (selectedId && !result.items.some((item) => item.project.id === selectedId)) setSelectedId(null);
    } catch (reason) {
      onError(String(reason));
    } finally {
      setLoading(false);
    }
  }

  const loadInitial = useEffectEvent(() => void refresh());
  useEffect(() => {
    loadInitial();
  }, []);

  const previousSelection = useRef(selectedId);
  useEffect(() => {
    if (previousSelection.current !== selectedId) {
      previousSelection.current = selectedId;
      setTab("draft");
    }
  }, [selectedId]);

  async function createRevision(entry: AuthorProject): Promise<void> {
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
                  onClick={() => setSelectedId(item.project.id)}
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
      {selected ? (
        <section className="workspace-detail">
          <ProjectStatusBanner entry={selected} busy={busy} onNewRevision={() => void createRevision(selected)} />
          <div className="workspace-tabs" role="tablist" aria-label="项目内容">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "draft"}
              className={`workspace-tab${tab === "draft" ? " is-active" : ""}`}
              onClick={() => setTab("draft")}
            >
              草稿内容
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "display"}
              className={`workspace-tab${tab === "display" ? " is-active" : ""}`}
              onClick={() => setTab("display")}
            >
              公开展示
            </button>
          </div>
          <p className="workspace-tab-hint">{TAB_HINTS[tab]}</p>
          <div className="editor-stack workspace-editors">
            {tab === "draft" ? (
              <ProjectEditor entry={selected} onRefresh={refresh} onError={onError} onNotice={onNotice} />
            ) : (
              <PublishedDisplayEditor entry={selected} onRefresh={refresh} onError={onError} onNotice={onNotice} />
            )}
          </div>
        </section>
      ) : (
        <section className="workspace-section workspace-selection-hint">
          <p className="workspace-muted">尚未选择项目</p>
        </section>
      )}
    </div>
  );
}

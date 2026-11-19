import type { InteractionStateItem } from "@workshop/contracts";
import { WORKSHOP_LIMITS } from "@workshop/domain";
import { Image as ImageIcon, MessageSquarePlus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api, type ProjectSummary } from "../../api";
import "../../styles/workspaces.css";

type PlayerRec = NonNullable<InteractionStateItem["recommendation"]>;

async function loadRecommendations(projects: ProjectSummary[]): Promise<Record<string, PlayerRec | null>> {
  const result: Record<string, PlayerRec | null> = {};
  const chunkSize = WORKSHOP_LIMITS.projectBatchMaxIds;
  const chunks: string[][] = [];
  for (let i = 0; i < projects.length; i += chunkSize) {
    chunks.push(projects.slice(i, i + chunkSize).map((project) => project.id));
  }
  const byProject = new Map(projects.map((project) => [project.id, project]));
  const responses = await Promise.all(chunks.map((ids) => api.meState(ids)));
  for (const response of responses) {
    for (const item of response.items) {
      const project = byProject.get(item.projectId);
      const rec =
        project && item.recommendation?.projectVersionId === project.publishedVersionId
          ? (item.recommendation ?? null)
          : null;
      result[item.projectId] = rec;
    }
  }
  return result;
}

export function Subscriptions({
  onOpen,
  onError,
  subscriptionOverrides,
}: {
  onOpen: (project: ProjectSummary, opener: HTMLElement) => void;
  onError: (message: string) => void;
  subscriptionOverrides: Record<string, boolean>;
}) {
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [recommendations, setRecommendations] = useState<Record<string, PlayerRec | null>>({});
  const [search, setSearch] = useState("");
  const [completedReload, setCompletedReload] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const loading = completedReload !== reload;
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let active = true;
    setError(null);
    api
      .subscriptions()
      .then(async (result) => {
        if (!active) return;
        setItems(result.items);
        try {
          const recs = await loadRecommendations(result.items);
          if (active) setRecommendations(recs);
        } catch {
          if (active) setRecommendations({});
        }
      })
      .catch((reason) => {
        if (active) {
          setError(String(reason));
        }
      })
      .finally(() => {
        if (active) setCompletedReload(reload);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  const subscribedItems = useMemo(
    () => items.filter((project) => subscriptionOverrides[project.id] !== false && !removed.has(project.id)),
    [items, removed, subscriptionOverrides],
  );
  const visibleItems = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return subscribedItems.filter((project) => {
      if (!needle) return true;
      return [
        project.title,
        project.description ?? "",
        project.author.name,
        project.projectType,
        ...project.includedTypes,
        ...project.tags,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [subscribedItems, search]);

  async function unsubscribe(project: ProjectSummary): Promise<void> {
    setRemoved((previous) => new Set(previous).add(project.id));
    try {
      await api.setSubscription(project.id, false);
    } catch (reason) {
      setRemoved((previous) => {
        const next = new Set(previous);
        next.delete(project.id);
        return next;
      });
      onError(String(reason));
    }
  }

  return (
    <section className="workspace-section workspace-subscriptions">
      <div className="workspace-heading">
        <div>
          <p className="workspace-kicker">阅读清单</p>
          <h2 tabIndex={-1} data-detail-return>
            我的订阅
          </h2>
          <p className="workspace-muted">项目有新版本时，可以从这里回到详情继续阅读，或直接为喜欢的版本撰写推荐语。</p>
        </div>
      </div>
      <label className="workspace-search workspace-subscription-search" htmlFor="subscription-search">
        <span>搜索订阅</span>
        <input
          id="subscription-search"
          type="search"
          value={search}
          placeholder="标题、作者、标签或类型"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      {loading ? (
        <p className="workspace-state" role="status">
          正在加载订阅…
        </p>
      ) : null}
      {!loading && error ? (
        <div className="workspace-state workspace-error" role="alert">
          <p>订阅加载失败：{error}</p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            重试
          </button>
        </div>
      ) : null}
      {!loading && !error && subscribedItems.length === 0 ? (
        <p className="workspace-state workspace-empty">还没有订阅项目。</p>
      ) : null}
      {!loading && !error && subscribedItems.length > 0 && visibleItems.length === 0 ? (
        <p className="workspace-state">没有符合搜索条件的订阅项目。</p>
      ) : null}
      {!loading && !error && visibleItems.length > 0 ? (
        <div className="subscription-list">
          {visibleItems.map((project) => (
            <SubscriptionRow
              key={project.id}
              project={project}
              recommendation={recommendations[project.id] ?? null}
              onRecommendationChange={(next) => setRecommendations((previous) => ({ ...previous, [project.id]: next }))}
              onOpen={onOpen}
              onUnsubscribe={unsubscribe}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SubscriptionRow({
  project,
  recommendation,
  onRecommendationChange,
  onOpen,
  onUnsubscribe,
}: {
  project: ProjectSummary;
  recommendation: PlayerRec | null;
  onRecommendationChange: (next: PlayerRec | null) => void;
  onOpen: (project: ProjectSummary, opener: HTMLElement) => void;
  onUnsubscribe: (project: ProjectSummary) => Promise<void>;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState(recommendation?.comment ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(recommendation?.comment ?? "");
  }, [recommendation?.comment]);

  async function saveRecommendation(remove: boolean): Promise<void> {
    const projectVersionId = remove ? recommendation?.projectVersionId : project.publishedVersionId;
    if (!projectVersionId || saving) return;
    setSaving(true);
    setStatus(null);
    setSaveError(null);
    const comment = draft.trim();
    try {
      await api.playerRecommendation(project.id, { projectVersionId, ...(remove ? {} : { comment }) }, remove);
      onRecommendationChange(remove ? null : { projectVersionId, comment });
      setDraft(remove ? "" : comment);
      setStatus(remove ? "当前版本推荐已撤回。" : "当前版本推荐已保存。");
      if (remove) setEditorOpen(false);
    } catch (reason) {
      setSaveError(
        reason instanceof ApiError && reason.status === 403
          ? "订阅作品后即可撰写或更新本版推荐。"
          : `保存失败：${String(reason)}`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="subscription-row">
      <button
        type="button"
        className="subscription-cover"
        aria-label={`查看 ${project.title} 详情`}
        onClick={(event) => onOpen(project, event.currentTarget)}
      >
        {project.coverUrl ? (
          <img src={project.coverUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="subscription-cover-placeholder" aria-hidden="true">
            <ImageIcon />
          </span>
        )}
      </button>
      <div className="subscription-copy">
        <h3>
          <button
            type="button"
            className="subscription-title-button"
            onClick={(event) => onOpen(project, event.currentTarget)}
          >
            {project.title}
          </button>
        </h3>
        <p className="workspace-muted">
          {project.author.name} · v{project.versionLabel ?? "未标注"}
          {project.includedTypes.length ? ` · 包含：${project.includedTypes.join("、")}` : ""}
        </p>
        <p className="subscription-date">
          最近更新 {project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : "日期未知"}
          {project.publishedAt ? ` · 发布于 ${new Date(project.publishedAt).toLocaleDateString()}` : ""}
        </p>
        <div className="subscription-tags">
          <span className="project-type-tag" data-type={project.projectType}>
            {project.projectType}
          </span>
          {project.tags
            .filter((tag) => tag !== project.projectType)
            .slice(0, 8)
            .map((tag) => (
              <span key={tag} className="subscription-tag">
                {tag}
              </span>
            ))}
        </div>
        {recommendation && !editorOpen ? (
          <div className="subscription-rec-preview">
            <span className="subscription-rec-badge">
              <Sparkles aria-hidden="true" />
              已推荐当前版本
            </span>
            <p>{recommendation.comment || "已推荐当前版本（未填写推荐说明）"}</p>
          </div>
        ) : null}
        {!editorOpen && status ? (
          <p className="subscription-rec-status" role="status">
            {status}
          </p>
        ) : null}
      </div>
      <div className="subscription-actions">
        <button type="button" className="workspace-primary" onClick={(event) => onOpen(project, event.currentTarget)}>
          打开详情
        </button>
        <button
          type="button"
          aria-expanded={editorOpen}
          disabled={!project.publishedVersionId}
          onClick={() => {
            setEditorOpen((open) => !open);
            setStatus(null);
            setSaveError(null);
          }}
        >
          <MessageSquarePlus aria-hidden="true" />
          {recommendation ? "编辑推荐语" : "写推荐语"}
        </button>
        <button type="button" onClick={() => void onUnsubscribe(project)}>
          取消订阅
        </button>
      </div>
      {editorOpen ? (
        <div className="subscription-rec-editor">
          <label className="subscription-rec-field" htmlFor={`sub-rec-${project.id}`}>
            <span>当前版本公开推荐语（可选，将展示在首页发现与项目详情中）</span>
            <textarea
              id={`sub-rec-${project.id}`}
              rows={2}
              maxLength={2000}
              placeholder="写一句游玩感受或推荐理由（公开展示）"
              value={draft}
              disabled={saving}
              onChange={(event) => {
                setDraft(event.target.value);
                setStatus(null);
                setSaveError(null);
              }}
            />
          </label>
          <div className="subscription-rec-footer">
            <span className="subscription-rec-count">{draft.length} / 2000</span>
            <div className="subscription-rec-buttons">
              <button
                type="button"
                className="workspace-primary"
                disabled={saving || !project.publishedVersionId}
                onClick={() => void saveRecommendation(false)}
              >
                {saving ? "保存中…" : recommendation ? "更新推荐语" : "保存推荐语"}
              </button>
              {recommendation ? (
                <button type="button" disabled={saving} onClick={() => void saveRecommendation(true)}>
                  撤回推荐
                </button>
              ) : null}
              <button type="button" disabled={saving} onClick={() => setEditorOpen(false)}>
                收起
              </button>
            </div>
          </div>
          {status ? (
            <p className="subscription-rec-status" role="status">
              {status}
            </p>
          ) : null}
          {saveError ? (
            <p className="subscription-rec-error" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

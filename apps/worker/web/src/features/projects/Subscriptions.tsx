import { Image as ImageIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, formatUserError, type ProjectSummary } from "../../api";
import "../../styles/workspaces.css";

export function Subscriptions({
  onOpen,
  onError,
  subscriptionOverrides,
  onSubscriptionChange,
}: {
  onOpen: (project: ProjectSummary, opener: HTMLElement) => void;
  onError: (message: string) => void;
  subscriptionOverrides: Record<string, boolean>;
  onSubscriptionChange: (projectId: string, subscribed: boolean) => void;
}) {
  const [items, setItems] = useState<ProjectSummary[]>([]);
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
      .then((result) => {
        if (active) setItems(result.items);
      })
      .catch((reason) => {
        if (active) {
          setError(formatUserError(reason));
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
      onSubscriptionChange(project.id, false);
    } catch (reason) {
      setRemoved((previous) => {
        const next = new Set(previous);
        next.delete(project.id);
        return next;
      });
      onError(formatUserError(reason));
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
          <p className="workspace-muted">项目有新版本时，可以从这里回到详情继续阅读。</p>
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
            <article key={project.id} className="subscription-row">
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
              </div>
              <div className="subscription-actions">
                <button
                  type="button"
                  className="workspace-primary"
                  onClick={(event) => onOpen(project, event.currentTarget)}
                >
                  打开详情
                </button>
                <button type="button" onClick={() => void unsubscribe(project)}>
                  取消订阅
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

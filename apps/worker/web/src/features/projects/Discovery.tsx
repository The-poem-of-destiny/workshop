import { BookOpen, History } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProjectSummary } from "../../api";
import type { HomeLoadState } from "../../useWorkshopHome";
import "../../styles/discovery.css";

function DiscoveryCard({
  project,
  onOpen,
}: {
  project: ProjectSummary;
  onOpen: (project: ProjectSummary, opener: HTMLElement) => void;
}) {
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const hasCover = Boolean(project.coverUrl && project.coverUrl !== failedCoverUrl);
  return (
    <button
      className="discovery-item"
      type="button"
      onClick={(event) => onOpen(project, event.currentTarget)}
      aria-label={`查看 ${project.title}`}
    >
      <span className={`discovery-cover${hasCover ? "" : " discovery-cover-empty"}`}>
        {hasCover ? (
          <img
            key={project.coverUrl}
            src={project.coverUrl!}
            alt=""
            loading="lazy"
            onError={() => setFailedCoverUrl(project.coverUrl)}
            style={{
              objectPosition: `${project.coverPositionX}% ${project.coverPositionY}%`,
              transform: `scale(${project.coverZoom})`,
            }}
          />
        ) : (
          <BookOpen aria-hidden="true" />
        )}
      </span>
      {hasCover ? (
        <span className="discovery-tint" aria-hidden="true">
          <img
            key={project.coverUrl}
            src={project.coverUrl!}
            alt=""
            loading="lazy"
            onError={() => setFailedCoverUrl(project.coverUrl)}
          />
        </span>
      ) : null}
      <span className="discovery-body">
        <strong className="discovery-title">{project.title}</strong>
        <span className="discovery-author">
          {project.author.avatarUrl && project.author.avatarUrl !== failedAvatarUrl ? (
            <img
              key={project.author.avatarUrl}
              src={project.author.avatarUrl}
              alt=""
              loading="lazy"
              onError={() => setFailedAvatarUrl(project.author.avatarUrl)}
            />
          ) : (
            <span className="discovery-avatar-fallback" aria-hidden="true">
              {project.author.name.slice(0, 1)}
            </span>
          )}
          <span>{project.author.name}</span>
        </span>
        <span className="discovery-updated" title="更新">
          <span className="sr-only">更新 </span>
          <History aria-hidden="true" />
          <time dateTime={project.updatedAt}>{project.updatedAt.slice(0, 10)}</time>
        </span>
        <span
          className="discovery-tags"
          title={[project.projectType, project.extensionType, ...project.tags].filter(Boolean).join("、")}
        >
          {[project.projectType, project.extensionType, ...project.tags]
            .filter((value, index, values) => value && values.indexOf(value) === index)
            .slice(0, 3)
            .map((value) => (
              <span key={value} data-type={value === project.projectType ? value : undefined}>
                {value}
              </span>
            ))}
        </span>
        <span className="discovery-note">
          {project.authorNote?.trim() || project.description?.trim() || "暂无文字简介"}
        </span>
      </span>
    </button>
  );
}

const emptyItems: ProjectSummary[] = [];

export function Discovery({
  home,
  onOpen,
}: {
  home: HomeLoadState;
  onOpen: (project: ProjectSummary, opener: HTMLElement) => void;
}) {
  const state =
    home.status === "loading" ? "loading" : home.status === "error" || !home.data.discovery.ok ? "error" : "ready";
  const items = home.status === "ready" && home.data.discovery.ok ? home.data.discovery.data.items : emptyItems;
  const discovered = useMemo(() => {
    const next = [...items];
    for (let index = next.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [next[index], next[swap]] = [next[swap]!, next[index]!];
    }
    return next.slice(0, 4);
  }, [items]);
  if (state === "loading")
    return (
      <section className="discovery" aria-busy="true">
        <h2>发现</h2>
        <p className="hint">正在整理今日发现…</p>
      </section>
    );
  if (state === "error")
    return (
      <section className="discovery">
        <h2>发现</h2>
        <p className="hint">暂时无法加载发现内容，主列表不受影响。</p>
      </section>
    );
  if (!discovered.length) return null;
  return (
    <section className="discovery">
      <h2>发现</h2>
      <div className="discovery-grid">
        {discovered.map((project) => (
          <DiscoveryCard key={project.id} project={project} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

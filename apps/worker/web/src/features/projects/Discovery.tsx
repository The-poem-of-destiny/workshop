import { BookOpen, ChevronLeft, ChevronRight, History, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { DiscoveryResponse, ProjectSummary } from "../../api";
import type { HomeLoadState } from "../../useWorkshopHome";
import "../../styles/discovery.css";

type DiscoveryProject = DiscoveryResponse["items"][number];

function DiscoveryBackdrop({ coverUrl }: { coverUrl: string | null }) {
  const [layers, setLayers] = useState<{ current: string | null; previous: string | null }>({
    current: null,
    previous: null,
  });
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const clearPrevious = () => {
      if (preference.matches) {
        setLayers((current) => (current.previous ? { ...current, previous: null } : current));
      }
    };
    preference.addEventListener("change", clearPrevious);
    return () => preference.removeEventListener("change", clearPrevious);
  }, []);
  useEffect(() => {
    let active = true;
    function show(url: string | null) {
      if (!active) return;
      setLayers((current) =>
        current.current === url
          ? current
          : {
              current: url,
              previous: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? null : current.current,
            },
      );
    }
    if (!coverUrl) {
      show(null);
      return;
    }
    const image = new Image();
    image.decoding = "async";
    image.onload = () => show(coverUrl);
    image.onerror = () => show(null);
    image.src = coverUrl;
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [coverUrl]);
  return (
    <div className="discovery-tint" aria-hidden="true">
      {layers.previous ? (
        <img
          key={`previous-${layers.previous}`}
          className="discovery-tint-previous"
          src={layers.previous}
          alt=""
          onAnimationEnd={() => setLayers((current) => ({ ...current, previous: null }))}
        />
      ) : null}
      {layers.current ? <img key={layers.current} src={layers.current} alt="" /> : null}
    </div>
  );
}

function Cover({ project }: { project: ProjectSummary }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span className="discovery-cover">
      {project.coverUrl && project.coverUrl !== failedUrl ? (
        <img
          src={project.coverUrl}
          alt=""
          loading="lazy"
          onError={() => setFailedUrl(project.coverUrl)}
          style={{
            objectPosition: `${project.coverPositionX ?? 50}% ${project.coverPositionY ?? 50}%`,
            transform: `scale(${project.coverZoom ?? 1})`,
          }}
        />
      ) : (
        <BookOpen aria-hidden="true" />
      )}
    </span>
  );
}

// Bound the preview before rendering: full descriptions belong in project details.
function excerpt(text: string | null, limit = 180) {
  const plain = text
    ?.replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "暂无项目简介，打开详情了解更多。";
  return plain.length > limit ? `${plain.slice(0, limit).trimEnd()}…` : plain;
}

function DiscoveryRecommendations({ recommendations }: { recommendations: DiscoveryProject["recommendations"] }) {
  const [index, setIndex] = useState(0);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const currentIndex = Math.min(index, Math.max(0, recommendations.length - 1));
  const recommendation = recommendations[currentIndex];
  if (!recommendation) return null;
  const { curator, comment } = recommendation;
  return (
    <section className="discovery-recommendation" aria-label="玩家推荐">
      <header className="discovery-recommendation-heading">
        <span>玩家推荐</span>
        {recommendations.length > 1 ? (
          <div className="discovery-recommendation-navigation">
            <span aria-live="polite">
              {currentIndex + 1} / {recommendations.length}
            </span>
            <button
              type="button"
              aria-label="上一条玩家推荐"
              onClick={() => setIndex((currentIndex - 1 + recommendations.length) % recommendations.length)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="下一条玩家推荐"
              onClick={() => setIndex((currentIndex + 1) % recommendations.length)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </header>
      <div className="discovery-recommender">
        <span className="discovery-recommender-avatar" aria-hidden="true">
          {curator.avatarUrl && curator.avatarUrl !== failedAvatar ? (
            <img src={curator.avatarUrl} alt="" onError={() => setFailedAvatar(curator.avatarUrl)} />
          ) : (
            curator.name.slice(0, 1)
          )}
        </span>
        <span>{curator.name}</span>
      </div>
      <blockquote key={recommendation.id}>{comment.trim()}</blockquote>
    </section>
  );
}

function DiscoveryBrowser({
  items,
  onOpen,
}: {
  items: DiscoveryProject[];
  onOpen: (project: ProjectSummary, opener: HTMLElement) => void;
}) {
  const [selectedId, setSelectedId] = useState(items[0]!.id);
  const [failedAuthorAvatar, setFailedAuthorAvatar] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const panelId = useId();
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === selectedId),
  );
  const project = items[selectedIndex]!;
  function select(index: number, focus = false) {
    const item = items[(index + items.length) % items.length]!;
    setSelectedId(item.id);
    const button = buttons.current.get(item.id);
    if (focus) button?.focus({ preventScroll: true });
    if (button?.parentElement) {
      const directory = button.parentElement;
      const bounds = button.getBoundingClientRect();
      const directoryBounds = directory.getBoundingClientRect();
      const top = bounds.top - directoryBounds.top + directory.scrollTop;
      const left = bounds.left - directoryBounds.left + directory.scrollLeft;
      let scrollTop = directory.scrollTop;
      let scrollLeft = directory.scrollLeft;
      if (top < scrollTop) scrollTop = top;
      else if (top + button.offsetHeight > scrollTop + directory.clientHeight)
        scrollTop = top + button.offsetHeight - directory.clientHeight;
      if (left < scrollLeft) scrollLeft = left;
      else if (left + button.offsetWidth > scrollLeft + directory.clientWidth)
        scrollLeft = left + button.offsetWidth - directory.clientWidth;
      directory.scrollTo({
        top: scrollTop,
        left: scrollLeft,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    }
  }
  return (
    <section className="discovery" aria-labelledby={`${panelId}-heading`}>
      <DiscoveryBackdrop coverUrl={project.coverUrl} />
      <header className="discovery-heading">
        <h2 id={`${panelId}-heading`}>发现</h2>
        <span className="discovery-caption">试试看~</span>
        <div className="discovery-navigation">
          <span aria-live="polite" aria-atomic="true">
            {selectedIndex + 1} / {items.length}
          </span>
          <button
            type="button"
            aria-label="上一个发现项目"
            disabled={items.length < 2}
            onClick={() => select(selectedIndex - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="下一个发现项目"
            disabled={items.length < 2}
            onClick={() => select(selectedIndex + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="discovery-layout">
        <div
          className="discovery-directory"
          role="tablist"
          aria-label="发现项目"
          aria-orientation={compact ? "horizontal" : "vertical"}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${panelId}-tab-${index}`}
              aria-selected={item.id === project.id}
              aria-controls={`${panelId}-detail`}
              tabIndex={item.id === project.id ? 0 : -1}
              ref={(node) => {
                if (node) buttons.current.set(item.id, node);
                else buttons.current.delete(item.id);
              }}
              className="discovery-directory-item"
              onClick={() => select(index)}
              onKeyDown={(event) => {
                const offset =
                  event.key === "ArrowDown" || event.key === "ArrowRight"
                    ? 1
                    : event.key === "ArrowUp" || event.key === "ArrowLeft"
                      ? -1
                      : 0;
                if (offset || event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  select(event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : index + offset, true);
                }
              }}
            >
              <Cover project={item} />
              <span className="discovery-directory-text">
                <strong>{item.title}</strong>
                <small>{item.author.name}</small>
              </span>
            </button>
          ))}
        </div>
        <div
          key={project.id}
          className="discovery-detail"
          id={`${panelId}-detail`}
          role="tabpanel"
          aria-labelledby={`${panelId}-tab-${selectedIndex}`}
        >
          <div className="discovery-visual">
            <button
              type="button"
              className="discovery-main-image"
              onClick={(event) => onOpen(project, event.currentTarget)}
              aria-label={`查看 ${project.title} 详情`}
            >
              <Cover project={project} />
              <span className="discovery-image-link">查看详情 ↗</span>
            </button>
          </div>
          <div className="discovery-copy" key={project.id}>
            <div className="discovery-copy-content">
              <span className="discovery-type" data-type={project.projectType}>
                {project.projectType}
              </span>
              <h3>
                <button type="button" onClick={(event) => onOpen(project, event.currentTarget)}>
                  {project.title}
                </button>
              </h3>
              <p className="discovery-author">
                <span className="discovery-author-avatar" aria-hidden="true">
                  {project.author.avatarUrl && project.author.avatarUrl !== failedAuthorAvatar ? (
                    <img
                      src={project.author.avatarUrl}
                      alt=""
                      onError={() => setFailedAuthorAvatar(project.author.avatarUrl)}
                    />
                  ) : (
                    project.author.name.slice(0, 1)
                  )}
                </span>
                <span>{project.author.name}</span>
              </p>
              <p className="discovery-description">{excerpt(project.description)}</p>
              <div className="discovery-dates">
                {project.publishedAt ? (
                  <span>
                    <Upload aria-hidden="true" />
                    <span>首次上传 </span>
                    <time dateTime={project.publishedAt}>{project.publishedAt.slice(0, 10)}</time>
                  </span>
                ) : null}
                <span>
                  <History aria-hidden="true" />
                  <span>更新 </span>
                  <time dateTime={project.updatedAt}>{project.updatedAt.slice(0, 10)}</time>
                </span>
              </div>
              <DiscoveryRecommendations key={project.id} recommendations={project.recommendations} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Discovery({
  home,
  onOpen,
}: {
  home: HomeLoadState;
  onOpen: (project: ProjectSummary, opener: HTMLElement) => void;
}) {
  if (home.status === "loading")
    return (
      <section className="discovery discovery-status" aria-busy="true">
        <h2>发现</h2>
        <p className="hint">正在整理发现内容…</p>
      </section>
    );
  if (home.status === "error" || !home.data.discovery.ok)
    return (
      <section className="discovery discovery-status">
        <h2>发现</h2>
        <p className="hint">暂时无法加载发现内容，主列表不受影响。</p>
      </section>
    );
  const items = home.data.discovery.data.items;
  if (!items.length)
    return (
      <section className="discovery discovery-status">
        <h2>发现</h2>
        <p className="hint">暂无可展示的发现项目，可继续浏览下方主列表。</p>
      </section>
    );
  return <DiscoveryBrowser items={items} onOpen={onOpen} />;
}

import { Bookmark, Download, History, MoreHorizontal, ThumbsUp, Upload } from "lucide-react";
import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "../../api";

export function ProjectCard({
  project,
  onOpen,
  layout = "cards",
}: {
  project: ProjectSummary;
  layout?: "cards" | "list";
  onOpen: (p: ProjectSummary, opener: HTMLElement) => void;
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function dismiss(event: globalThis.PointerEvent | KeyboardEvent): void {
      const menu = menuRef.current;
      if (!menu) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        menu.querySelector("summary")?.focus();
      } else if (event.target instanceof Node && menu.contains(event.target)) return;
      menu.open = false;
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [menuOpen]);
  function tilt(event: PointerEvent<HTMLElement>): void {
    if (
      layout === "list" ||
      menuOpen ||
      event.pointerType !== "mouse" ||
      !window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches
    )
      return;
    const card = event.currentTarget;
    const bounds = card.getBoundingClientRect();
    const x = Math.max(-0.5, Math.min(0.5, (event.clientX - bounds.left - bounds.width / 2) / card.offsetWidth));
    const y = Math.max(-0.5, Math.min(0.5, (event.clientY - bounds.top - bounds.height / 2) / card.offsetHeight));
    card.style.setProperty("--tilt-x", `${-y * 10}deg`);
    card.style.setProperty("--tilt-y", `${x * 10}deg`);
  }
  function resetTilt(event: PointerEvent<HTMLElement>): void {
    event.currentTarget.removeAttribute("style");
  }
  const open = (event: MouseEvent<HTMLElement>): void => onOpen(project, event.currentTarget);
  const preview = project.authorNote?.trim() || project.description?.trim() || "暂无文字简介";
  const moreMenu = (
    <details className="card-more" ref={menuRef} onToggle={(event) => setMenuOpen(event.currentTarget.open)}>
      <summary title="更多" aria-label={`${project.title}：更多`}>
        <MoreHorizontal aria-hidden="true" />
      </summary>
      <div className="card-more-actions">
        <button
          type="button"
          onClick={() => {
            const menu = menuRef.current;
            if (!menu) return;
            menu.open = false;
            const trigger = menu.querySelector("summary");
            if (trigger) onOpen(project, trigger);
          }}
        >
          查看详情
        </button>
        {project.discordThreadUrl ? (
          <a href={project.discordThreadUrl} target="_blank" rel="noreferrer">
            Discord
          </a>
        ) : null}
      </div>
    </details>
  );
  return (
    <article
      className={`card project-card--${layout}`}
      onPointerMove={tilt}
      onPointerLeave={resetTilt}
      onPointerCancel={resetTilt}
    >
      <div className={`card-media${project.coverUrl ? "" : " card-media-empty"}`}>
        {project.coverUrl ? (
          <button className="card-cover-button" type="button" onClick={open} aria-label={`查看 ${project.title}`}>
            <span className="cover">
              <img
                src={project.coverUrl}
                alt=""
                loading="lazy"
                style={{
                  objectPosition: `${project.coverPositionX}% ${project.coverPositionY}%`,
                  transform: `scale(${project.coverZoom})`,
                }}
              />
            </span>
          </button>
        ) : null}
        {layout === "cards" ? moreMenu : null}
        {layout === "cards" ? (
          <div className="card-content-counts">
            <span>世界书 {project.entries.worldbook}</span>
            <span>正则 {project.entries.regex}</span>
            {project.versionLabel ? (
              <span className="card-version" title={`版本 ${project.versionLabel}`}>
                {project.versionLabel}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {layout === "cards" && project.coverUrl ? (
        <div className="card-tint" aria-hidden="true">
          <img src={project.coverUrl} alt="" loading="lazy" />
        </div>
      ) : null}
      <div className="card-body">
        <div className="card-title-row">
          <h3>
            <button className="card-title" type="button" onClick={open}>
              {project.title}
            </button>
          </h3>
          {layout === "list" ? moreMenu : null}
        </div>
        <p className="byline">
          {project.author.avatarUrl && !avatarFailed ? (
            <img src={project.author.avatarUrl} alt="" loading="lazy" onError={() => setAvatarFailed(true)} />
          ) : (
            <span className="avatar-fallback">{project.author.name.slice(0, 1)}</span>
          )}
          <span>{project.author.name}</span>
        </p>
        <p className="card-note">{preview}</p>
        <div
          className="tags"
          title={[project.projectType, project.extensionType, ...project.tags].filter(Boolean).join("、")}
        >
          {project.projectType ? (
            <span className="project-type-tag" data-type={project.projectType}>
              {project.projectType}
            </span>
          ) : null}
          {project.extensionType ? <span>{project.extensionType}</span> : null}
          {project.tags
            .filter((tag) => tag !== project.projectType)
            .map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
        </div>
      </div>
      <div className="card-footer">
        <div className="card-signals">
          <div className="card-stat-group">
            <span title={`下载 ${project.counts.downloads.toLocaleString("zh-CN")}`}>
              <Download className="card-stat-icon" aria-hidden="true" />
              <span className="sr-only">下载</span>
              <strong>
                {project.counts.downloads.toLocaleString("zh-CN", { notation: "compact", maximumFractionDigits: 1 })}
              </strong>
            </span>
            <span title={`点赞 ${project.counts.likes.toLocaleString("zh-CN")}`}>
              <ThumbsUp className="card-stat-icon" aria-hidden="true" />
              <span className="sr-only">点赞</span>
              <strong>
                {project.counts.likes.toLocaleString("zh-CN", { notation: "compact", maximumFractionDigits: 1 })}
              </strong>
            </span>
            <span title={`订阅 ${project.counts.subscriptions.toLocaleString("zh-CN")}`}>
              <Bookmark className="card-stat-icon" aria-hidden="true" />
              <span className="sr-only">订阅</span>
              <strong>
                {project.counts.subscriptions.toLocaleString("zh-CN", {
                  notation: "compact",
                  maximumFractionDigits: 1,
                })}
              </strong>
            </span>
          </div>
          {project.schemaVersion ? <span className="card-compatibility">适配 {project.schemaVersion}</span> : null}
          <div className="card-dates">
            <span title="更新">
              <i className="sr-only">更新 </i>
              <History aria-hidden="true" />
              <time dateTime={project.updatedAt}>{project.updatedAt.slice(0, 10)}</time>
            </span>
            {project.publishedAt ? (
              <span title="初次上传">
                <i className="sr-only">初次上传 </i>
                <Upload aria-hidden="true" />
                <time dateTime={project.publishedAt}>{project.publishedAt.slice(0, 10)}</time>
              </span>
            ) : null}
          </div>
          {layout === "list" && project.versionLabel ? (
            <span className="list-version" title={`版本 ${project.versionLabel}`}>
              {project.versionLabel}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

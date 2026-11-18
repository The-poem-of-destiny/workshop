import { MAX_DISPLAY_TAGS } from "@workshop/domain";
import { Bookmark, BookOpen, Download, History, MoreHorizontal, ThumbsUp } from "lucide-react";
import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "../../api";

import type { DiscordPromptTarget } from "../policy/DiscordLinkPrompt";

function UploadDateIcon() {
  return (
    <svg
      className="card-date-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}

function cleanExcerpt(text: string | null | undefined): string {
  const plain = text
    ?.replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain || "暂无简介";
}

export function ProjectCard({
  project,
  onOpen,
  onAuthor,
  onDiscordPrompt,
  layout = "cards",
}: {
  project: ProjectSummary;
  layout?: "cards" | "list";
  onOpen: (p: ProjectSummary, opener: HTMLElement) => void;
  onAuthor?: (author: { id: string; name: string }) => void;
  onDiscordPrompt?: (target: DiscordPromptTarget) => void;
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const hasCover = Boolean(project.coverUrl && project.coverUrl !== failedCoverUrl);
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
    card.style.setProperty("--tilt-x", `${-y * 6}deg`);
    card.style.setProperty("--tilt-y", `${x * 6}deg`);
  }
  function resetTilt(event: PointerEvent<HTMLElement>): void {
    event.currentTarget.removeAttribute("style");
  }
  const open = (event: MouseEvent<HTMLElement>): void => onOpen(project, event.currentTarget);
  const preview = cleanExcerpt(project.description);
  const cardTags = project.tags.filter((tag) => tag !== project.projectType).slice(0, MAX_DISPLAY_TAGS);
  const updatedDate = project.updatedAt.slice(0, 10);
  const updatedShort = project.updatedAt.slice(5, 10);
  const publishedIso = project.publishedAt || project.updatedAt;
  const publishedDate = publishedIso.slice(0, 10);
  const publishedShort = publishedIso.slice(5, 10);

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
          <a
            href={project.discordThreadUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              if (!onDiscordPrompt || !project.discordThreadUrl) return;
              event.preventDefault();
              if (menuRef.current) menuRef.current.open = false;
              onDiscordPrompt({ projectTitle: project.title, threadUrl: project.discordThreadUrl });
            }}
          >
            Discord 讨论
          </a>
        ) : null}
      </div>
    </details>
  );

  const authorNode = onAuthor ? (
    <button
      type="button"
      className="byline byline-button"
      title={`查看 ${project.author.name} 的全部公开作品`}
      onClick={() => onAuthor(project.author)}
    >
      {project.author.avatarUrl && !avatarFailed ? (
        <img src={project.author.avatarUrl} alt="" loading="lazy" onError={() => setAvatarFailed(true)} />
      ) : (
        <span className="avatar-fallback">{project.author.name.slice(0, 1)}</span>
      )}
      <span>{project.author.name}</span>
    </button>
  ) : (
    <p className="byline">
      {project.author.avatarUrl && !avatarFailed ? (
        <img src={project.author.avatarUrl} alt="" loading="lazy" onError={() => setAvatarFailed(true)} />
      ) : (
        <span className="avatar-fallback">{project.author.name.slice(0, 1)}</span>
      )}
      <span>{project.author.name}</span>
    </p>
  );

  return (
    <article
      className={`card project-card--${layout}`}
      onPointerMove={tilt}
      onPointerLeave={resetTilt}
      onPointerCancel={resetTilt}
    >
      <div className={`card-media${hasCover ? "" : " card-media-empty"}`}>
        <button className="card-cover-button" type="button" onClick={open} aria-label={`查看 ${project.title}`}>
          <span className={`cover${hasCover ? "" : " cover-placeholder"}`}>
            {hasCover ? (
              <img
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
        </button>
        {layout === "cards" ? moreMenu : null}
        {layout === "cards" ? (
          <div className="card-content-counts">
            <span>世界书 {project.entries.worldbook}</span>
            {project.entries.regex > 0 ? <span>正则 {project.entries.regex}</span> : null}
            <span className="card-version">
              {project.schemaVersion ? `适配 ${project.schemaVersion}` : ""}
              {project.schemaVersion && project.versionLabel ? " · " : ""}
              {project.versionLabel ? `v${project.versionLabel.replace(/^v/i, "")}` : ""}
            </span>
          </div>
        ) : null}
      </div>
      {layout === "cards" && hasCover ? (
        <div className="card-tint" aria-hidden="true">
          <img src={project.coverUrl ?? undefined} alt="" loading="lazy" />
        </div>
      ) : null}
      <div className="card-body">
        <div className="card-title-row">
          {layout === "list" && project.projectType ? (
            <span className="project-type-tag list-inline-type" data-type={project.projectType}>
              {project.projectType}
            </span>
          ) : null}
          <h3>
            <button className="card-title" type="button" onClick={open}>
              {project.title}
            </button>
          </h3>
          {layout === "list" && project.versionLabel ? (
            <span className="list-version-pill">v{project.versionLabel.replace(/^v/i, "")}</span>
          ) : null}
        </div>
        <div className="card-meta-row">
          {authorNode}
          {layout === "cards" ? (
            <time
              className="card-date-chip card-date-updated"
              dateTime={project.updatedAt}
              title={`最近更新：${updatedDate}`}
            >
              <History className="card-date-icon" aria-hidden="true" />
              <span className="date-full">{updatedDate}</span>
              <span className="date-short">{updatedShort}</span>
            </time>
          ) : (
            <div className="tags list-inline-tags" title={[project.projectType, ...project.tags].join("、")}>
              {cardTags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          )}
        </div>
        <p className={`card-note${layout === "list" ? " list-note" : ""}`}>{preview}</p>
        {layout === "cards" ? (
          <div className="tags" title={[project.projectType, ...project.tags].join("、")}>
            {project.projectType ? (
              <span className="project-type-tag" data-type={project.projectType}>
                {project.projectType}
              </span>
            ) : null}
            {cardTags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="card-footer">
        <div className="card-signals">
          {layout === "list" ? (
            <span className="list-entry-counts">
              世界书 {project.entries.worldbook} · 正则 {project.entries.regex}
            </span>
          ) : null}
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
          {layout === "cards" ? (
            <time
              className="card-date-chip card-date-published"
              dateTime={publishedIso}
              title={`首次上传：${publishedDate}`}
            >
              <UploadDateIcon />
              <span className="date-full">{publishedDate}</span>
              <span className="date-short">{publishedShort}</span>
            </time>
          ) : null}
          {layout === "list" ? moreMenu : null}
        </div>
        {layout === "list" ? (
          <div className="list-dates-row">
            <time
              className="card-date-chip list-date-item"
              dateTime={project.updatedAt}
              title={`最近更新：${updatedDate}`}
            >
              <History className="card-date-icon" aria-hidden="true" />
              <span className="date-full">更新 {updatedDate}</span>
              <span className="date-short">{updatedShort}</span>
            </time>
            <time
              className="card-date-chip list-date-item"
              dateTime={publishedIso}
              title={`首次上传：${publishedDate}`}
            >
              <UploadDateIcon />
              <span className="date-full">首传 {publishedDate}</span>
              <span className="date-short">{publishedShort}</span>
            </time>
          </div>
        ) : null}
      </div>
    </article>
  );
}

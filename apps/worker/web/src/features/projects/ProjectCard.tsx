import { MAX_DISPLAY_TAGS } from "@workshop/domain";
import { Bookmark, BookOpen, Check, Code2, Download, History, MoreHorizontal, ThumbsUp } from "lucide-react";
import { type MouseEvent, memo, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSummary } from "../../api";
import { plainMarkdownExcerpt } from "../../lib/markdown";

import type { DiscordPromptTarget } from "../policy/DiscordLinkPrompt";
import type { InstallState } from "./ProjectDetail";
import { ProjectTypeIcon } from "./projectTypeIcons";

const FULL_NUM_FMT = new Intl.NumberFormat("zh-CN");
const COMPACT_NUM_FMT = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const TILT_MEDIA_QUERY = "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

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

const cleanExcerpt = (text: string | null | undefined) => plainMarkdownExcerpt(text, "暂无简介");

export const ProjectCard = memo(function ProjectCard({
  project,
  onOpen,
  onAuthor,
  onDiscordPrompt,
  layout = "cards",
  subscribed = false,
  installState = "notInstalled",
}: {
  project: ProjectSummary;
  layout?: "cards" | "list";
  subscribed?: boolean;
  installState?: InstallState;
  onOpen: (p: ProjectSummary, opener: HTMLElement) => void;
  onAuthor?: (author: { id: string; name: string }) => void;
  onDiscordPrompt?: (target: DiscordPromptTarget) => void;
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const hasCover = Boolean(project.coverUrl && project.coverUrl !== failedCoverUrl);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const tiltBoundsRef = useRef<DOMRect | null>(null);
  const tiltRafRef = useRef<number>(0);
  const tiltEnabledRef = useRef<boolean>(false);
  useEffect(() => {
    return () => {
      if (tiltRafRef.current) cancelAnimationFrame(tiltRafRef.current);
    };
  }, []);
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
  function enterTilt(event: PointerEvent<HTMLElement>): void {
    if (layout === "list" || menuOpen || event.pointerType !== "mouse") {
      tiltEnabledRef.current = false;
      return;
    }
    tiltEnabledRef.current = window.matchMedia(TILT_MEDIA_QUERY).matches;
    if (!tiltEnabledRef.current) return;
    tiltBoundsRef.current = event.currentTarget.getBoundingClientRect();
  }
  function tilt(event: PointerEvent<HTMLElement>): void {
    if (!tiltEnabledRef.current || layout === "list" || menuOpen || event.pointerType !== "mouse") return;
    const card = event.currentTarget;
    const bounds = tiltBoundsRef.current ?? card.getBoundingClientRect();
    tiltBoundsRef.current = bounds;
    const x = Math.max(-0.5, Math.min(0.5, (event.clientX - bounds.left - bounds.width / 2) / bounds.width));
    const y = Math.max(-0.5, Math.min(0.5, (event.clientY - bounds.top - bounds.height / 2) / bounds.height));
    if (tiltRafRef.current) cancelAnimationFrame(tiltRafRef.current);
    tiltRafRef.current = requestAnimationFrame(() => {
      tiltRafRef.current = 0;
      card.classList.add("is-tilting");
      card.style.setProperty("--tilt-x", `${(-y * 6).toFixed(2)}deg`);
      card.style.setProperty("--tilt-y", `${(x * 6).toFixed(2)}deg`);
    });
  }
  function resetTilt(event: PointerEvent<HTMLElement>): void {
    tiltEnabledRef.current = false;
    tiltBoundsRef.current = null;
    if (tiltRafRef.current) {
      cancelAnimationFrame(tiltRafRef.current);
      tiltRafRef.current = 0;
    }
    event.currentTarget.classList.remove("is-tilting");
    event.currentTarget.removeAttribute("style");
  }
  const open = (event: MouseEvent<HTMLElement>): void => onOpen(project, event.currentTarget);
  const preview = useMemo(() => cleanExcerpt(project.description), [project.description]);
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
        <img
          src={project.author.avatarUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setAvatarFailed(true)}
        />
      ) : (
        <span className="avatar-fallback">{project.author.name.slice(0, 1)}</span>
      )}
      <span>{project.author.name}</span>
    </button>
  ) : (
    <p className="byline">
      {project.author.avatarUrl && !avatarFailed ? (
        <img
          src={project.author.avatarUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setAvatarFailed(true)}
        />
      ) : (
        <span className="avatar-fallback">{project.author.name.slice(0, 1)}</span>
      )}
      <span>{project.author.name}</span>
    </p>
  );

  return (
    <article
      className={`card project-card--${layout}${subscribed ? " is-subscribed" : ""}`}
      data-type={project.projectType ?? undefined}
      onPointerEnter={enterTilt}
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
                decoding="async"
                onError={() => setFailedCoverUrl(project.coverUrl)}
                style={{
                  objectPosition: `${project.coverPositionX}% ${project.coverPositionY}%`,
                  transform: `scale(${project.coverZoom})`,
                }}
              />
            ) : (
              <span className="cover-placeholder-emblem" aria-hidden="true">
                <ProjectTypeIcon type={project.projectType} />
              </span>
            )}
          </span>
        </button>
        {installState === "upToDate" || installState === "updateAvailable" || installState === "localChanged" ? (
          <span
            className={`card-install-badge card-install-badge--${installState}`}
            title={
              installState === "updateAvailable"
                ? "有可安装的新版本"
                : installState === "localChanged"
                  ? "已安装（本地有修改）"
                  : "已安装到酒馆"
            }
          >
            {installState === "updateAvailable" ? (
              <>
                <span className="card-install-dot" aria-hidden="true" />
                <span>可更新</span>
              </>
            ) : installState === "localChanged" ? (
              <>
                <Check aria-hidden="true" />
                <span>已安装 · 已改</span>
              </>
            ) : (
              <>
                <Check aria-hidden="true" />
                <span>已安装</span>
              </>
            )}
          </span>
        ) : null}
        {subscribed ? (
          <span className="card-subscribed-ribbon" title="已订阅">
            <svg viewBox="0 0 16 28" fill="none" aria-hidden="true">
              <path d="M0.5 0H15.5V26L8 20.5L0.5 26V0Z" fill="#d4ae6a" />
              <path d="M0.5 26L8 20.5L15.5 26" stroke="#755522" strokeWidth="2.6" strokeLinejoin="miter" />
            </svg>
            <span className="sr-only">已订阅</span>
          </span>
        ) : null}
        {layout === "cards" ? moreMenu : null}
        {layout === "cards" ? (
          <div className="card-content-counts">
            <span className="card-count-item">
              <BookOpen className="card-count-icon" aria-hidden="true" />
              世界书 {project.entries.worldbook}
            </span>
            {project.entries.regex > 0 ? (
              <span className="card-count-item">
                <Code2 className="card-count-icon" aria-hidden="true" />
                正则 {project.entries.regex}
              </span>
            ) : null}
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
          <img src={project.coverUrl ?? undefined} alt="" loading="lazy" decoding="async" />
        </div>
      ) : null}
      <div className="card-body">
        <div className="card-title-row">
          {layout === "list" && project.projectType ? (
            <span className="project-type-tag list-inline-type" data-type={project.projectType}>
              <ProjectTypeIcon type={project.projectType} className="project-type-icon" />
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
                <ProjectTypeIcon type={project.projectType} className="project-type-icon" />
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
            <span title={`下载 ${FULL_NUM_FMT.format(project.counts.downloads)}`}>
              <Download className="card-stat-icon" aria-hidden="true" />
              <span className="sr-only">下载</span>
              <strong>{COMPACT_NUM_FMT.format(project.counts.downloads)}</strong>
            </span>
            <span title={`点赞 ${FULL_NUM_FMT.format(project.counts.likes)}`}>
              <ThumbsUp className="card-stat-icon" aria-hidden="true" />
              <span className="sr-only">点赞</span>
              <strong>{COMPACT_NUM_FMT.format(project.counts.likes)}</strong>
            </span>
            <span title={`订阅 ${FULL_NUM_FMT.format(project.counts.subscriptions)}`}>
              <Bookmark className="card-stat-icon" aria-hidden="true" />
              <span className="sr-only">订阅</span>
              <strong>{COMPACT_NUM_FMT.format(project.counts.subscriptions)}</strong>
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
});

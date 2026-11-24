import type { ProjectType } from "@workshop/domain";
import {
  ArrowLeft,
  Bookmark,
  BookOpen,
  Code2,
  Download,
  FolderOpen,
  GitBranch,
  Heart,
  PanelRightClose,
  PanelRightOpen,
  RefreshCcw,
} from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { api, formatUserError, type ProjectDetail as ProjectDetailResponse, type ProjectSummary } from "../../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Markdown } from "../../lib/markdown";
import { prefetchTurnstileToken } from "../../lib/turnstile";
import type { DiscordPromptTarget } from "../policy/DiscordLinkPrompt";
import { ProjectCommunity } from "./ProjectCommunity";
import { ProjectExperienceNotes } from "./ProjectExperienceNotes";
import { ProjectMedia } from "./ProjectMedia";
import { ProjectRequirements } from "./ProjectRequirements";
import { ProjectSourcePreview } from "./ProjectSourcePreview";

export type InstallState = "notInstalled" | "upToDate" | "updateAvailable" | "localChanged" | "scanIncomplete";
const installLabels: Record<InstallState, string> = {
  notInstalled: "安装",
  upToDate: "已是最新",
  updateAvailable: "更新",
  localChanged: "预览更新（替换）",
  scanIncomplete: "修复安装",
};

export function ProjectDetail({
  project,
  onClose,
  onInstall,
  onUpdate,
  onUninstall,
  onAuthor,
  onCollection,
  onDiscordPrompt,
  onTag,
  onProjectType,
  onLogin,
  onError,
  onSubscriptionChange,
  installState,
  loggedIn,
  installing,
  installBlock,
  installedWorldbook,
  opener,
}: {
  project: ProjectSummary;
  onClose: () => void;
  onInstall: (p: ProjectSummary) => void;
  onUpdate: (p: ProjectSummary) => void;
  onUninstall: (p: ProjectSummary) => void;
  onAuthor: (author: { id: string; name: string }) => void;
  onCollection?: (collection: { id: string; title: string }) => void;
  onDiscordPrompt?: (target: DiscordPromptTarget) => void;
  onTag: (tag: string) => void;
  onProjectType: (type: ProjectType) => void;
  onLogin: () => void;
  onError: (message: string) => void;
  onSubscriptionChange: (projectId: string, subscribed: boolean) => void;
  installState: InstallState;
  loggedIn: boolean;
  installing: boolean;
  installBlock: string | null;
  installedWorldbook: string | null;
  opener: RefObject<HTMLElement | null>;
}) {
  const [detail, setDetail] = useState<ProjectDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailReload, setDetailReload] = useState(0);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const [selectedMedia, setSelectedMedia] = useState(0);
  const [railCollapsed, setRailCollapsed] = useState(false);

  const detailRequest = useRef<{ generation: number } | null>(null);
  useEffect(() => {
    let active = true;
    const request = { generation: detailReload };
    detailRequest.current = request;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setSelectedMedia(0);
    api
      .project(project.id)
      .then((value) => {
        if (!active || detailRequest.current !== request) return;
        setDetail(value);
        setDetailLoading(false);
      })
      .catch((reason) => {
        if (!active || detailRequest.current !== request) return;
        setDetailLoading(false);
        setDetailError(formatUserError(reason));
      });
    return () => {
      active = false;
    };
  }, [detailReload, project.id]);

  useEffect(() => {
    if (loggedIn) {
      void prefetchTurnstileToken();
    }
  }, [loggedIn]);

  const versionLabel = detail?.versionLabel ?? project.versionLabel ?? null;
  const projectType = detail?.projectType ?? project.projectType;
  const includedTypes = detail?.includedTypes ?? project.includedTypes;
  const tags = detail?.tags ?? project.tags;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="detail mobile-sheet"
        aria-modal="true"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.querySelector<HTMLButtonElement>(".detail .mobile-sheet-back, .detail .close")?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = opener.current?.isConnected
            ? opener.current
            : document.querySelector<HTMLElement>("[data-detail-return], .list-range");
          target?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="detail-header">
          <div className="detail-header-top">
            <button type="button" className="mobile-sheet-back" onClick={onClose}>
              <ArrowLeft aria-hidden="true" />
              <span>返回</span>
            </button>
            <DialogTitle>{project.title}</DialogTitle>
            <button
              type="button"
              className="detail-rail-toggle"
              aria-expanded={!railCollapsed}
              aria-controls="detail-summary-rail"
              title={railCollapsed ? "展开右侧信息栏" : "收起右侧信息栏"}
              onClick={() => setRailCollapsed((value) => !value)}
            >
              {railCollapsed ? <PanelRightOpen aria-hidden="true" /> : <PanelRightClose aria-hidden="true" />}
              <span>{railCollapsed ? "展开信息栏" : "收起信息栏"}</span>
            </button>
          </div>
          <DialogDescription className="sr-only">项目详情</DialogDescription>
        </DialogHeader>
        <div className="detail-body">
          <div className="detail-taxonomy-block">
            <div className="detail-taxonomy-strip">
              <section className="detail-meta-line" aria-label="项目分类">
                <button
                  type="button"
                  className="detail-badge project-type-tag"
                  data-type={projectType}
                  title={`查看主要分类「${projectType}」的全部项目`}
                  onClick={() => onProjectType(projectType)}
                >
                  {projectType}
                </button>
              </section>
              {includedTypes.length > 0 ? (
                <section className="detail-meta-line detail-included-types" aria-label="包含类型">
                  <span>兼有</span>
                  {includedTypes.map((type) => (
                    <span key={type} className="detail-badge">
                      {type}
                    </span>
                  ))}
                </section>
              ) : null}
              {detail?.collections && detail.collections.length > 0 ? (
                <section className="detail-meta-line detail-collections" aria-label="所属合集">
                  {detail.collections.map((col) => (
                    <button
                      key={col.id}
                      type="button"
                      className="detail-collection-badge"
                      title={col.description || `查看合集「${col.title}」内的全部作品`}
                      onClick={() => onCollection?.({ id: col.id, title: col.title })}
                    >
                      <FolderOpen aria-hidden="true" />
                      <span>{col.title}</span>
                      <small>{col.projectCount}</small>
                    </button>
                  ))}
                </section>
              ) : null}
            </div>
            {tags.length ? (
              <fieldset className="detail-tags">
                <legend className="sr-only">项目标签</legend>
                {tags.map((tag) => (
                  <button key={tag} type="button" className="detail-tag" onClick={() => onTag(tag)}>
                    #{tag}
                  </button>
                ))}
              </fieldset>
            ) : null}
          </div>
          <div className={`detail-layout${railCollapsed ? " is-rail-collapsed" : ""}`}>
            <ProjectMedia
              project={project}
              gallery={detail?.gallery}
              selectedMedia={selectedMedia}
              setSelectedMedia={setSelectedMedia}
            />
            <aside id="detail-summary-rail" className="summary-rail" aria-label="项目信息与操作">
              <section className="rail-section rail-install-card" aria-label="安装与状态">
                {installedWorldbook ? <p className="installed">已安装至：{installedWorldbook}</p> : null}
                {installState === "upToDate" ? (
                  <p className="installed">当前已是最新版本</p>
                ) : installState === "updateAvailable" ? (
                  <p className="installed">有新版本可更新</p>
                ) : installState === "localChanged" ? (
                  <p className="installed">本地条目有改动，预览后可选择替换更新</p>
                ) : installState === "scanIncomplete" ? (
                  <p className="installed">已安装（扫描未完整）</p>
                ) : null}
                {installBlock ? (
                  <p className="rail-tavern-tip" role="status">
                    {installBlock}
                  </p>
                ) : !loggedIn ? (
                  <div className="actions rail-primary-actions">
                    <button type="button" className="primary" onClick={onLogin}>
                      使用 Discord 登录后安装
                    </button>
                  </div>
                ) : (
                  <div className="actions rail-primary-actions">
                    {installState !== "notInstalled" ? (
                      <button
                        type="button"
                        className="primary"
                        disabled={installing || installState === "upToDate"}
                        onClick={() => onUpdate(project)}
                      >
                        {installing ? "处理中…" : installLabels[installState]}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={installState === "notInstalled" ? "primary" : undefined}
                      disabled={installing}
                      onClick={() => onInstall(project)}
                    >
                      {installState === "notInstalled" ? "安装到角色 / 世界书" : "安装到新位置"}
                    </button>
                    {installState !== "notInstalled" ? (
                      <button type="button" disabled={installing} onClick={() => onUninstall(project)}>
                        卸载
                      </button>
                    ) : null}
                  </div>
                )}
              </section>

              <section className="rail-section rail-author" aria-label="作者与项目资料">
                <div className="rail-author-head">
                  <button className="author link" type="button" onClick={() => onAuthor(project.author)}>
                    {project.author.avatarUrl && project.author.avatarUrl !== failedAvatarUrl ? (
                      <img
                        src={project.author.avatarUrl}
                        alt=""
                        onError={() => setFailedAvatarUrl(project.author.avatarUrl)}
                      />
                    ) : (
                      <span className="avatar-fallback">{project.author.name.slice(0, 1)}</span>
                    )}
                    <span>{project.author.name}</span>
                  </button>
                  <p className="rail-version">
                    {versionLabel ? (
                      <span>
                        <GitBranch aria-hidden="true" />v{versionLabel.replace(/^v/i, "")}
                      </span>
                    ) : null}
                    {project.schemaVersion ? <span>适配 {project.schemaVersion}</span> : null}
                  </p>
                </div>
                <dl className="rail-facts" aria-label="项目数据">
                  <div>
                    <dt>
                      <BookOpen aria-hidden="true" />
                      世界书
                    </dt>
                    <dd>{project.entries.worldbook} 条</dd>
                  </div>
                  <div>
                    <dt>
                      <Code2 aria-hidden="true" />
                      正则
                    </dt>
                    <dd>{project.entries.regex} 条</dd>
                  </div>
                  <div>
                    <dt>
                      <Download aria-hidden="true" />
                      下载
                    </dt>
                    <dd>{project.counts.downloads}</dd>
                  </div>
                  <div>
                    <dt>
                      <Heart aria-hidden="true" />
                      点赞
                    </dt>
                    <dd>{project.counts.likes}</dd>
                  </div>
                  <div>
                    <dt>
                      <Bookmark aria-hidden="true" />
                      订阅
                    </dt>
                    <dd>{project.counts.subscriptions}</dd>
                  </div>
                </dl>
                <p className="meta rail-dates">
                  更新 {project.updatedAt.slice(0, 10)}
                  {project.publishedAt && project.publishedAt.slice(0, 10) !== project.updatedAt.slice(0, 10)
                    ? ` · 首发 ${project.publishedAt.slice(0, 10)}`
                    : ""}
                </p>
              </section>

              <ProjectCommunity
                project={project}
                discordThreadUrl={detail?.discordThreadUrl}
                loggedIn={loggedIn}
                onLogin={onLogin}
                onError={onError}
                onSubscriptionChange={onSubscriptionChange}
                onDiscordPrompt={onDiscordPrompt}
              />
              {detail?.publishedVersionId ? (
                <ProjectExperienceNotes
                  key={`${detail.id}:${detail.publishedVersionId}:${loggedIn}`}
                  projectId={detail.id}
                  loggedIn={loggedIn}
                  onLogin={onLogin}
                  onError={onError}
                />
              ) : null}
            </aside>
            <section className="reading-column">
              {detailLoading ? <p className="detail-state">正在加载详情…</p> : null}
              {detailError ? (
                <div className="detail-state detail-state-error" role="alert">
                  <p>详情加载失败。</p>
                  <button type="button" onClick={() => setDetailReload((value) => value + 1)}>
                    <RefreshCcw aria-hidden="true" />
                    重试
                  </button>
                </div>
              ) : null}
              <section className="detail-section">
                <h3>作品介绍</h3>
                {project.description?.trim() ? (
                  <Markdown text={project.description} className="detail-description" />
                ) : (
                  <p className="detail-description-empty">暂无作品介绍。</p>
                )}
              </section>
              {detail?.requirements ? <ProjectRequirements value={detail.requirements} /> : null}
              {detail ? (
                <ProjectSourcePreview
                  key={`${detail.id}:${detail.publishedVersionId ?? ""}`}
                  project={detail}
                  versionLabel={versionLabel}
                  loggedIn={loggedIn}
                />
              ) : null}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

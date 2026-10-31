import { Bookmark, BookOpen, Code2, Download, GitBranch, Heart, RefreshCcw } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { api, type ProjectDetail as ProjectDetailResponse, type ProjectSummary } from "../../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Markdown } from "../../lib/markdown";
import { ProjectCommunity } from "./ProjectCommunity";
import { ProjectMedia } from "./ProjectMedia";
import { ProjectSourcePreview } from "./ProjectSourcePreview";

export type InstallState = "notInstalled" | "upToDate" | "updateAvailable" | "localChanged" | "scanIncomplete";
const installLabels: Record<InstallState, string> = {
  notInstalled: "安装",
  upToDate: "已是最新",
  updateAvailable: "更新",
  localChanged: "预览更新（整体替换）",
  scanIncomplete: "修复安装",
};

export function ProjectDetail({
  project,
  onClose,
  onInstall,
  onUpdate,
  onUninstall,
  onAuthor,
  onTag,
  onProjectType,
  onLogin,
  onError,
  onSubscriptionChange,
  installState,
  loggedIn,
  installing,
  connected,
  installedWorldbook,
  opener,
}: {
  project: ProjectSummary;
  onClose: () => void;
  onInstall: (p: ProjectSummary) => void;
  onUpdate: (p: ProjectSummary) => void;
  onUninstall: (p: ProjectSummary) => void;
  onAuthor: (author: { id: string; name: string }) => void;
  onTag: (tag: string) => void;
  onProjectType: (type: string) => void;
  onLogin: () => void;
  onError: (message: string) => void;
  onSubscriptionChange: (projectId: string, subscribed: boolean) => void;
  installState: InstallState;
  loggedIn: boolean;
  installing: boolean;
  connected: boolean;
  installedWorldbook: string | null;
  opener: RefObject<HTMLElement | null>;
}) {
  const [detail, setDetail] = useState<ProjectDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailReload, setDetailReload] = useState(0);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const [selectedMedia, setSelectedMedia] = useState(0);

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
        setDetailError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [detailReload, project.id]);

  const versionLabel = detail?.versionLabel ?? project.versionLabel ?? null;
  const tags = project.tags.filter((tag) => tag !== project.projectType);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="detail"
        aria-modal="true"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.querySelector<HTMLButtonElement>(".detail .close")?.focus();
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
          <DialogTitle>{project.title}</DialogTitle>
          <DialogDescription className="sr-only">项目详情</DialogDescription>
          {project.projectType || project.extensionType ? (
            <div className="detail-meta-line">
              {project.projectType ? (
                <button
                  type="button"
                  className="detail-badge project-type-tag"
                  data-type={project.projectType}
                  title={`查看类型「${project.projectType}」的全部项目`}
                  onClick={() => onProjectType(project.projectType ?? "")}
                >
                  {project.projectType}
                </button>
              ) : null}
              {project.extensionType ? <span className="detail-badge">{project.extensionType}扩展</span> : null}
            </div>
          ) : null}
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
        </DialogHeader>
        <div className="detail-body">
          <div className="detail-layout">
            <ProjectMedia
              project={project}
              gallery={detail?.gallery}
              selectedMedia={selectedMedia}
              setSelectedMedia={setSelectedMedia}
            />
            <aside className="summary-rail" aria-label="项目信息与操作">
              <section className="rail-section rail-author" aria-label="作者与项目资料">
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
                      <GitBranch aria-hidden="true" />
                      版本 {versionLabel}
                    </span>
                  ) : null}
                  {project.schemaVersion ? <span>适配 {project.schemaVersion}</span> : null}
                </p>
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
                  {project.publishedAt ? ` · 发布 ${project.publishedAt.slice(0, 10)}` : ""}
                </p>
              </section>
              <section className="rail-section" aria-label="安装与状态">
                {installState === "upToDate" ? (
                  <p className="installed">已安装，且与当前发布版本一致。</p>
                ) : installState === "updateAvailable" ? (
                  <p className="installed">已安装；当前发布版本可更新。</p>
                ) : installState === "localChanged" ? (
                  <p className="installed">
                    已安装；检测到本地修改。请先预览差异，确认后将整体替换，不会保留本地修改。
                  </p>
                ) : installState === "scanIncomplete" ? (
                  <p className="installed">已安装；本地扫描不完整，无法确认是否有修改。</p>
                ) : (
                  <p className="rail-muted">尚未安装到当前角色。</p>
                )}
                {installedWorldbook ? <p className="installed">已安装到 · {installedWorldbook}</p> : null}
                {!connected ? (
                  <p className="hint">安装请从 SillyTavern 内的「命定创意工坊」按钮打开。</p>
                ) : !loggedIn ? (
                  <div className="actions">
                    <button type="button" className="primary" onClick={onLogin}>
                      使用 Discord 登录后安装
                    </button>
                  </div>
                ) : (
                  <div className="actions">
                    {installState !== "notInstalled" ? (
                      <button
                        type="button"
                        className="primary"
                        disabled={installing || installState === "upToDate"}
                        onClick={() => onUpdate(project)}
                      >
                        {installing ? "安装中…" : installLabels[installState]}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={installState === "notInstalled" ? "primary" : undefined}
                      disabled={installing}
                      onClick={() => onInstall(project)}
                    >
                      安装到新位置
                    </button>
                    {installState !== "notInstalled" ? (
                      <button type="button" disabled={installing} onClick={() => onUninstall(project)}>
                        卸载
                      </button>
                    ) : null}
                  </div>
                )}
              </section>
              <ProjectCommunity
                project={project}
                discordThreadUrl={detail?.discordThreadUrl}
                loggedIn={loggedIn}
                onLogin={onLogin}
                onError={onError}
                onSubscriptionChange={onSubscriptionChange}
              />
            </aside>
            <section className="reading-column">
              {detailLoading ? <p className="detail-state">正在加载项目详情…</p> : null}
              {detailError ? (
                <div className="detail-state detail-state-error" role="alert">
                  <p>项目详情加载失败。</p>
                  <button type="button" onClick={() => setDetailReload((value) => value + 1)}>
                    <RefreshCcw aria-hidden="true" />
                    重试
                  </button>
                </div>
              ) : null}
              <section className="detail-section">
                <h3>项目介绍</h3>
                {project.description?.trim() ? (
                  <Markdown text={project.description} className="detail-description" />
                ) : (
                  <p className="detail-description-empty">暂无项目介绍。</p>
                )}
              </section>
              {detail?.authorNote?.trim() ? (
                <section className="detail-section">
                  <h3>作者说明</h3>
                  <Markdown text={detail.authorNote} />
                </section>
              ) : null}
              {detail?.precautions?.trim() ? (
                <section className="detail-section detail-warning">
                  <h3>注意事项</h3>
                  <Markdown text={detail.precautions} />
                </section>
              ) : null}
              {detail ? (
                <ProjectSourcePreview
                  key={`${detail.id}:${detail.publishedRevisionId ?? ""}`}
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

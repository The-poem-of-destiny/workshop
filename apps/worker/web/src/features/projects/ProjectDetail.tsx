import { type RefObject, useEffect, useState } from "react";
import { api, type ProjectDetail as ProjectDetailResponse, type ProjectSummary } from "../../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";

export type InstallState = "notInstalled" | "upToDate" | "updateAvailable" | "localChanged" | "scanIncomplete";

export function ProjectDetail({
  project,
  onClose,
  onInstall,
  onUninstall,
  onDownload,
  onAuthor,
  onError,
  downloadedRevision,
  installState,
  loggedIn,
  installing,
  embedded,
  opener,
  onSubscriptionChange,
}: {
  project: ProjectSummary;
  onClose: () => void;
  onInstall: (p: ProjectSummary) => void;
  onUninstall: (p: ProjectSummary) => void;
  onDownload: (p: ProjectSummary) => void;
  onAuthor: (author: { id: string; name: string }) => void;
  onError: (message: string) => void;
  onSubscriptionChange: (projectId: string, subscribed: boolean) => void;
  downloadedRevision: string | null;
  installState: InstallState;
  loggedIn: boolean;
  installing: boolean;
  embedded: boolean;
  opener: RefObject<HTMLElement | null>;
}) {
  const [detail, setDetail] = useState<ProjectDetailResponse | null>(null);
  const [interaction, setInteraction] = useState<{ liked: boolean; subscribed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    api
      .project(project.id)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [project.id]);
  useEffect(() => {
    if (!loggedIn) {
      setInteraction(null);
      return;
    }
    let active = true;
    api
      .meState([project.id])
      .then((result) => {
        if (!active) return;
        const item = result.items.find((value) => value.projectId === project.id);
        setInteraction(item ? { liked: item.liked, subscribed: item.subscribed } : { liked: false, subscribed: false });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loggedIn, project.id]);
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
          <button className="author link" type="button" onClick={() => onAuthor(project.author)}>
            {project.author.avatarUrl ? (
              <img src={project.author.avatarUrl} alt="" />
            ) : (
              <span className="avatar-fallback">{project.author.name.slice(0, 1)}</span>
            )}
            {project.author.name}
          </button>
        </DialogHeader>
        <div className="detail-body">
          <div className="detail-layout">
            <section className="media-stage" aria-label="项目封面">
              {project.coverUrl ? (
                <img
                  src={project.coverUrl}
                  alt={`${project.title} 封面`}
                  style={{
                    objectPosition: `${project.coverPositionX}% ${project.coverPositionY}%`,
                    transform: `scale(${project.coverZoom})`,
                  }}
                />
              ) : (
                <p>{project.description?.trim() || "暂无封面或文字简介"}</p>
              )}
            </section>
            <aside className="summary-rail" aria-label="项目信息与操作">
              <section className="rail-section">
                <h3>安装与状态</h3>
                {downloadedRevision ? (
                  <p className="installed">
                    {project.publishedRevisionId && downloadedRevision === project.publishedRevisionId
                      ? "本地已下载当前发布版本。"
                      : "本地下载记录与当前发布版本不同。"}
                  </p>
                ) : null}
                {installState === "upToDate" ? (
                  <p className="installed">已安装，且与当前发布版本一致。</p>
                ) : installState === "updateAvailable" ? (
                  <p className="installed">已安装；当前发布版本可更新。</p>
                ) : installState === "localChanged" ? (
                  <p className="installed">已安装；检测到本地修改，更新会保留这些修改。</p>
                ) : installState === "scanIncomplete" ? (
                  <p className="installed">已安装；本地扫描不完整，无法确认是否有修改。</p>
                ) : (
                  <p className="rail-muted">尚未安装到当前角色。</p>
                )}
                {!embedded ? (
                  <p className="hint">安装请从 SillyTavern 内的「命定创意工坊」按钮打开。</p>
                ) : !loggedIn ? (
                  <p className="hint">请先使用 Discord 登录，再安装到当前角色。</p>
                ) : (
                  <div className="actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={installing || installState === "upToDate"}
                      onClick={() => onInstall(project)}
                    >
                      {installing
                        ? "安装中…"
                        : installState === "upToDate"
                          ? "已是最新"
                          : installState === "localChanged"
                            ? "更新（保留修改）"
                            : installState === "notInstalled"
                              ? "安装"
                              : installState === "scanIncomplete"
                                ? "修复安装"
                                : "更新"}
                    </button>
                    {installState !== "notInstalled" ? (
                      <button type="button" disabled={installing} onClick={() => onUninstall(project)}>
                        卸载
                      </button>
                    ) : null}
                  </div>
                )}
              </section>
              <section className="rail-section">
                <h3>社区与获取</h3>
                <div className="actions">
                  {detail?.discordThreadUrl ? (
                    <a className="secondary-link" href={detail.discordThreadUrl} target="_blank" rel="noreferrer">
                      Discord 讨论
                    </a>
                  ) : null}
                  {loggedIn ? (
                    <>
                      <button type="button" disabled={installing} onClick={() => onDownload(project)}>
                        下载文件
                      </button>
                      <button
                        type="button"
                        disabled={interaction === null}
                        aria-pressed={Boolean(interaction?.liked)}
                        onClick={() => {
                          const next = !interaction?.liked;
                          void api
                            .setLike(project.id, next)
                            .then(() =>
                              setInteraction((value) => ({
                                liked: next,
                                subscribed: value?.subscribed ?? false,
                              })),
                            )
                            .catch((reason) => onError(String(reason)));
                        }}
                      >
                        {interaction?.liked ? "已点赞" : "点赞"}
                      </button>
                      <button
                        type="button"
                        disabled={interaction === null}
                        aria-pressed={Boolean(interaction?.subscribed)}
                        onClick={() => {
                          const next = !interaction?.subscribed;
                          void api
                            .setSubscription(project.id, next)
                            .then(() => {
                              setInteraction((value) => ({
                                liked: value?.liked ?? false,
                                subscribed: next,
                              }));
                              onSubscriptionChange(project.id, next);
                            })
                            .catch((reason) => onError(String(reason)));
                        }}
                      >
                        {interaction?.subscribed ? "已订阅" : "订阅"}
                      </button>
                    </>
                  ) : null}
                </div>
              </section>
              <section className="rail-section">
                <h3>项目数据</h3>
                <dl>
                  <div>
                    <dt>世界书</dt>
                    <dd>{project.entries.worldbook} 条</dd>
                  </div>
                  <div>
                    <dt>正则</dt>
                    <dd>{project.entries.regex} 条</dd>
                  </div>
                  <div>
                    <dt>下载</dt>
                    <dd>{project.counts.downloads}</dd>
                  </div>
                  <div>
                    <dt>点赞</dt>
                    <dd>{project.counts.likes}</dd>
                  </div>
                  <div>
                    <dt>订阅</dt>
                    <dd>{project.counts.subscriptions}</dd>
                  </div>
                </dl>
              </section>
            </aside>
            <section className="reading-column">
              <section className="detail-section">
                <h3>项目介绍</h3>
                <p className="detail-description">{project.description || "暂无项目介绍。"}</p>
              </section>
              <section className="detail-section">
                <h3>版本信息</h3>
                <p className="meta">
                  {project.versionLabel ? `版本 ${project.versionLabel} · ` : ""}
                  更新 {project.updatedAt.slice(0, 10)}
                  {project.publishedAt ? ` · 发布 ${project.publishedAt.slice(0, 10)}` : ""}
                  {project.schemaVersion ? ` · 适配 ${project.schemaVersion}` : ""}
                </p>
              </section>
              {detail?.authorNote ? (
                <section className="detail-section">
                  <h3>作者说明</h3>
                  <p>{detail.authorNote}</p>
                </section>
              ) : null}
              {detail?.precautions ? (
                <section className="detail-section detail-warning">
                  <h3>注意事项</h3>
                  <p>{detail.precautions}</p>
                </section>
              ) : null}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

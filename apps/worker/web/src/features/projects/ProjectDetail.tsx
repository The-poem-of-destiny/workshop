import { ArrowLeft, Bookmark, ChevronLeft, ChevronRight, ExternalLink, Heart, RefreshCcw, Star } from "lucide-react";
import { type RefObject, useEffect, useMemo, useState } from "react";
import { api, type ProjectDetail as ProjectDetailResponse, type ProjectSummary } from "../../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Markdown } from "../../lib/markdown";

export type InstallState = "notInstalled" | "upToDate" | "updateAvailable" | "localChanged" | "scanIncomplete";
type PreviewKind = "worldbook" | "regex";
type PreviewEntry = { key: string; name: string; content: string };
type PreviewData = { revisionId: string; kind: PreviewKind; entries: PreviewEntry[] };
type MediaItem = { slot: number; url: string; cover: boolean };
type Interaction = { liked: boolean; subscribed: boolean; rating: number | null };

export function ProjectDetail({
  project,
  onClose,
  onInstall,
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
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [ratingDraft, setRatingDraft] = useState<number | null>(null);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingSaving, setRatingSaving] = useState(false);
  const [ratingSaved, setRatingSaved] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(0);
  const [imageStatus, setImageStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const [imageRetry, setImageRetry] = useState(0);
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(() => new Set());
  const [previewKind, setPreviewKind] = useState<PreviewKind>("worldbook");
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReload, setPreviewReload] = useState(0);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewEntryKey, setPreviewEntryKey] = useState<string | null>(null);
  const [previewReading, setPreviewReading] = useState(false);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setSelectedMedia(0);
    api
      .project(project.id)
      .then((value) => {
        if (!active) return;
        setDetail(value);
        setDetailLoading(false);
      })
      .catch((reason) => {
        if (!active) return;
        setDetailLoading(false);
        setDetailError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [detailReload, project.id]);

  useEffect(() => {
    setRatingDraft(null);
    setRatingComment("");
    setRatingSaved(false);
    if (!loggedIn) {
      setInteraction(null);
      return;
    }
    let active = true;
    setInteraction(null);
    api
      .meState([project.id])
      .then((result) => {
        if (!active) return;
        const item = result.items.find((value) => value.projectId === project.id);
        setInteraction(
          item
            ? { liked: item.liked, subscribed: item.subscribed, rating: item.rating }
            : { liked: false, subscribed: false, rating: null },
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loggedIn, project.id]);

  useEffect(() => {
    let active = true;
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(true);
    setPreviewSearch("");
    setPreviewEntryKey(null);
    setPreviewReading(false);
    api
      .projectPreview(project.id, previewKind)
      .then((value) => {
        if (!active) return;
        setPreviewData(value);
        setPreviewLoading(false);
        setPreviewEntryKey(value.entries[0]?.key ?? null);
      })
      .catch((reason) => {
        if (!active) return;
        setPreviewLoading(false);
        setPreviewError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [previewKind, previewReload, project.id]);

  const mediaItems = useMemo<MediaItem[]>(() => {
    const extras = (detail?.gallery ?? [])
      .filter((item) => item.url.trim())
      .sort((a, b) => a.slot - b.slot)
      .slice(0, 2)
      .map((item) => ({ slot: item.slot, url: item.url, cover: false }));
    return [...(project.coverUrl ? [{ slot: -1, url: project.coverUrl, cover: true }] : []), ...extras];
  }, [detail?.gallery, project.coverUrl]);
  const activeMedia = mediaItems[selectedMedia];
  const previewEntries = (previewData?.entries ?? []).filter((entry) => {
    const query = previewSearch.trim().toLocaleLowerCase();
    return !query || `${entry.name} ${entry.key}`.toLocaleLowerCase().includes(query);
  });
  const selectedPreview = previewEntries.find((entry) => entry.key === previewEntryKey) ?? previewEntries[0] ?? null;
  const selectedPreviewIndex = selectedPreview
    ? previewEntries.findIndex((entry) => entry.key === selectedPreview.key)
    : -1;
  const previousPreview = selectedPreviewIndex > 0 ? previewEntries[selectedPreviewIndex - 1] : undefined;
  const nextPreview = selectedPreviewIndex >= 0 ? previewEntries[selectedPreviewIndex + 1] : undefined;
  const versionLabel = detail?.versionLabel ?? project.versionLabel ?? null;
  const tags = project.tags.filter((tag) => tag !== project.projectType);
  const currentRating = ratingDraft ?? interaction?.rating ?? null;

  useEffect(() => {
    if (selectedMedia >= mediaItems.length) setSelectedMedia(Math.max(0, mediaItems.length - 1));
  }, [mediaItems.length, selectedMedia]);
  useEffect(() => {
    setImageStatus(activeMedia ? "loading" : "loaded");
    setImageRetry(0);
  }, [activeMedia?.url]);

  const changeMedia = (offset: number): void => {
    if (mediaItems.length < 2) return;
    setSelectedMedia((current) => (current + offset + mediaItems.length) % mediaItems.length);
  };

  const submitRating = (): void => {
    if (!loggedIn || currentRating === null || ratingSaving) return;
    setRatingSaving(true);
    api
      .setRating(project.id, currentRating, ratingComment.trim() || undefined)
      .then(() => {
        setRatingSaving(false);
        setRatingDraft(null);
        setRatingComment("");
        setRatingSaved(true);
        setInteraction((value) => ({
          liked: value?.liked ?? false,
          subscribed: value?.subscribed ?? false,
          rating: currentRating,
        }));
      })
      .catch((reason) => {
        setRatingSaving(false);
        onError(String(reason));
      });
  };

  const removeRating = (): void => {
    if (ratingSaving) return;
    setRatingSaving(true);
    api
      .deleteRating(project.id)
      .then(() => {
        setRatingSaving(false);
        setRatingDraft(null);
        setRatingComment("");
        setRatingSaved(false);
        setInteraction((value) => ({
          liked: value?.liked ?? false,
          subscribed: value?.subscribed ?? false,
          rating: null,
        }));
      })
      .catch((reason) => {
        setRatingSaving(false);
        onError(String(reason));
      });
  };

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
            <section className="media-section" aria-label="项目封面与图片">
              <div className="media-stage">
                {activeMedia ? (
                  <>
                    <img
                      key={`${activeMedia.url}-${imageRetry}`}
                      src={activeMedia.url}
                      alt={`${project.title}${activeMedia.cover ? " 封面" : " 项目图片"}`}
                      className={imageStatus === "loaded" ? "is-loaded" : ""}
                      style={
                        activeMedia.cover
                          ? {
                              objectPosition: `${project.coverPositionX ?? 50}% ${project.coverPositionY ?? 50}%`,
                              transform: `scale(${Math.max(1, project.coverZoom ?? 1)})`,
                            }
                          : undefined
                      }
                      onLoad={() => setImageStatus("loaded")}
                      onError={() => setImageStatus("failed")}
                    />
                    {imageStatus === "loading" ? <p className="media-status">正在加载图片…</p> : null}
                    {imageStatus === "failed" ? (
                      <div className="media-status media-failed" role="alert">
                        <p>图片加载失败</p>
                        <button type="button" onClick={() => setImageRetry((value) => value + 1)}>
                          <RefreshCcw aria-hidden="true" />
                          重试
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="media-status">{project.description?.trim() || "暂无封面或项目图片"}</p>
                )}
                {mediaItems.length > 1 ? (
                  <>
                    <button
                      className="media-nav media-nav-prev"
                      type="button"
                      aria-label="上一张图片"
                      onClick={() => changeMedia(-1)}
                    >
                      <ChevronLeft aria-hidden="true" />
                    </button>
                    <button
                      className="media-nav media-nav-next"
                      type="button"
                      aria-label="下一张图片"
                      onClick={() => changeMedia(1)}
                    >
                      <ChevronRight aria-hidden="true" />
                    </button>
                  </>
                ) : null}
              </div>
              {mediaItems.length > 0 ? (
                <fieldset className="media-thumbnails" aria-label="项目图片">
                  {mediaItems.map((item, index) => (
                    <button
                      className={index === selectedMedia ? "media-thumbnail is-selected" : "media-thumbnail"}
                      key={`${item.slot}-${item.url}`}
                      type="button"
                      aria-label={`${item.cover ? "封面" : `项目图片 ${item.slot + 1}`} 查看`}
                      aria-pressed={index === selectedMedia}
                      onClick={() => setSelectedMedia(index)}
                    >
                      {failedThumbs.has(item.url) ? (
                        <span className="thumbnail-failed">图片</span>
                      ) : (
                        <img
                          src={item.url}
                          alt=""
                          onError={() =>
                            setFailedThumbs((current) => {
                              const next = new Set(current);
                              next.add(item.url);
                              return next;
                            })
                          }
                        />
                      )}
                    </button>
                  ))}
                </fieldset>
              ) : null}
            </section>
            <aside className="summary-rail" aria-label="项目信息与操作">
              <section className="rail-section rail-author">
                <h3>作者与版本</h3>
                <button className="author link" type="button" onClick={() => onAuthor(project.author)}>
                  {project.author.avatarUrl ? (
                    <img src={project.author.avatarUrl} alt="" />
                  ) : (
                    <span className="avatar-fallback">{project.author.name.slice(0, 1)}</span>
                  )}
                  <span>{project.author.name}</span>
                </button>
                <p className="meta">
                  {project.versionLabel ? `版本 ${project.versionLabel} · ` : ""}
                  更新 {project.updatedAt.slice(0, 10)}
                  {project.publishedAt ? ` · 发布 ${project.publishedAt.slice(0, 10)}` : ""}
                  {project.schemaVersion ? ` · 适配 ${project.schemaVersion}` : ""}
                </p>
              </section>
              <section className="rail-section">
                <h3>安装与状态</h3>
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
                <h3>社区</h3>
                <div className="actions">
                  {detail?.discordThreadUrl ? (
                    <a className="secondary-link" href={detail.discordThreadUrl} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden="true" />
                      Discord 讨论
                    </a>
                  ) : null}
                  <button
                    type="button"
                    disabled={loggedIn && interaction === null}
                    aria-pressed={loggedIn ? Boolean(interaction?.liked) : undefined}
                    onClick={() => {
                      if (!loggedIn) {
                        onLogin();
                        return;
                      }
                      const next = !interaction?.liked;
                      void api
                        .setLike(project.id, next)
                        .then(() =>
                          setInteraction((value) => ({
                            liked: next,
                            subscribed: value?.subscribed ?? false,
                            rating: value?.rating ?? null,
                          })),
                        )
                        .catch((reason) => onError(String(reason)));
                    }}
                  >
                    <Heart aria-hidden="true" fill={interaction?.liked ? "currentColor" : "none"} />
                    <span>{interaction?.liked ? "已点赞" : "点赞"}</span>
                    <span className="action-count">{project.counts.likes}</span>
                  </button>
                  <button
                    type="button"
                    disabled={loggedIn && interaction === null}
                    aria-pressed={loggedIn ? Boolean(interaction?.subscribed) : undefined}
                    onClick={() => {
                      if (!loggedIn) {
                        onLogin();
                        return;
                      }
                      const next = !interaction?.subscribed;
                      void api
                        .setSubscription(project.id, next)
                        .then(() => {
                          setInteraction((value) => ({
                            liked: value?.liked ?? false,
                            subscribed: next,
                            rating: value?.rating ?? null,
                          }));
                          onSubscriptionChange(project.id, next);
                        })
                        .catch((reason) => onError(String(reason)));
                    }}
                  >
                    <Bookmark aria-hidden="true" fill={interaction?.subscribed ? "currentColor" : "none"} />
                    <span>{interaction?.subscribed ? "已订阅" : "订阅"}</span>
                    <span className="action-count">{project.counts.subscriptions}</span>
                  </button>
                </div>
                <div className="rating-block">
                  <h4>评分</h4>
                  <fieldset className="rating-stars">
                    <legend className="sr-only">项目评分</legend>
                    {[1, 2, 3, 4, 5].map((value) => {
                      const active = currentRating !== null && currentRating >= value;
                      return (
                        <button
                          key={value}
                          type="button"
                          className={active ? "rating-star is-active" : "rating-star"}
                          aria-label={`${value} 星`}
                          aria-pressed={currentRating === value}
                          disabled={!loggedIn || ratingSaving || interaction === null}
                          onClick={() => {
                            setRatingDraft(value);
                            setRatingSaved(false);
                          }}
                        >
                          <Star aria-hidden="true" fill={active ? "currentColor" : "none"} />
                        </button>
                      );
                    })}
                  </fieldset>
                  {!loggedIn ? (
                    <p className="hint">登录后可评分。</p>
                  ) : (
                    <>
                      <p className="rating-summary">
                        {currentRating === null ? "尚未评分" : `当前评分 ${currentRating} 星`}
                      </p>
                      <label className="rating-comment">
                        <span className="sr-only">评分评论</span>
                        <textarea
                          rows={3}
                          maxLength={2000}
                          value={ratingComment}
                          placeholder="可选评论（最多 2000 字；重新填写会覆盖之前的评论）"
                          onChange={(event) => {
                            setRatingComment(event.target.value);
                            setRatingSaved(false);
                          }}
                        />
                        <span className="rating-count">{ratingComment.length} / 2000</span>
                      </label>
                      <div className="actions">
                        <button
                          type="button"
                          className="primary"
                          disabled={currentRating === null || ratingSaving || interaction === null}
                          onClick={submitRating}
                        >
                          {ratingSaving ? "保存中…" : currentRating === null ? "提交评分" : "更新评分"}
                        </button>
                        {(interaction?.rating ?? null) !== null ? (
                          <button type="button" disabled={ratingSaving} onClick={removeRating}>
                            清除评分
                          </button>
                        ) : null}
                      </div>
                      {ratingSaved ? (
                        <p className="rating-status" role="status">
                          评分已保存。
                        </p>
                      ) : null}
                    </>
                  )}
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
              <section className="detail-section preview-section">
                <div className="preview-heading">
                  <div>
                    <h3>内容预览</h3>
                    <p className="preview-note">仅展示已公开发布内容，正文按纯文本读取。</p>
                  </div>
                  {versionLabel ? <span className="preview-revision">版本 {versionLabel}</span> : null}
                </div>
                <div className="preview-tabs" role="tablist" aria-label="内容类型">
                  {(["worldbook", "regex"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      role="tab"
                      aria-selected={previewKind === kind}
                      className={previewKind === kind ? "is-active" : ""}
                      onClick={() => setPreviewKind(kind)}
                    >
                      {kind === "worldbook"
                        ? `世界书（${project.entries.worldbook}）`
                        : `正则（${project.entries.regex}）`}
                    </button>
                  ))}
                </div>
                {previewLoading ? <p className="detail-state">正在加载预览…</p> : null}
                {previewError ? (
                  <div className="detail-state detail-state-error" role="alert">
                    <p>预览加载失败。</p>
                    <button type="button" onClick={() => setPreviewReload((value) => value + 1)}>
                      <RefreshCcw aria-hidden="true" />
                      重试
                    </button>
                  </div>
                ) : null}
                {!previewLoading && !previewError ? (
                  <div className={`preview-browser${previewReading ? " is-reading" : ""}`}>
                    <label className="preview-search">
                      <span className="sr-only">搜索条目</span>
                      <input
                        type="search"
                        value={previewSearch}
                        placeholder="搜索名称或键名"
                        onChange={(event) => setPreviewSearch(event.target.value)}
                      />
                    </label>
                    <div className="preview-grid">
                      <div className="preview-entry-list" role="listbox" aria-label="条目列表">
                        {previewEntries.length ? (
                          previewEntries.map((entry) => (
                            <button
                              key={entry.key}
                              type="button"
                              role="option"
                              aria-selected={selectedPreview?.key === entry.key}
                              className={selectedPreview?.key === entry.key ? "is-selected" : ""}
                              onClick={() => {
                                setPreviewEntryKey(entry.key);
                                setPreviewReading(true);
                              }}
                            >
                              <strong>{entry.name || entry.key}</strong>
                              <span>
                                {[entry.name ? entry.key : null, `${entry.content.length} 字符`]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </button>
                          ))
                        ) : (
                          <p className="preview-empty">没有匹配的条目。</p>
                        )}
                      </div>
                      <div className="preview-content">
                        {selectedPreview ? (
                          <>
                            <button type="button" className="preview-back" onClick={() => setPreviewReading(false)}>
                              <ArrowLeft aria-hidden="true" />
                              返回条目列表
                            </button>
                            <div className="preview-content-head">
                              <h4>{selectedPreview.name || selectedPreview.key}</h4>
                              <div className="preview-entry-nav">
                                <button
                                  type="button"
                                  aria-label="上一条目"
                                  title="上一条目"
                                  disabled={!previousPreview}
                                  onClick={() => previousPreview && setPreviewEntryKey(previousPreview.key)}
                                >
                                  <ChevronLeft aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  aria-label="下一条目"
                                  title="下一条目"
                                  disabled={!nextPreview}
                                  onClick={() => nextPreview && setPreviewEntryKey(nextPreview.key)}
                                >
                                  <ChevronRight aria-hidden="true" />
                                </button>
                              </div>
                            </div>
                            <pre>{selectedPreview.content}</pre>
                          </>
                        ) : (
                          <p className="preview-empty">选择条目后查看内容。</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import type { InteractionStateItem } from "@workshop/contracts";
import { Bookmark, ExternalLink, Heart, RefreshCcw, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, type ProjectSummary } from "../../api";

type Interaction = InteractionStateItem;

export function ProjectCommunity({
  project,
  discordThreadUrl,
  loggedIn,
  onLogin,
  onError,
  onSubscriptionChange,
}: {
  project: ProjectSummary;
  discordThreadUrl: string | null | undefined;
  loggedIn: boolean;
  onLogin: () => void;
  onError: (message: string) => void;
  onSubscriptionChange: (projectId: string, subscribed: boolean) => void;
}) {
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [settledStatus, setInteractionStatus] = useState<"loading" | "ready" | "error" | "unavailable">("loading");
  const [interactionReload, setInteractionReload] = useState(0);
  const [completedReload, setCompletedReload] = useState(-1);
  const interactionStatus = completedReload === interactionReload ? settledStatus : "loading";
  const [ratingDraft, setRatingDraft] = useState<number | null>(null);
  const [ratingComment, setRatingComment] = useState("");
  const likePending = useRef(false);
  const subscriptionPending = useRef(false);
  const [likeSaving, setLikeSaving] = useState(false);
  const [subscriptionSaving, setSubscriptionSaving] = useState(false);
  const [ratingSaving, setRatingSaving] = useState(false);
  const [ratingSaved, setRatingSaved] = useState(false);
  const recommendationPending = useRef(false);
  const [recommendationComment, setRecommendationComment] = useState("");
  const [recommendationSaving, setRecommendationSaving] = useState(false);
  const [recommendationStatus, setRecommendationStatus] = useState<string | null>(null);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  useEffect(() => {
    setRatingDraft(null);
    setRatingComment("");
    setRatingSaved(false);
    setRecommendationComment("");
    setRecommendationStatus(null);
    setRecommendationError(null);
    if (!loggedIn) {
      setInteraction(null);
      return;
    }
    let active = true;
    setInteraction(null);
    setInteractionStatus("loading");
    api
      .meState([project.id])
      .then((result) => {
        if (!active) return;
        const item = result.items.find((value) => value.projectId === project.id);
        const recommendation =
          item?.recommendation?.projectVersionId === project.publishedVersionId ? (item?.recommendation ?? null) : null;
        setInteraction(item ? { ...item, recommendation } : null);
        setInteractionStatus(item ? "ready" : "unavailable");
        setRatingComment(item?.comment ?? "");
        setRecommendationComment(recommendation?.comment ?? "");
      })
      .catch(() => {
        if (active) setInteractionStatus("error");
      })
      .finally(() => {
        if (active) setCompletedReload(interactionReload);
      });
    return () => {
      active = false;
    };
  }, [loggedIn, project.id, project.publishedVersionId, interactionReload]);
  const currentRating = ratingDraft ?? interaction?.rating ?? null;
  const submitRating = (): void => {
    if (!loggedIn || interaction === null || currentRating === null || ratingSaving) return;
    setRatingSaving(true);
    api
      .setRating(project.id, currentRating, ratingComment.trim())
      .then(() => {
        setRatingSaving(false);
        setRatingDraft(null);
        setRatingSaved(true);
        setInteraction((value) => (value ? { ...value, rating: currentRating } : value));
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
        setInteraction((value) => (value ? { ...value, rating: null } : value));
      })
      .catch((reason) => {
        setRatingSaving(false);
        onError(String(reason));
      });
  };
  const saveRecommendation = (remove: boolean): void => {
    const projectVersionId = remove ? interaction?.recommendation?.projectVersionId : project.publishedVersionId;
    if (!loggedIn || !interaction || !projectVersionId || recommendationPending.current) return;
    if (!remove && !interaction.recommendationEligible) return;
    recommendationPending.current = true;
    setRecommendationSaving(true);
    setRecommendationStatus(null);
    setRecommendationError(null);
    const comment = recommendationComment.trim();
    void api
      .playerRecommendation(project.id, { projectVersionId, ...(remove ? {} : { comment }) }, remove)
      .then(() => {
        setInteraction((value) =>
          value ? { ...value, recommendation: remove ? null : { projectVersionId, comment } } : value,
        );
        setRecommendationComment(remove ? "" : comment);
        setRecommendationStatus(remove ? "当前版本推荐已撤回。" : "当前版本推荐已保存。");
      })
      .catch((reason) => {
        const message =
          reason instanceof ApiError && reason.status === 403
            ? "请先订阅此项目，再推荐当前版本；取消订阅不影响推荐资格。"
            : `推荐保存失败：${String(reason)}`;
        setRecommendationError(message);
      })
      .finally(() => {
        recommendationPending.current = false;
        setRecommendationSaving(false);
      });
  };
  return (
    <section className="rail-section" aria-label="社区互动">
      <div className="actions">
        {discordThreadUrl ? (
          <a className="secondary-link" href={discordThreadUrl} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" />
            Discord 讨论
          </a>
        ) : null}
        <button
          type="button"
          disabled={loggedIn && (interaction === null || likeSaving)}
          aria-pressed={loggedIn ? Boolean(interaction?.liked) : undefined}
          onClick={() => {
            if (!loggedIn) {
              onLogin();
              return;
            }
            if (likePending.current) return;
            likePending.current = true;
            setLikeSaving(true);
            const next = !interaction?.liked;
            void api
              .setLike(project.id, next)
              .then(() => setInteraction((value) => (value ? { ...value, liked: next } : value)))
              .catch((reason) => onError(String(reason)))
              .finally(() => {
                likePending.current = false;
                setLikeSaving(false);
              });
          }}
        >
          <Heart aria-hidden="true" fill={interaction?.liked ? "currentColor" : "none"} />
          <span>{interaction?.liked ? "已点赞" : "点赞"}</span>
        </button>
        <button
          type="button"
          disabled={loggedIn && (interaction === null || subscriptionSaving)}
          aria-pressed={loggedIn ? Boolean(interaction?.subscribed) : undefined}
          onClick={() => {
            if (!loggedIn) {
              onLogin();
              return;
            }
            if (subscriptionPending.current) return;
            subscriptionPending.current = true;
            setSubscriptionSaving(true);
            const next = !interaction?.subscribed;
            void api
              .setSubscription(project.id, next)
              .then(() => {
                setInteraction((value) =>
                  value
                    ? { ...value, subscribed: next, recommendationEligible: next || value.recommendationEligible }
                    : value,
                );
                onSubscriptionChange(project.id, next);
              })
              .catch((reason) => onError(String(reason)))
              .finally(() => {
                subscriptionPending.current = false;
                setSubscriptionSaving(false);
              });
          }}
        >
          <Bookmark aria-hidden="true" fill={interaction?.subscribed ? "currentColor" : "none"} />
          <span>{interaction?.subscribed ? "已订阅" : "订阅"}</span>
        </button>
      </div>
      {loggedIn && interactionStatus === "loading" ? (
        <p className="hint" role="status">
          正在加载互动状态…
        </p>
      ) : null}
      {loggedIn && interactionStatus === "error" ? (
        <div className="detail-state detail-state-error" role="alert">
          <p>互动状态加载失败。</p>
          <button type="button" onClick={() => setInteractionReload((value) => value + 1)}>
            <RefreshCcw aria-hidden="true" />
            重试
          </button>
        </div>
      ) : null}
      {loggedIn && interactionStatus === "unavailable" ? <p className="hint">此项目当前不可互动。</p> : null}
      <VersionRecommendation
        interaction={interaction}
        ready={interactionStatus === "ready"}
        loggedIn={loggedIn}
        projectVersionId={project.publishedVersionId}
        comment={recommendationComment}
        saving={recommendationSaving}
        status={recommendationStatus}
        error={recommendationError}
        onCommentChange={(value) => {
          setRecommendationComment(value);
          setRecommendationStatus(null);
          setRecommendationError(null);
        }}
        onSave={saveRecommendation}
      />
      <div className="rating-block">
        <h4>我的评分备忘</h4>
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
        ) : interactionStatus === "ready" ? (
          <>
            <p className="rating-summary">{currentRating === null ? "尚未评分" : `当前评分 ${currentRating} 星`}</p>
            <label className="rating-comment">
              <span className="sr-only">评分评论</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={ratingComment}
                placeholder="可写几句备注，留空保存会删除。"
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
        ) : null}
      </div>
    </section>
  );
}

function VersionRecommendation({
  interaction,
  ready,
  loggedIn,
  projectVersionId,
  comment,
  saving,
  status,
  error,
  onCommentChange,
  onSave,
}: {
  interaction: Interaction | null;
  ready: boolean;
  loggedIn: boolean;
  projectVersionId: string | null | undefined;
  comment: string;
  saving: boolean;
  status: string | null;
  error: string | null;
  onCommentChange: (value: string) => void;
  onSave: (remove: boolean) => void;
}) {
  return (
    <section className="rating-block" aria-label="版本推荐">
      <h4>推荐当前版本</h4>
      <p className="hint">推荐会公开展示，且只属于当前版本；新版本发布后需重新明确推荐。订阅不会自动推荐。</p>
      {!loggedIn ? (
        <p className="hint">登录并订阅过此项目后可推荐；取消订阅仍保留推荐资格。</p>
      ) : ready ? (
        <>
          {!interaction?.recommendationEligible ? (
            <p className="hint">请先订阅此项目，再推荐当前版本；取消订阅不影响推荐资格。</p>
          ) : (
            <p className="hint">你已订阅过此项目，可以推荐当前版本；无需保持订阅。</p>
          )}
          <label className="rating-comment">
            <span>公开推荐说明（可选）</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={comment}
              disabled={!interaction?.recommendationEligible || saving}
              onChange={(event) => onCommentChange(event.target.value)}
            />
          </label>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={!interaction?.recommendationEligible || saving || !projectVersionId}
              onClick={() => onSave(false)}
            >
              {saving ? "处理中…" : interaction?.recommendation ? "更新当前版本推荐" : "推荐当前版本"}
            </button>
            {interaction?.recommendation ? (
              <button type="button" disabled={saving} onClick={() => onSave(true)}>
                撤回当前版本推荐
              </button>
            ) : null}
          </div>
          {status ? <p role="status">{status}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
        </>
      ) : null}
    </section>
  );
}

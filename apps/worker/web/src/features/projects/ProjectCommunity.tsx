import { Bookmark, ExternalLink, Heart, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type ProjectSummary } from "../../api";

type Interaction = { liked: boolean; subscribed: boolean; rating: number | null };

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
  const [ratingDraft, setRatingDraft] = useState<number | null>(null);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingSaving, setRatingSaving] = useState(false);
  const [ratingSaved, setRatingSaved] = useState(false);
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
        setInteraction(item ? { liked: item.liked, subscribed: item.subscribed, rating: item.rating } : null);
        setRatingComment(item?.comment ?? "");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loggedIn, project.id]);
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
        </button>
      </div>
      <div className="rating-block">
        <h4>我的私有评分</h4>
        <p className="hint">评分与评论仅自己可见，不公开展示。</p>
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
            <p className="rating-summary">{currentRating === null ? "尚未评分" : `当前评分 ${currentRating} 星`}</p>
            <label className="rating-comment">
              <span className="sr-only">评分评论</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={ratingComment}
                placeholder="可选私有评论（最多 2000 字；清空后保存会删除评论）"
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
  );
}

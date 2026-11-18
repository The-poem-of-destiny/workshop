import type { InteractionStateItem } from "@workshop/contracts";
import { Bookmark, ExternalLink, Heart, RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, type ProjectSummary } from "../../api";
import type { DiscordPromptTarget } from "../policy/DiscordLinkPrompt";

type Interaction = InteractionStateItem;

export function ProjectCommunity({
  project,
  discordThreadUrl,
  loggedIn,
  onLogin,
  onError,
  onSubscriptionChange,
  onDiscordPrompt,
}: {
  project: ProjectSummary;
  discordThreadUrl: string | null | undefined;
  loggedIn: boolean;
  onLogin: () => void;
  onError: (message: string) => void;
  onSubscriptionChange: (projectId: string, subscribed: boolean) => void;
  onDiscordPrompt?: (target: DiscordPromptTarget) => void;
}) {
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [settledStatus, setInteractionStatus] = useState<"loading" | "ready" | "error" | "unavailable">("loading");
  const [interactionReload, setInteractionReload] = useState(0);
  const [completedReload, setCompletedReload] = useState(-1);
  const interactionStatus = completedReload === interactionReload ? settledStatus : "loading";
  const likePending = useRef(false);
  const subscriptionPending = useRef(false);
  const [likeSaving, setLikeSaving] = useState(false);
  const [subscriptionSaving, setSubscriptionSaving] = useState(false);
  const recommendationPending = useRef(false);
  const [recommendationComment, setRecommendationComment] = useState("");
  const [recommendationSaving, setRecommendationSaving] = useState(false);
  const [recommendationStatus, setRecommendationStatus] = useState<string | null>(null);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  useEffect(() => {
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
        if (reason instanceof ApiError && reason.status === 403) {
          setInteraction((value) => (value ? { ...value, subscribed: false, recommendationEligible: false } : value));
        }
        const message =
          reason instanceof ApiError && reason.status === 403
            ? "请先订阅此项目，再推荐当前版本；取消订阅后不可新增或编辑，仍可撤回已有推荐。"
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
          <a
            className="secondary-link"
            href={discordThreadUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              if (!onDiscordPrompt) return;
              event.preventDefault();
              onDiscordPrompt({ projectTitle: project.title, threadUrl: discordThreadUrl });
            }}
          >
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
                  value ? { ...value, subscribed: next, recommendationEligible: next } : value,
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
        <p className="hint">登录并订阅此项目后可推荐；取消订阅后仍可撤回已有推荐。</p>
      ) : ready ? (
        <>
          {!interaction?.recommendationEligible ? (
            <p className="hint">请先订阅此项目，再推荐当前版本；取消订阅后不可新增或编辑，仍可撤回已有推荐。</p>
          ) : (
            <p className="hint">你当前已订阅此项目，可以推荐当前版本。</p>
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

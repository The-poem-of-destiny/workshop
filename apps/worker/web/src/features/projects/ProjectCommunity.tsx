import { Bookmark, ExternalLink, Heart, RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type ProjectSummary } from "../../api";

type Interaction = { liked: boolean; subscribed: boolean };

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
  const likePending = useRef(false);
  const subscriptionPending = useRef(false);
  const [likeSaving, setLikeSaving] = useState(false);
  const [subscriptionSaving, setSubscriptionSaving] = useState(false);
  useEffect(() => {
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
        setInteraction(item ? { liked: item.liked, subscribed: item.subscribed } : null);
        setInteractionStatus(item ? "ready" : "unavailable");
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
  }, [loggedIn, project.id, interactionReload]);
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
              .then(() =>
                setInteraction((value) => ({
                  liked: next,
                  subscribed: value?.subscribed ?? false,
                })),
              )
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
                setInteraction((value) => ({
                  liked: value?.liked ?? false,
                  subscribed: next,
                }));
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
    </section>
  );
}

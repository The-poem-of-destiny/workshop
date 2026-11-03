import { useCallback, useEffect, useRef } from "react";
import { api } from "../../api";

/** Only 50%-visible cards count. Queue delivery is not an impression. */
export function useRecommendationSignals(runId: string | null) {
  const root = useRef<HTMLDivElement>(null);
  const state = useRef({ visible: new Set<string>(), clicked: new Set<string>(), dirty: false });
  useEffect(() => {
    state.current = { visible: new Set(), clicked: new Set(), dirty: false };
    if (!runId || !root.current) return;
    const flush = () => {
      const current = state.current;
      if (!current.dirty) return;
      current.dirty = false;
      // Anonymous and failed requests do not block browsing or get retried on every card.
      void api
        .recommendationSignals({ runId, visible: [...current.visible], clicked: [...current.clicked] })
        .catch(() => {});
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (document.visibilityState !== "visible") return;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.recommendationProject;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5 && id) {
            state.current.visible.add(id);
            state.current.dirty = true;
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.5 },
    );
    for (const element of root.current.querySelectorAll("[data-recommendation-project]")) observer.observe(element);
    const timer = window.setInterval(flush, 5000);
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onHidden);
      flush();
    };
  }, [runId]);
  const clicked = useCallback((id: string) => {
    state.current.visible.add(id);
    state.current.clicked.add(id);
    state.current.dirty = true;
  }, []);
  return { root, clicked };
}

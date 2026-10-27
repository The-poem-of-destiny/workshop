import { ChevronLeft, ChevronRight, RefreshCcw } from "lucide-react";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import type { ProjectDetail, ProjectSummary } from "../../api";

type MediaItem = { slot: number; url: string; cover: boolean };

export function ProjectMedia({
  project,
  gallery,
  selectedMedia,
  setSelectedMedia,
}: {
  project: ProjectSummary;
  gallery: ProjectDetail["gallery"] | undefined;
  selectedMedia: number;
  setSelectedMedia: Dispatch<SetStateAction<number>>;
}) {
  const [imageStatus, setImageStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const [imageRetry, setImageRetry] = useState(0);
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(() => new Set());
  const mediaItems = useMemo<MediaItem[]>(() => {
    const extras = (gallery ?? [])
      .filter((item) => item.url.trim())
      .sort((a, b) => a.slot - b.slot)
      .slice(0, 2)
      .map((item) => ({ slot: item.slot, url: item.url, cover: false }));
    return [...(project.coverUrl ? [{ slot: -1, url: project.coverUrl, cover: true }] : []), ...extras];
  }, [gallery, project.coverUrl]);
  const activeMedia = mediaItems[selectedMedia];
  useEffect(() => {
    if (selectedMedia >= mediaItems.length) setSelectedMedia(Math.max(0, mediaItems.length - 1));
  }, [mediaItems.length, selectedMedia, setSelectedMedia]);
  const activeMediaUrl = activeMedia?.url;
  useEffect(() => {
    setImageStatus(activeMediaUrl ? "loading" : "loaded");
    setImageRetry(0);
  }, [activeMediaUrl]);

  const changeMedia = (offset: number): void => {
    if (mediaItems.length < 2) return;
    setSelectedMedia((current) => (current + offset + mediaItems.length) % mediaItems.length);
  };
  return (
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
  );
}

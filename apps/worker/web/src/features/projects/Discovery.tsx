import { Bookmark, Download, History, ThumbsUp, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type ProjectSummary } from "../../api";
import "../../styles/discovery.css";

export function Discovery({ onOpen }: { onOpen: (project: ProjectSummary, opener: HTMLElement) => void }) {
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let active = true;
    api
      .discovery()
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, []);
  const discovered = useMemo(() => {
    const next = [...items];
    for (let index = next.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [next[index], next[swap]] = [next[swap]!, next[index]!];
    }
    return next.slice(0, 4);
  }, [items]);
  if (state === "loading")
    return (
      <section className="discovery" aria-busy="true">
        <h2>发现</h2>
        <p className="hint">正在整理今日发现…</p>
      </section>
    );
  if (state === "error")
    return (
      <section className="discovery">
        <h2>发现</h2>
        <p className="hint">暂时无法加载发现内容，主列表不受影响。</p>
      </section>
    );
  if (!discovered.length) return null;
  return (
    <section className="discovery">
      <h2>发现</h2>
      <div className="discovery-grid">
        {discovered.map((project) => (
          <button
            className="discovery-item"
            key={project.id}
            type="button"
            onClick={(event) => onOpen(project, event.currentTarget)}
          >
            {project.coverUrl ? (
              <img
                className="discovery-cover"
                src={project.coverUrl}
                alt=""
                loading="lazy"
                style={{ objectPosition: `${project.coverPositionX}% ${project.coverPositionY}%` }}
              />
            ) : (
              <span className="discovery-mark" aria-hidden="true">
                <Wrench />
              </span>
            )}
            <span className="discovery-heading">
              <strong>{project.title}</strong>
              <span className="discovery-author">{project.author.name}</span>
              <span className="discovery-tags">
                {[project.projectType, ...project.tags]
                  .filter((value, index, values) => value && values.indexOf(value) === index)
                  .slice(0, 3)
                  .map((value) => (
                    <span key={value}>{value}</span>
                  ))}
              </span>
            </span>
            <span className="discovery-note">
              {project.authorNote?.trim() || project.description?.trim() || "暂无文字简介"}
            </span>
            <span className="discovery-stats">
              <span title={`下载 ${project.counts.downloads}`}>
                <Download aria-hidden="true" />
                {project.counts.downloads.toLocaleString("zh-CN", { notation: "compact", maximumFractionDigits: 1 })}
              </span>
              <span title={`点赞 ${project.counts.likes}`}>
                <ThumbsUp aria-hidden="true" />
                {project.counts.likes.toLocaleString("zh-CN", { notation: "compact", maximumFractionDigits: 1 })}
              </span>
              <span title={`订阅 ${project.counts.subscriptions}`}>
                <Bookmark aria-hidden="true" />
                {project.counts.subscriptions.toLocaleString("zh-CN", {
                  notation: "compact",
                  maximumFractionDigits: 1,
                })}
              </span>
              <span title="更新时间">
                <History aria-hidden="true" />
                {project.updatedAt.slice(0, 10)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

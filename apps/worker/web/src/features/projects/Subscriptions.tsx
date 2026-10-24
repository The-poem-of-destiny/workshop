import { useEffect, useState } from "react";
import { api, type ProjectSummary } from "../../api";
import { ProjectCard } from "./ProjectCard";

export function Subscriptions({
  onOpen,
  onError,
  subscriptionOverrides,
}: {
  onOpen: (project: ProjectSummary, opener: HTMLElement) => void;
  onError: (message: string) => void;
  subscriptionOverrides: Record<string, boolean>;
}) {
  const [items, setItems] = useState<ProjectSummary[]>([]);
  useEffect(() => {
    api
      .subscriptions()
      .then((result) => setItems(result.items))
      .catch((reason) => onError(String(reason)));
  }, []);
  const visibleItems = items.filter((project) => subscriptionOverrides[project.id] !== false);
  return (
    <section className="workspace">
      <div className="panel-heading">
        <h2 tabIndex={-1} data-detail-return>
          我的订阅
        </h2>
      </div>
      {visibleItems.length === 0 ? (
        <p className="hint">还没有订阅项目。</p>
      ) : (
        <div className="grid">
          {visibleItems.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={(item, opener) => {
                onOpen(item, opener);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

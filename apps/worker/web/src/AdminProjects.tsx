import type { AdminProject } from "./api";
import type { useAdminData } from "./useAdminData";

export function AdminProjects({
  projects,
  projectSearch,
  setProjectSearch,
  searchProjects,
  projectBusy,
  projectError,
  onOpenProject,
  onToggleVisibility,
  onDeleteProject,
}: {
  projects: ReturnType<typeof useAdminData>["projects"];
  projectSearch: ReturnType<typeof useAdminData>["projectSearch"];
  setProjectSearch: ReturnType<typeof useAdminData>["setProjectSearch"];
  searchProjects: () => Promise<void>;
  projectBusy: boolean;
  projectError: string | null;
  onOpenProject?: (projectId: string) => void;
  onToggleVisibility: (project: AdminProject) => void;
  onDeleteProject: (project: AdminProject) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>项目</h2>
        <span className="hint">{projects.length} 个</span>
      </div>
      <label>
        搜索
        <input
          value={projectSearch}
          onChange={(event) => setProjectSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void searchProjects();
          }}
        />
      </label>
      <button type="button" disabled={projectBusy} onClick={() => void searchProjects()}>
        {projectBusy ? "搜索中…" : "搜索项目"}
      </button>
      {projectError ? (
        <p className="panel-error" role="alert">
          {projectError}
        </p>
      ) : null}
      {!projectBusy && !projectError && projects.length === 0 ? <p className="hint">没有匹配的项目。</p> : null}
      <div className="project-list">
        {projects.map((project) => {
          const canOpen = Boolean(
            onOpenProject && project.visibility === "public" && project.publishedVersionId && !project.deletedAt,
          );
          return (
            <div className="member-row admin-project-row" key={project.id}>
              <span>
                <strong>{project.title}</strong>
                <small>
                  {project.author.name} · {project.visibility === "public" ? "公开" : "私有"} ·{" "}
                  {project.publishedVersionId ? "已发布" : "未发布"}
                </small>
              </span>
              <div className="admin-project-controls">
                <span className="status">
                  {project.deletedAt ? "已删除 · " : ""}
                  {project.projectType}
                  {project.includedTypes.length ? `（包含：${project.includedTypes.join("、")}）` : ""}
                </span>
                {!project.deletedAt ? (
                  <div className="admin-project-buttons">
                    {canOpen ? (
                      <button type="button" onClick={() => onOpenProject?.(project.id)}>
                        查看详情
                      </button>
                    ) : null}
                    {project.publishedVersionId ? (
                      <button type="button" onClick={() => onToggleVisibility(project)}>
                        {project.visibility === "public" ? "设为私有" : "恢复公开"}
                      </button>
                    ) : null}
                    <button type="button" className="link-danger" onClick={() => onDeleteProject(project)}>
                      删除
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

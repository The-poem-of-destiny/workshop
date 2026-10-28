import type { useAdminData } from "./useAdminData";

export function AdminProjects({
  projects,
  projectSearch,
  setProjectSearch,
  searchProjects,
  projectBusy,
  projectError,
}: {
  projects: ReturnType<typeof useAdminData>["projects"];
  projectSearch: ReturnType<typeof useAdminData>["projectSearch"];
  setProjectSearch: ReturnType<typeof useAdminData>["setProjectSearch"];
  searchProjects: () => Promise<void>;
  projectBusy: boolean;
  projectError: string | null;
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
        {projects.map((project) => (
          <div className="member-row" key={project.id}>
            <span>
              <strong>{project.title}</strong>
              <small>
                {project.author.name} · {project.visibility === "public" ? "公开" : "私有"} ·{" "}
                {project.publishedRevisionId ? "已发布" : "未发布"}
              </small>
            </span>
            <span className="status">{project.deletedAt ? "已删除" : (project.projectType ?? "未分类")}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

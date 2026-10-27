import type { useAdminData } from "./useAdminData";

export function AdminProjects({
  projects,
  projectSearch,
  setProjectSearch,
  refresh,
}: {
  projects: ReturnType<typeof useAdminData>["projects"];
  projectSearch: ReturnType<typeof useAdminData>["projectSearch"];
  setProjectSearch: ReturnType<typeof useAdminData>["setProjectSearch"];
  refresh: ReturnType<typeof useAdminData>["refresh"];
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
            if (event.key === "Enter") void refresh();
          }}
        />
      </label>
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

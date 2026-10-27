import type { useAdminRecommendations } from "./useAdminRecommendations";

export function AdminRecommendations({
  recommendations,
  reaction,
  comment,
  editRecommendation,
  setRemoveTarget,
  editingId,
  selectedProject,
  clearRecommendationForm,
  recSearch,
  setRecSearch,
  searchRecommendationProjects,
  recSearching,
  recResults,
  pickProject,
  recSearched,
  setComment,
  setReaction,
  recBusy,
  saveRecommendation,
}: {
  recommendations: ReturnType<typeof useAdminRecommendations>["recommendations"];
  reaction: ReturnType<typeof useAdminRecommendations>["reaction"];
  comment: ReturnType<typeof useAdminRecommendations>["comment"];
  editRecommendation: ReturnType<typeof useAdminRecommendations>["editRecommendation"];
  setRemoveTarget: ReturnType<typeof useAdminRecommendations>["setRemoveTarget"];
  editingId: ReturnType<typeof useAdminRecommendations>["editingId"];
  selectedProject: ReturnType<typeof useAdminRecommendations>["selectedProject"];
  clearRecommendationForm: ReturnType<typeof useAdminRecommendations>["clearRecommendationForm"];
  recSearch: ReturnType<typeof useAdminRecommendations>["recSearch"];
  setRecSearch: ReturnType<typeof useAdminRecommendations>["setRecSearch"];
  searchRecommendationProjects: ReturnType<typeof useAdminRecommendations>["searchRecommendationProjects"];
  recSearching: ReturnType<typeof useAdminRecommendations>["recSearching"];
  recResults: ReturnType<typeof useAdminRecommendations>["recResults"];
  pickProject: ReturnType<typeof useAdminRecommendations>["pickProject"];
  recSearched: ReturnType<typeof useAdminRecommendations>["recSearched"];
  setComment: ReturnType<typeof useAdminRecommendations>["setComment"];
  setReaction: ReturnType<typeof useAdminRecommendations>["setReaction"];
  recBusy: ReturnType<typeof useAdminRecommendations>["recBusy"];
  saveRecommendation: ReturnType<typeof useAdminRecommendations>["saveRecommendation"];
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>编辑精选</h2>
        <span className="hint">{recommendations.length} 个</span>
      </div>
      <div className="recommendation-list">
        {recommendations.length === 0 ? (
          <p className="hint">暂无编辑精选。</p>
        ) : (
          recommendations.map((item) => (
            <div className="recommendation-row" key={item.id}>
              <div className="recommendation-main">
                <strong>{item.project.title}</strong>
                <small>
                  {item.project.author.name}
                  {item.reaction ? ` · 反应 ${item.reaction}` : ""}
                </small>
                {item.comment ? <p>{item.comment}</p> : null}
              </div>
              <div className="recommendation-actions">
                <button type="button" onClick={() => editRecommendation(item)}>
                  编辑
                </button>
                <button type="button" className="danger" onClick={() => setRemoveTarget(item)}>
                  移除
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <h3>{editingId ? "编辑精选" : "添加精选"}</h3>
      {editingId || selectedProject ? (
        <p className="hint">
          已选项目：
          <strong>
            {editingId
              ? recommendations.find((item) => item.project.id === editingId)?.project.title
              : selectedProject?.title}
          </strong>
          <button type="button" className="link-button" onClick={clearRecommendationForm}>
            重新选择
          </button>
        </p>
      ) : (
        <>
          <label>
            搜索项目
            <input
              value={recSearch}
              placeholder="输入项目标题或作者"
              onChange={(event) => setRecSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void searchRecommendationProjects();
                }
              }}
            />
          </label>
          <button type="button" disabled={recSearching} onClick={() => void searchRecommendationProjects()}>
            {recSearching ? "搜索中…" : "搜索项目"}
          </button>
          {recResults.length > 0 ? (
            <div className="project-list">
              {recResults.map((project) => (
                <button type="button" className="project-row" key={project.id} onClick={() => pickProject(project)}>
                  <span>
                    <strong>{project.title}</strong>
                    <small>
                      {project.author.name} · {project.visibility === "public" ? "公开" : "私有"}
                    </small>
                  </span>
                  <span className="status">
                    {recommendations.some((item) => item.project.id === project.id) ? "已精选" : "未精选"}
                  </span>
                </button>
              ))}
            </div>
          ) : recSearched ? (
            <p className="hint">没有匹配的项目。</p>
          ) : null}
        </>
      )}
      {editingId || selectedProject ? (
        <div className="form-grid">
          <label>
            评语
            <input value={comment} onChange={(event) => setComment(event.target.value)} />
          </label>
          <label>
            反应
            <input value={reaction} onChange={(event) => setReaction(event.target.value)} />
          </label>
        </div>
      ) : null}
      {editingId || selectedProject ? (
        <div className="button-row">
          <button type="button" className="primary" disabled={recBusy} onClick={() => void saveRecommendation()}>
            {recBusy ? "保存中…" : "保存精选"}
          </button>
          <button type="button" disabled={recBusy} onClick={clearRecommendationForm}>
            取消
          </button>
        </div>
      ) : null}
    </section>
  );
}

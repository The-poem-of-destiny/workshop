import { useEffect, useState } from "react";
import { type AuthorProject, api } from "../../api";
import { ProjectEditor } from "./ProjectEditor";
import { PublishedDisplayEditor } from "./PublishedDisplayEditor";
import { EXTENSION_TYPES, PROJECT_TYPES } from "./projectMetadata";

export function MyProjects({
  onError,
  onNotice,
}: {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [items, setItems] = useState<AuthorProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    description: "",
    versionLabel: "",
    projectType: "事件",
    extensionType: "",
    tags: "",
  });
  async function refresh(): Promise<void> {
    try {
      const result = await api.myProjects();
      setItems(result.items);
      if (selectedId && !result.items.some((item) => item.project.id === selectedId)) setSelectedId(null);
    } catch (reason) {
      onError(String(reason));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function create(): Promise<void> {
    if (!createForm.title.trim()) return;
    setCreating(true);
    try {
      const result = await api.createProject({
        title: createForm.title.trim(),
        description: createForm.description || null,
        versionLabel: createForm.versionLabel || null,
        projectType: createForm.projectType || null,
        extensionType: createForm.extensionType || null,
        tags: createForm.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setCreateForm({ title: "", description: "", versionLabel: "", projectType: "事件", extensionType: "", tags: "" });
      setSelectedId(result.project.id);
      onNotice("项目已创建。");
      await refresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setCreating(false);
    }
  }
  const selected = items.find((item) => item.project.id === selectedId) ?? null;
  return (
    <div className="workspace">
      <section className="panel">
        <div className="panel-heading">
          <h2>我的项目</h2>
          <button type="button" onClick={() => void refresh()}>
            刷新
          </button>
        </div>
        {items.length === 0 ? (
          <p className="hint">还没有项目，先创建一个草稿吧。</p>
        ) : (
          <div className="project-list">
            {items.map((item) => (
              <button
                key={item.project.id}
                type="button"
                className={`project-row${item.project.id === selectedId ? " selected" : ""}`}
                onClick={() => setSelectedId(item.project.id)}
              >
                <span>
                  <strong>{item.project.title}</strong>
                  <small>
                    {item.project.visibility === "public" ? "公开" : "私有"} · {item.project.projectType ?? "未分类"} ·
                    v{item.project.versionLabel ?? "未标注"}
                  </small>
                </span>
                <span className="status">
                  {item.latestSubmission
                    ? `${item.latestSubmission.checkStatus} / ${item.latestSubmission.decision ?? item.latestSubmission.status}`
                    : "未提交"}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="panel create-panel">
        <h2>创建项目</h2>
        <div className="form-grid">
          <label>
            标题
            <input
              value={createForm.title}
              onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })}
            />
          </label>
          <label>
            版本号
            <input
              value={createForm.versionLabel}
              onChange={(event) => setCreateForm({ ...createForm, versionLabel: event.target.value })}
            />
          </label>
          <label>
            项目类型
            <select
              value={createForm.projectType}
              onChange={(event) => setCreateForm({ ...createForm, projectType: event.target.value })}
            >
              {PROJECT_TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            扩展类型
            <select
              value={createForm.extensionType}
              onChange={(event) => setCreateForm({ ...createForm, extensionType: event.target.value })}
            >
              <option value="">不适用</option>
              {EXTENSION_TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            标签（逗号分隔）
            <input
              value={createForm.tags}
              onChange={(event) => setCreateForm({ ...createForm, tags: event.target.value })}
            />
          </label>
        </div>
        <label>
          简介
          <textarea
            value={createForm.description}
            onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })}
          />
        </label>
        <button
          type="button"
          className="primary"
          onClick={() => void create()}
          disabled={creating || !createForm.title.trim()}
        >
          创建草稿
        </button>
      </section>
      {selected ? (
        <div className="editor-stack">
          <ProjectEditor entry={selected} onRefresh={refresh} onError={onError} onNotice={onNotice} />
          <PublishedDisplayEditor entry={selected} onRefresh={refresh} onError={onError} onNotice={onNotice} />
        </div>
      ) : null}
    </div>
  );
}

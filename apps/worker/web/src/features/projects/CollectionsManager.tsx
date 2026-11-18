import { COLLECTION_LIMITS } from "@workshop/domain";
import { FolderPlus, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type AuthorCollection, type AuthorProject, api } from "../../api";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";

export function CollectionsManager({
  projects,
  collections,
  loading,
  onReload,
  onNotice,
  onError,
}: {
  projects: AuthorProject[];
  collections: AuthorCollection[];
  loading: boolean;
  onReload: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState<"create" | AuthorCollection | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<AuthorCollection | null>(null);

  function openCreate(): void {
    setTitle("");
    setDescription("");
    setSelectedIds([]);
    setEditing("create");
  }

  function openEdit(collection: AuthorCollection): void {
    setTitle(collection.title);
    setDescription(collection.description);
    setSelectedIds([...collection.projectIds]);
    setEditing(collection);
  }

  function toggleProject(projectId: string): void {
    setSelectedIds((prev) => (prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId]));
  }

  async function saveCollection(): Promise<void> {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      if (editing === "create") {
        await api.createCollection({
          title: title.trim(),
          description: description.trim(),
          projectIds: selectedIds,
        });
        onNotice("作品合集已创建。");
      } else if (editing) {
        await api.patchCollection(editing.id, {
          title: title.trim(),
          description: description.trim(),
          projectIds: selectedIds,
        });
        onNotice("作品合集已更新。");
      }
      setEditing(null);
      await onReload();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting || saving) return;
    setSaving(true);
    try {
      await api.deleteCollection(deleting.id);
      setDeleting(null);
      onNotice("作品合集已删除（合集内的作品本身不受影响）。");
      await onReload();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="workspace-section collections-manager" aria-labelledby="author-collections-heading">
      <div className="workspace-heading">
        <div>
          <p className="workspace-kicker">系列整理</p>
          <h2 id="author-collections-heading">我的作品合集</h2>
          <p className="workspace-muted">将同世界观或同系列作品归入合集，公开作品详情页会自动展示所属合集。</p>
        </div>
        <div className="workspace-actions">
          <button type="button" className="workspace-primary" onClick={openCreate}>
            <FolderPlus aria-hidden="true" />
            新建合集
          </button>
        </div>
      </div>

      {loading && collections.length === 0 ? <p className="workspace-state">正在加载合集…</p> : null}
      {!loading && collections.length === 0 ? (
        <p className="workspace-muted">还没有合集，点击右上角「新建合集」即可串联多个作品。</p>
      ) : null}

      {collections.length > 0 ? (
        <div className="author-collections-list">
          {collections.map((collection) => (
            <article key={collection.id} className="author-collection-card">
              <div className="author-collection-main">
                <strong>{collection.title}</strong>
                {collection.description ? <p>{collection.description}</p> : null}
                <small>
                  共收录 {collection.projectIds.length} 个项目 · 其中 {collection.publicProjectCount} 个公开展示中
                </small>
              </div>
              <div className="author-collection-actions">
                <button type="button" onClick={() => openEdit(collection)}>
                  <Pencil aria-hidden="true" />
                  编辑
                </button>
                <button type="button" className="link-danger" onClick={() => setDeleting(collection)}>
                  <Trash2 aria-hidden="true" />
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <Dialog open={editing !== null} onOpenChange={(next) => (next || saving ? undefined : setEditing(null))}>
        <DialogContent className="collection-editor-dialog mobile-sheet max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{editing === "create" ? "新建作品合集" : "编辑作品合集"}</DialogTitle>
            <DialogDescription>勾选要收入本合集的作品（未公开草稿不会对外显示）。</DialogDescription>
          </DialogHeader>
          <div className="collection-editor-body">
            <label>
              <span>合集名称（必填）</span>
              <input
                type="text"
                maxLength={COLLECTION_LIMITS.title}
                value={title}
                disabled={saving}
                placeholder="例如：北境编年史系列"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              <span>合集简介（可选）</span>
              <textarea
                rows={3}
                maxLength={COLLECTION_LIMITS.description}
                value={description}
                disabled={saving}
                placeholder="简要说明本合集包含的内容脉络或推荐搭配顺序"
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <fieldset className="collection-project-picker">
              <legend>选择收录的本人作品（已选 {selectedIds.length} 个）</legend>
              {projects.length === 0 ? (
                <p className="workspace-muted">你还没有创建任何项目，可先保存空合集。</p>
              ) : (
                <div className="collection-project-checklist">
                  {projects.map((item) => (
                    <label key={item.project.id} className="collection-check-row">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.project.id)}
                        disabled={saving}
                        onChange={() => toggleProject(item.project.id)}
                      />
                      <span>{item.project.title}</span>
                      <small>
                        {item.project.visibility === "public" && item.project.publishedVersionId ? "公开" : "未公开"}
                      </small>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          </div>
          <div className="confirm-dialog-actions">
            <button type="button" disabled={saving} onClick={() => setEditing(null)}>
              取消
            </button>
            <button
              type="button"
              className="confirm-primary"
              disabled={!title.trim() || saving}
              onClick={() => void saveCollection()}
            >
              {saving ? "保存中…" : "保存合集"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title="删除作品合集"
        description={
          deleting
            ? `确定删除合集《${deleting.title}》吗？这只会移除合集分组关系，合集内的各个作品本身不会被删除。`
            : undefined
        }
        confirmLabel="确认删除合集"
        danger
        busy={saving}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}

export function ProjectCollectionsField({
  projectId,
  initialCollectionIds,
  collections,
  busy,
  setBusy,
  onSaved,
  onNotice,
  onError,
}: {
  projectId: string;
  initialCollectionIds: string[];
  collections: AuthorCollection[];
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onSaved: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initialCollectionIds);
  useEffect(() => {
    setSelected(initialCollectionIds);
  }, [initialCollectionIds]);

  const changed =
    selected.length !== initialCollectionIds.length || selected.some((id) => !initialCollectionIds.includes(id));

  async function saveMembership(): Promise<void> {
    if (busy || !changed) return;
    setBusy(true);
    try {
      await api.setProjectCollections(projectId, selected);
      onNotice("项目所属合集已更新。");
      await onSaved();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-section authoring-section">
      <h3>所属作品合集</h3>
      {collections.length === 0 ? (
        <p className="workspace-muted">暂无合集，可在「我的项目」页面新建系列合集。</p>
      ) : (
        <>
          <p className="workspace-muted">勾选所属合集，保存后立即生效：</p>
          <div className="collection-project-checklist">
            {collections.map((collection) => (
              <label key={collection.id} className="collection-check-row">
                <input
                  type="checkbox"
                  checked={selected.includes(collection.id)}
                  disabled={busy}
                  onChange={() =>
                    setSelected((prev) =>
                      prev.includes(collection.id)
                        ? prev.filter((id) => id !== collection.id)
                        : [...prev, collection.id],
                    )
                  }
                />
                <span>{collection.title}</span>
              </label>
            ))}
          </div>
          <div className="actions">
            <button type="button" disabled={busy || !changed} onClick={() => void saveMembership()}>
              保存合集归属
            </button>
          </div>
        </>
      )}
    </section>
  );
}

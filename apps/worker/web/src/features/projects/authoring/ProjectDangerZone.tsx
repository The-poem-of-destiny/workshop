import { useState } from "react";
import { type AuthorProject, api, formatUserError } from "../../../api";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";

export function ProjectDangerZone({
  entry,
  rowVersion,
  busy,
  setBusy,
  onRowVersionChange,
  onRefresh,
  onNotice,
  onError,
}: {
  entry: AuthorProject;
  rowVersion: number;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onRowVersionChange: (version: number) => void;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");

  const isPublic = entry.project.visibility === "public";
  const hasPublished = Boolean(entry.project.publishedVersionId);
  const nextVisibility = isPublic ? "private" : "public";

  async function toggleVisibility(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.setVisibility(entry.project.id, rowVersion, nextVisibility);
      onRowVersionChange(result.rowVersion);
      setVisibilityOpen(false);
      onNotice(nextVisibility === "private" ? "已设为仅自己可见（已从公开列表隐藏）。" : "已恢复公开展示。");
      await onRefresh();
    } catch (reason) {
      onError(formatUserError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteProject(): Promise<void> {
    if (busy || confirmTitle.trim() !== entry.project.title) return;
    setBusy(true);
    try {
      await api.deleteProject(entry.project.id, rowVersion);
      setDeleteOpen(false);
      setConfirmTitle("");
      onNotice("项目已删除。");
      await onRefresh();
    } catch (reason) {
      onError(formatUserError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="workspace-section authoring-section danger-zone">
      <summary className="danger-zone-summary">项目可见性与危险操作</summary>
      <div className="danger-zone-body">
        <div className="danger-zone-item">
          <div>
            <strong>{isPublic ? "暂时下架（设为仅自己可见）" : "公开展示设置"}</strong>
            <p className="workspace-muted">
              {hasPublished
                ? isPublic
                  ? "只想暂时隐藏作品或暂停公开下载时，设为「仅自己可见」即可，无需删除项目；随时可以恢复公开。"
                  : "此项目已有通过审核的发布版本，当前处于隐藏状态，可随时恢复公开展示。"
                : "此项目尚未发布公开版本，当前仅你自己可见。通过审核后会自动公开。"}
            </p>
          </div>
          {hasPublished ? (
            <button type="button" disabled={busy} onClick={() => setVisibilityOpen(true)}>
              {isPublic ? "设为仅自己可见" : "恢复公开展示"}
            </button>
          ) : null}
        </div>

        <div className="danger-zone-item danger-zone-destructive">
          <div>
            <strong>永久删除此项目</strong>
            <p className="workspace-muted">
              删除后项目将无法在「我的项目」或公开列表中继续访问，仅在确认不再需要此项目时使用。
            </p>
          </div>
          <button
            type="button"
            className="confirm-danger"
            disabled={busy}
            onClick={() => {
              setConfirmTitle("");
              setDeleteOpen(true);
            }}
          >
            删除项目…
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={visibilityOpen}
        title={isPublic ? "设为仅自己可见" : "恢复公开展示"}
        description={
          isPublic
            ? `确定将《${entry.project.title}》设为仅自己可见吗？设置后公开列表与合集将暂时隐藏此作品，草稿与历史版本均完整保留。`
            : `确定恢复公开展示《${entry.project.title}》吗？`
        }
        confirmLabel={isPublic ? "确认隐藏" : "确认公开"}
        busy={busy}
        onConfirm={() => void toggleVisibility()}
        onCancel={() => setVisibilityOpen(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="永久删除项目"
        description={`此操作不可在界面撤销。如果只是想暂时隐藏作品，请取消并使用上方的「设为仅自己可见」。若确定永久删除，请在下方输入完整项目标题：`}
        confirmLabel="确认永久删除"
        danger
        busy={busy}
        confirmDisabled={confirmTitle.trim() !== entry.project.title}
        onConfirm={() => void confirmDeleteProject()}
        onCancel={() => {
          setDeleteOpen(false);
          setConfirmTitle("");
        }}
      >
        <label className="danger-confirm-input">
          <span>
            请输入 <strong>{entry.project.title}</strong> 以确认删除
          </span>
          <input
            type="text"
            value={confirmTitle}
            placeholder={entry.project.title}
            disabled={busy}
            onChange={(event) => setConfirmTitle(event.target.value)}
          />
        </label>
      </ConfirmDialog>
    </details>
  );
}

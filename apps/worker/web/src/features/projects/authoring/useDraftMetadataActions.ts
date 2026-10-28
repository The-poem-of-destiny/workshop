import type { AuthorProject } from "../../../api";
import { api } from "../../../api";
import { metadataPayload, type ProjectForm } from "../projectMetadata";

export function useDraftMetadataActions({
  entry,
  form,
  busy,
  workingRevisionFrozen,
  setBusy,
  rowVersion,
  setRowVersion,
  setSavedForm,
  onRefresh,
  onNotice,
  onError,
}: {
  entry: AuthorProject;
  form: ProjectForm;
  busy: boolean;
  workingRevisionFrozen: boolean;
  setBusy: (value: boolean) => void;
  rowVersion: number;
  setRowVersion: (value: number) => void;
  setSavedForm: (value: string) => void;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  async function save(): Promise<void> {
    if (busy || workingRevisionFrozen) return;
    setBusy(true);
    try {
      const result = await api.patchProject(entry.project.id, rowVersion, metadataPayload(form));
      setRowVersion(result.rowVersion);
      setSavedForm(JSON.stringify(form));
      onNotice(`已保存（版本 ${result.rowVersion}）。`);
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm(`确定删除「${entry.project.title}」？此操作不可撤销。`)) return;
    setBusy(true);
    try {
      await api.deleteProject(entry.project.id, rowVersion);
      onNotice("项目已删除。");
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return { save, remove };
}

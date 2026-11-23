import type { AuthorProject } from "../../../api";
import { api, formatUserError } from "../../../api";
import { metadataPayload, type ProjectForm } from "../projectMetadata";

export function useDraftMetadataActions({
  entry,
  form,
  workingVersionId,
  busy,
  workingVersionFrozen,
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
  workingVersionId: string | null;
  busy: boolean;
  workingVersionFrozen: boolean;
  setBusy: (value: boolean) => void;
  rowVersion: number;
  setRowVersion: (value: number) => void;
  setSavedForm: (value: string) => void;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  async function save(): Promise<void> {
    if (busy || !workingVersionId || workingVersionFrozen) return;
    if (!form.projectType) {
      onError("请选择主要分类后再保存。");
      return;
    }
    setBusy(true);
    try {
      const result = await api.patchProject(entry.project.id, rowVersion, metadataPayload(form));
      setRowVersion(result.rowVersion);
      setSavedForm(JSON.stringify(form));
      onNotice("草稿资料已保存。");
      await onRefresh();
    } catch (reason) {
      onError(formatUserError(reason));
    } finally {
      setBusy(false);
    }
  }

  return { save };
}

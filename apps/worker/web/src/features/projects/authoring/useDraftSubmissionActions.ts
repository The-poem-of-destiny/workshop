import type { Dispatch, SetStateAction } from "react";
import { type AuthorProject, type AuthorSubmission, api } from "../../../api";
import { metadataPayload, type ProjectForm } from "../projectMetadata";
import type { runLocalCheck } from "./checker";
import { mergedRegexUpload } from "./preview";
import type { useDraftAssetSelection } from "./useDraftAssetSelection";
import type { usePendingImage } from "./usePendingImage";

interface DraftSubmissionOptions {
  entry: AuthorProject;
  form: ProjectForm;
  workingVersionId: string | null;
  setWorkingVersionId: Dispatch<SetStateAction<string | null>>;
  rowVersion: number;
  setRowVersion: Dispatch<SetStateAction<number>>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  workingVersionFrozen: boolean;
  dirty: boolean;
  metadataDirty: boolean;
  cover: ReturnType<typeof usePendingImage>;
  assets: ReturnType<typeof useDraftAssetSelection>;
  check: ReturnType<typeof runLocalCheck>;
  setCoverNonce: Dispatch<SetStateAction<number>>;
  setHistoryNonce: Dispatch<SetStateAction<number>>;
  setSubmittedVersionId: Dispatch<SetStateAction<string | null>>;
  setConfirm: Dispatch<SetStateAction<null | { kind: "warn" | "block" | "missing" }>>;
  pendingWithdraw: AuthorSubmission | null;
  setPendingWithdraw: Dispatch<SetStateAction<AuthorSubmission | null>>;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

function buildPendingUploadNotice(flags: {
  metadataDirty: boolean;
  coverPending: boolean;
  worldbookPending: boolean;
  regexPending: boolean;
}): string | null {
  const pendingUploads: string[] = [];
  if (flags.metadataDirty) pendingUploads.push("未保存的资料修改（请先点左侧「保存草稿资料」）");
  if (flags.coverPending) pendingUploads.push("待上传的封面");
  if (flags.worldbookPending) pendingUploads.push("待上传的世界书");
  if (flags.regexPending) pendingUploads.push("待上传的正则");
  return pendingUploads.length > 0 ? `请先完成保存或上传后再提交审核：${pendingUploads.join("、")}。` : null;
}

function useDraftUploadActions(options: DraftSubmissionOptions) {
  const { entry, workingVersionId, rowVersion, setRowVersion, busy, setBusy, workingVersionFrozen, dirty, cover } =
    options;
  const { assets, setWorkingVersionId, setCoverNonce, onRefresh, onNotice, onError } = options;

  async function runBusy(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await work();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSavedEntry(kind: "worldbook" | "regex", key: string): Promise<void> {
    if (!workingVersionId || busy || workingVersionFrozen || dirty) return;
    setBusy(true);
    try {
      const result = await api.deleteProjectEntry(entry.project.id, workingVersionId, rowVersion, kind, key);
      setRowVersion(result.rowVersion);
      setWorkingVersionId(result.versionId);
      assets.setWorldbook(null);
      assets.regexAssetsRef.current = [];
      assets.setRegexAssets([]);
      assets.setWorldbookUploaded(false);
      assets.setRegexUploaded(false);
      assets.setSubmitNotice(null);
      assets.selectionVersion.current += 1;
      assets.assetGeneration.current += 1;
      assets.setParsingAssets(0);
      onNotice("条目已从当前草稿移除；提交审核通过后生效。");
      await onRefresh().catch((reason: unknown) => onError(`条目已移除，刷新失败：${String(reason)}`));
    } finally {
      setBusy(false);
    }
  }

  async function uploadWorldbook(): Promise<void> {
    if (!assets.worldbook || !workingVersionId || busy || workingVersionFrozen) return;
    const file = assets.worldbook.file;
    const version = assets.selectionVersion.current;
    await runBusy(async () => {
      const result = await api.uploadFile(entry.project.id, workingVersionId, rowVersion, "worldbook", file);
      setRowVersion(result.rowVersion);
      if (version === assets.selectionVersion.current) assets.setWorldbookUploaded(true);
      assets.setSubmitNotice(null);
      onNotice("世界书已上传到当前草稿版本。");
      await onRefresh();
    });
  }

  async function uploadRegex(): Promise<void> {
    if (assets.regexAssets.length === 0 || !workingVersionId || busy || workingVersionFrozen) return;
    const selected = assets.regexAssets;
    const version = assets.selectionVersion.current;
    const file = mergedRegexUpload(selected);
    if (!file) return;
    await runBusy(async () => {
      const result = await api.uploadFile(entry.project.id, workingVersionId, rowVersion, "regex", file);
      setRowVersion(result.rowVersion);
      if (version === assets.selectionVersion.current) assets.setRegexUploaded(true);
      assets.setSubmitNotice(null);
      onNotice(selected.length > 1 ? `已合并 ${selected.length} 个正则文件并上传。` : "正则已上传到当前草稿版本。");
      await onRefresh();
    });
  }

  async function uploadCover(): Promise<void> {
    const pending = cover.pending;
    if (!pending || !workingVersionId || busy || workingVersionFrozen) return;
    await runBusy(async () => {
      const result = await api.uploadFile(entry.project.id, workingVersionId, rowVersion, "cover", pending.file);
      setRowVersion(result.rowVersion);
      cover.clear();
      setCoverNonce((value) => value + 1);
      onNotice("封面已上传。");
      await onRefresh();
    });
  }

  return { deleteSavedEntry, uploadWorldbook, uploadRegex, uploadCover };
}

export function useDraftSubmissionActions(options: DraftSubmissionOptions) {
  const uploads = useDraftUploadActions(options);
  const {
    entry,
    form,
    workingVersionId,
    setWorkingVersionId,
    rowVersion,
    setRowVersion,
    busy,
    setBusy,
    workingVersionFrozen,
    dirty,
    metadataDirty,
    cover,
    assets,
    check,
    setHistoryNonce,
    setSubmittedVersionId,
    setConfirm,
    pendingWithdraw,
    setPendingWithdraw,
    onRefresh,
    onNotice,
    onError,
  } = options;

  async function createFirstVersion(): Promise<void> {
    if (busy || !form.projectType) return;
    setBusy(true);
    try {
      const result = await api.createVersion(entry.project.id, rowVersion, metadataPayload(form));
      setWorkingVersionId(result.versionId);
      setRowVersion(result.rowVersion);
      assets.setWorldbook(null);
      assets.setRegexAssets([]);
      await onRefresh();
      onNotice("已创建新版本，现在可以上传文件。");
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function sendSubmission(): Promise<void> {
    if (busy || dirty || !workingVersionId || workingVersionFrozen) {
      setConfirm(null);
      return;
    }
    setConfirm(null);
    setBusy(true);
    try {
      const result = await api.submitProject(entry.project.id, workingVersionId, rowVersion, {
        gate: check?.gate,
        checkerVersion: check ? `${check.report.engine}/${check.report.policyVersion}` : undefined,
      });
      setRowVersion(result.rowVersion);
      setSubmittedVersionId(workingVersionId);
      void api.reportProjectChange(entry.project.id, workingVersionId).catch(() => undefined);
      onNotice(check ? "已提交审核，服务器将执行复核。" : "已提交审核，正在等待审核处理。");
      setHistoryNonce((value) => value + 1);
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function confirmWithdrawSubmission(): Promise<void> {
    if (!pendingWithdraw || busy) return;
    const submission = pendingWithdraw;
    setBusy(true);
    try {
      const result = await api.withdrawSubmission(entry.project.id, submission.id, rowVersion);
      setRowVersion(result.rowVersion);
      setPendingWithdraw(null);
      setHistoryNonce((value) => value + 1);
      await onRefresh();
      onNotice("提交已撤回，线上公开版本不受影响；如需继续修改请点击「新建版本」。");
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  function submit(): void {
    if (busy || assets.parsingAssets > 0 || !workingVersionId || workingVersionFrozen) return;
    const notice = buildPendingUploadNotice({
      metadataDirty,
      coverPending: Boolean(cover.pending),
      worldbookPending: Boolean(assets.worldbook && !assets.worldbookUploaded),
      regexPending: assets.regexAssets.length > 0 && !assets.regexUploaded,
    });
    if (notice) {
      assets.setSubmitNotice(notice);
      return;
    }
    assets.setSubmitNotice(null);
    if (!check) setConfirm({ kind: "missing" });
    else if (check.gate === "block") setConfirm({ kind: "block" });
    else if (check.gate === "warn" || check.warnings.length > 0) setConfirm({ kind: "warn" });
    else void sendSubmission();
  }

  return { ...uploads, createFirstVersion, sendSubmission, confirmWithdrawSubmission, submit };
}

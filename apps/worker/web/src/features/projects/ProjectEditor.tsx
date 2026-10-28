import { useEffect, useMemo, useRef, useState } from "react";
import { type AuthorProject, type AuthorSubmission, api } from "../../api";
import { ProjectDraftMetadata, ProjectMetadataWarnings } from "./authoring/ProjectDraftMetadata";
import { ProjectSubmissionReview } from "./authoring/ProjectSubmissionReview";
import { useDraftAssetSelection } from "./authoring/useDraftAssetSelection";
import { useDraftCoverAndHistory } from "./authoring/useDraftCoverAndHistory";
import { useDraftMetadataActions } from "./authoring/useDraftMetadataActions";
import "../../styles/workspaces.css";
import { AssetPicker } from "./authoring/AssetPicker";
import { CheckPanel } from "./authoring/CheckPanel";
import { CurrentRevisionEntries } from "./authoring/CurrentRevisionEntries";
import { runLocalCheck } from "./authoring/checker";
import { ImagePicker } from "./authoring/ImagePicker";
import { mergedRegexUpload } from "./authoring/preview";
import { SubmissionHistory } from "./authoring/SubmissionHistory";
import { usePendingImage } from "./authoring/usePendingImage";
import { metadataPayload, type ProjectForm, projectForm } from "./projectMetadata";

export function ProjectEditor({
  entry,
  onRefresh,
  onError,
  onNotice,
  onDirtyChange,
}: {
  entry: AuthorProject;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [form, setForm] = useState<ProjectForm>(() => projectForm(entry.project, entry));
  const [savedForm, setSavedForm] = useState(() => JSON.stringify(projectForm(entry.project, entry)));
  const [workingRevisionId, setWorkingRevisionId] = useState(entry.workingRevisionId);
  const [rowVersion, setRowVersion] = useState(entry.rowVersion);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: "warn" | "block" | "missing" }>(null);
  const [submittedRevisionId, setSubmittedRevisionId] = useState<string | null>(null);
  const cover = usePendingImage();
  const clearCover = cover.clear;
  const resetIdentity = useRef<{ projectId: string; revisionId: string | null } | null>(null);
  const workingRevisionFrozen = Boolean(
    (entry.latestSubmission && entry.latestSubmission.revisionId === workingRevisionId) ||
      (workingRevisionId && submittedRevisionId === workingRevisionId),
  );
  const {
    reset: resetAssets,
    worldbook,
    setWorldbook,
    regexAssets,
    setRegexAssets,
    worldbookError,
    regexError,
    worldbookUploaded,
    setWorldbookUploaded,
    regexUploaded,
    setRegexUploaded,
    submitNotice,
    setSubmitNotice,
    parsingAssets,
    setParsingAssets,
    assetGeneration,
    selectionVersion,
    regexAssetsRef,
    pickWorldbook,
    pickRegex,
    removeWorldbook,
    removeRegex,
  } = useDraftAssetSelection(workingRevisionFrozen || busy, onNotice);
  const { coverUrl, setCoverNonce, submissions, submissionError, setHistoryNonce } = useDraftCoverAndHistory(
    entry.project.id,
    workingRevisionId,
  );
  const check = useMemo(() => runLocalCheck(worldbook, regexAssets), [worldbook, regexAssets]);
  const metadataDirty = JSON.stringify(form) !== savedForm;
  const dirty =
    metadataDirty ||
    parsingAssets > 0 ||
    Boolean(cover.pending) ||
    Boolean(worldbook && !worldbookUploaded) ||
    (regexAssets.length > 0 && !regexUploaded);

  useEffect(() => setRowVersion(entry.rowVersion), [entry.rowVersion]);
  useEffect(() => {
    onDirtyChange?.(dirty || busy);
    const protect = (event: BeforeUnloadEvent): void => {
      if (!dirty && !busy) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => {
      onDirtyChange?.(false);
      window.removeEventListener("beforeunload", protect);
    };
  }, [dirty, busy, onDirtyChange]);

  useEffect(() => {
    // Metadata refreshes must not discard dirty local selections; only a new working revision resets them.
    if (
      resetIdentity.current?.projectId === entry.project.id &&
      resetIdentity.current.revisionId === entry.workingRevisionId
    ) {
      return;
    }
    resetIdentity.current = { projectId: entry.project.id, revisionId: entry.workingRevisionId };
    resetAssets();
    clearCover();
    setForm(projectForm(entry.project, entry));
    setSavedForm(JSON.stringify(projectForm(entry.project, entry)));
    setWorkingRevisionId(entry.workingRevisionId);
  }, [entry, clearCover, resetAssets]);

  useEffect(
    () => () => {
      assetGeneration.current += 1;
    },
    [assetGeneration],
  );

  const { save, remove } = useDraftMetadataActions({
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
  });

  async function createFirstRevision(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.createRevision(entry.project.id, rowVersion, metadataPayload(form));
      setWorkingRevisionId(result.revisionId);
      setRowVersion(result.rowVersion);
      setWorldbook(null);
      setRegexAssets([]);
      await onRefresh();
      onNotice(`已创建新版本（版本 ${result.rowVersion}），现在可以上传文件。`);
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSavedEntry(kind: "worldbook" | "regex", key: string): Promise<void> {
    if (!workingRevisionId || busy || workingRevisionFrozen || dirty) return;
    setBusy(true);
    try {
      const result = await api.deleteProjectEntry(entry.project.id, workingRevisionId, rowVersion, kind, key);
      setRowVersion(result.rowVersion);
      setWorkingRevisionId(result.revisionId);
      setWorldbook(null);
      regexAssetsRef.current = [];
      setRegexAssets([]);
      setWorldbookUploaded(false);
      setRegexUploaded(false);
      setSubmitNotice(null);
      selectionVersion.current += 1;
      assetGeneration.current += 1;
      setParsingAssets(0);
      onNotice("条目已从新的工作版本删除；公开版本不变，请通过统一送审提交本次修改。");
      await onRefresh().catch((reason: unknown) => onError(`条目已删除，但刷新项目信息失败：${String(reason)}`));
    } finally {
      setBusy(false);
    }
  }

  async function uploadWorldbook(): Promise<void> {
    if (!worldbook || !workingRevisionId || busy || workingRevisionFrozen) return;
    const version = selectionVersion.current;
    setBusy(true);
    try {
      const result = await api.uploadFile(entry.project.id, workingRevisionId, rowVersion, "worldbook", worldbook.file);
      setRowVersion(result.rowVersion);
      if (version === selectionVersion.current) setWorldbookUploaded(true);
      setSubmitNotice(null);
      onNotice("世界书已上传到当前版本。");
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function uploadRegex(): Promise<void> {
    if (regexAssets.length === 0 || !workingRevisionId || busy || workingRevisionFrozen) return;
    const selected = regexAssets;
    const version = selectionVersion.current;
    const file = mergedRegexUpload(selected);
    if (!file) return;
    setBusy(true);
    try {
      const result = await api.uploadFile(entry.project.id, workingRevisionId, rowVersion, "regex", file);
      setRowVersion(result.rowVersion);
      if (version === selectionVersion.current) setRegexUploaded(true);
      setSubmitNotice(null);
      onNotice(selected.length > 1 ? `已合并 ${selected.length} 个正则文件并上传。` : "正则已上传到当前版本。");
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function uploadCover(): Promise<void> {
    const pending = cover.pending;
    if (!pending || !workingRevisionId || busy || workingRevisionFrozen) return;
    setBusy(true);
    try {
      const result = await api.uploadFile(entry.project.id, workingRevisionId, rowVersion, "cover", pending.file);
      setRowVersion(result.rowVersion);
      cover.clear();
      setCoverNonce((value) => value + 1);
      onNotice("封面已上传。");
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function sendSubmission(acknowledged: boolean): Promise<void> {
    if (busy || dirty || !workingRevisionId || workingRevisionFrozen) {
      setConfirm(null);
      return;
    }
    setConfirm(null);
    setBusy(true);
    try {
      const result = await api.submitProject(entry.project.id, workingRevisionId, rowVersion, {
        gate: check?.gate ?? "missing",
        checkerRevision: check ? `${check.report.engine}/${check.report.policyVersion}` : undefined,
        warningCount: check?.warnings.length ?? 0,
        acknowledged,
      });
      setRowVersion(result.rowVersion);
      setSubmittedRevisionId(workingRevisionId);
      onNotice(
        check
          ? "已提交审核；客户端自检只覆盖本次选择的文件，服务器会重新检查。"
          : "已提交审核；本次未在本地检查的版本会进入人工审核。",
      );
      setHistoryNonce((value) => value + 1);
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(submission: AuthorSubmission): Promise<void> {
    if (busy || !window.confirm("撤回这次提交？检查完成后也不会发布该快照，当前公开版本不受影响。")) return;
    setBusy(true);
    try {
      const result = await api.withdrawSubmission(entry.project.id, submission.id, rowVersion);
      setRowVersion(result.rowVersion);
      setHistoryNonce((value) => value + 1);
      await onRefresh();
      onNotice("提交已撤回，历史保留。继续修改请新建版本。");
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  function submit(): void {
    if (busy || parsingAssets > 0 || !workingRevisionId || workingRevisionFrozen) return;
    const pendingUploads: string[] = [];
    if (metadataDirty) pendingUploads.push("未保存的资料（先保存草稿资料）");
    if (cover.pending) pendingUploads.push("封面");
    if (worldbook && !worldbookUploaded) pendingUploads.push("世界书");
    if (regexAssets.length > 0 && !regexUploaded) pendingUploads.push("正则");
    if (pendingUploads.length > 0) {
      setSubmitNotice(`上传所选文件后再提交：${pendingUploads.join("、")}。客户端自检只覆盖已上传到当前版本的内容。`);
      return;
    }
    setSubmitNotice(null);
    if (!check) {
      setConfirm({ kind: "missing" });
      return;
    }
    if (check.gate === "block") {
      setConfirm({ kind: "block" });
      return;
    }
    if (check.gate === "warn" || check.warnings.length > 0) {
      setConfirm({ kind: "warn" });
      return;
    }
    void sendSubmission(false);
  }

  return (
    <section className="panel editor">
      <div className="panel-heading">
        <div>
          <h2>编辑项目</h2>
          <p className="hint">{entry.project.visibility === "public" ? "公开展示中" : "仅自己可见"} · 草稿内容</p>
        </div>
        <button type="button" onClick={() => void remove()} disabled={busy}>
          删除项目
        </button>
      </div>
      {workingRevisionFrozen ? (
        <p className="notice">
          资料、封面与内容已作为同一快照提交并冻结。继续修改请新建版本；新提交会重新审核，当前公开版本保持不变。
        </p>
      ) : null}

      <div className="task-save-state" role="status">
        <span>资料：{metadataDirty ? "未保存" : "已保存为草稿"}</span>
        <span>
          文件：
          {dirty && !metadataDirty
            ? "有待上传文件"
            : worldbookUploaded || regexUploaded
              ? "所选文件已上传"
              : "使用当前版本文件"}
        </span>
        <span>提交：{workingRevisionFrozen ? "已冻结，历史保留" : "尚未提交；公开版本不受影响"}</span>
      </div>
      <ProjectDraftMetadata form={form} setForm={setForm} disabled={busy || workingRevisionFrozen} />

      <section className="workspace-section authoring-section">
        <h3>内容文件</h3>
        <CurrentRevisionEntries
          projectId={entry.project.id}
          revisionId={workingRevisionId}
          rowVersion={rowVersion}
          busy={busy}
          frozen={workingRevisionFrozen}
          dirty={dirty}
          onDelete={deleteSavedEntry}
        />
        <AssetPicker
          worldbook={worldbook}
          regexAssets={regexAssets}
          worldbookError={worldbookError}
          regexError={regexError}
          worldbookUploaded={worldbookUploaded}
          regexUploaded={regexUploaded}
          busy={busy || workingRevisionFrozen}
          projectType={form.projectType}
          onPickWorldbook={pickWorldbook}
          onPickRegex={pickRegex}
          onRemoveWorldbook={removeWorldbook}
          onRemoveRegex={removeRegex}
          onUploadWorldbook={() => void uploadWorldbook()}
          onUploadRegex={() => void uploadRegex()}
        />
        {check ? (
          <CheckPanel
            check={check}
            worldbook={worldbook}
            regexAssets={regexAssets}
            onNotice={onNotice}
            onError={onError}
          />
        ) : (
          <p className="workspace-muted">
            选择世界书或正则文件后会在这里显示客户端自检结果。也可以直接上传已确认的文件。
          </p>
        )}
      </section>

      <section className="workspace-section authoring-section">
        <h3>封面</h3>
        <ImagePicker
          id="cover-file"
          label="选择封面"
          uploadLabel={coverUrl ? "更新封面" : "上传封面"}
          hint="JPEG、PNG 或 WebP，单张不超过 5 MiB，宽高不超过 4096 像素。选择后可以先预览再上传。"
          disabled={busy || workingRevisionFrozen}
          currentUrl={coverUrl}
          currentAlt="当前封面"
          pending={cover.pending}
          error={cover.error}
          onPick={(file) => void cover.pick(file)}
          onClear={cover.clear}
          onUpload={() => void uploadCover()}
        />
      </section>

      <div className="actions">
        <button type="button" className="primary" onClick={() => void save()} disabled={busy || workingRevisionFrozen}>
          保存草稿资料
        </button>
        {!workingRevisionId ? (
          <button type="button" onClick={() => void createFirstRevision()} disabled={busy}>
            创建首个版本
          </button>
        ) : null}
      </div>

      <ProjectMetadataWarnings findings={entry.metadataFindings} />
      <ProjectSubmissionReview
        check={check}
        busy={busy}
        disabled={busy || parsingAssets > 0 || !workingRevisionId || workingRevisionFrozen}
        submitNotice={submitNotice}
        confirm={confirm}
        onSubmit={submit}
        onConfirm={() => void sendSubmission(true)}
        onCancel={() => setConfirm(null)}
      >
        <SubmissionHistory
          items={submissions}
          error={submissionError}
          busy={busy}
          onWithdraw={(submission) => void withdraw(submission)}
        />
      </ProjectSubmissionReview>
    </section>
  );
}

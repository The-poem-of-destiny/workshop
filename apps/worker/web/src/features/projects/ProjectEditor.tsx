import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { type AuthorProject, api } from "../../api";
import "../../styles/workspaces.css";
import { AssetPicker } from "./authoring/AssetPicker";
import { CheckPanel } from "./authoring/CheckPanel";
import { runLocalCheck } from "./authoring/checker";
import { ImagePicker } from "./authoring/ImagePicker";
import { ProjectDraftMetadata, ProjectMetadataWarnings } from "./authoring/ProjectDraftMetadata";
import { ProjectSubmissionReview } from "./authoring/ProjectSubmissionReview";
import { mergedRegexUpload } from "./authoring/preview";
import { SubmissionHistory } from "./authoring/SubmissionHistory";
import { useDraftAssetSelection } from "./authoring/useDraftAssetSelection";
import { useDraftCoverAndHistory } from "./authoring/useDraftCoverAndHistory";
import { useDraftMetadataActions } from "./authoring/useDraftMetadataActions";
import { usePendingImage } from "./authoring/usePendingImage";
import { metadataPayload, type ProjectForm, projectForm } from "./projectMetadata";

export function ProjectEditor({
  entry,
  onRefresh,
  onError,
  onNotice,
}: {
  entry: AuthorProject;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [form, setForm] = useState<ProjectForm>(() => projectForm(entry.project, entry));
  const [workingRevisionId, setWorkingRevisionId] = useState(entry.workingRevisionId);
  const [busy, setBusy] = useState(false);
  const { coverUrl, setCoverNonce, submissions, submissionError, setHistoryNonce } = useDraftCoverAndHistory(
    entry.project.id,
    workingRevisionId,
  );
  const [confirm, setConfirm] = useState<null | { kind: "warn" | "missing" }>(null);
  const workingRevisionFrozen = Boolean(
    entry.latestSubmission && entry.latestSubmission.revisionId === workingRevisionId,
  );
  const {
    worldbook,
    setWorldbook,
    regexAssets,
    setRegexAssets,
    worldbookError,
    setWorldbookError,
    regexError,
    setRegexError,
    worldbookUploaded,
    setWorldbookUploaded,
    regexUploaded,
    setRegexUploaded,
    submitNotice,
    setSubmitNotice,
    assetGeneration,
    selectionVersion,
    regexAssetsRef,
    pickWorldbook,
    pickRegex,
    removeWorldbook,
    removeRegex,
  } = useDraftAssetSelection(workingRevisionFrozen, onNotice);
  const cover = usePendingImage();
  const check = useMemo(() => runLocalCheck(worldbook, regexAssets), [worldbook, regexAssets]);

  const resetDraft = useEffectEvent(() => {
    assetGeneration.current += 1;
    selectionVersion.current += 1;
    cover.clear();
    setForm(projectForm(entry.project, entry));
    setWorkingRevisionId(entry.workingRevisionId);
    setWorldbook(null);
    regexAssetsRef.current = [];
    setRegexAssets([]);
    setWorldbookError(null);
    setRegexError(null);
    setWorldbookUploaded(false);
    setRegexUploaded(false);
    setSubmitNotice(null);
  });
  const projectId = entry.project.id;
  const entryRevisionId = entry.workingRevisionId;
  const previousDraft = useRef<{ projectId: string; revisionId: string | null } | null>(null);
  useEffect(() => {
    if (previousDraft.current?.projectId !== projectId || previousDraft.current.revisionId !== entryRevisionId) {
      previousDraft.current = { projectId, revisionId: entryRevisionId };
      resetDraft();
    }
  }, [projectId, entryRevisionId]);

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
    onRefresh,
    onNotice,
    onError,
  });

  async function createFirstRevision(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.createRevision(entry.project.id, entry.rowVersion, metadataPayload(form));
      setWorkingRevisionId(result.revisionId);
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

  async function uploadWorldbook(): Promise<void> {
    if (!worldbook || !workingRevisionId || busy || workingRevisionFrozen) return;
    const version = selectionVersion.current;
    setBusy(true);
    try {
      await api.uploadFile(entry.project.id, workingRevisionId, entry.rowVersion, "worldbook", worldbook.file);
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
      await api.uploadFile(entry.project.id, workingRevisionId, entry.rowVersion, "regex", file);
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
      await api.uploadFile(entry.project.id, workingRevisionId, entry.rowVersion, "cover", pending.file);
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
    if (busy || !workingRevisionId || workingRevisionFrozen) {
      setConfirm(null);
      return;
    }
    setConfirm(null);
    setBusy(true);
    try {
      await api.submitProject(entry.project.id, workingRevisionId, entry.rowVersion, {
        gate: check?.gate ?? "missing",
        checkerRevision: check ? `${check.report.engine}/${check.report.policyVersion}` : undefined,
        warningCount: check?.warnings.length ?? 0,
        acknowledged,
      });
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

  function submit(): void {
    if (busy || !workingRevisionId || workingRevisionFrozen) return;
    const pendingUploads: string[] = [];
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
      onError("客户端检查发现阻断问题，请先修复后再提交。");
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
          这个版本已提交并冻结，无法再修改或上传文件。如需继续修改，请在上方状态提示中新建版本；公开展示信息可在「公开展示」页单独编辑。
        </p>
      ) : null}

      <ProjectDraftMetadata form={form} setForm={setForm} disabled={busy || workingRevisionFrozen} />

      <section className="workspace-section authoring-section">
        <h3>内容文件</h3>
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
          保存元数据
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
        disabled={busy || !workingRevisionId || workingRevisionFrozen}
        submitNotice={submitNotice}
        confirm={confirm}
        onSubmit={submit}
        onConfirm={() => void sendSubmission(true)}
        onCancel={() => setConfirm(null)}
      >
        <SubmissionHistory items={submissions} error={submissionError} />
      </ProjectSubmissionReview>
    </section>
  );
}

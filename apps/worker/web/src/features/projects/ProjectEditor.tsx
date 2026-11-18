import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { type AuthorCollection, type AuthorProject, type AuthorSubmission, api } from "../../api";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { ProjectDraftMetadata } from "./authoring/ProjectDraftMetadata";
import { ProjectSubmissionReview } from "./authoring/ProjectSubmissionReview";
import { useDraftAssetSelection } from "./authoring/useDraftAssetSelection";
import { useDraftCoverAndHistory } from "./authoring/useDraftCoverAndHistory";
import { useDraftMetadataActions } from "./authoring/useDraftMetadataActions";
import "../../styles/workspaces.css";
import { AssetPicker } from "./authoring/AssetPicker";
import { CheckPanel } from "./authoring/CheckPanel";
import { CurrentVersionEntries } from "./authoring/CurrentVersionEntries";
import { runLocalCheck } from "./authoring/checker";
import { GallerySection } from "./authoring/GallerySection";
import { ImagePicker } from "./authoring/ImagePicker";
import { ProjectDangerZone } from "./authoring/ProjectDangerZone";
import { mergedRegexUpload } from "./authoring/preview";
import { SubmissionHistory } from "./authoring/SubmissionHistory";
import { usePendingImage } from "./authoring/usePendingImage";
import { ProjectCollectionsField } from "./CollectionsManager";
import { metadataPayload, type ProjectForm, projectForm } from "./projectMetadata";

const EDITOR_SECTIONS = [
  { id: "editor-sec-basics", label: "① 基础与标签" },
  { id: "editor-sec-visuals", label: "② 封面与展示图" },
  { id: "editor-sec-files", label: "③ 内容文件" },
  { id: "editor-sec-collections", label: "④ 合集与记录" },
  { id: "editor-sec-danger", label: "⑤ 可见性与删除" },
] as const;

export function ProjectEditor({
  entry,
  collections = [],
  statusBanner,
  onRefresh,
  onError,
  onNotice,
  onDirtyChange,
}: {
  entry: AuthorProject;
  collections?: AuthorCollection[];
  statusBanner?: ReactNode;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [form, setForm] = useState<ProjectForm>(() => projectForm(entry.project, entry));
  const [savedForm, setSavedForm] = useState(() => JSON.stringify(projectForm(entry.project, entry)));
  const [workingVersionId, setWorkingVersionId] = useState(entry.workingVersionId);
  const [rowVersion, setRowVersion] = useState(entry.rowVersion);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: "warn" | "block" | "missing" }>(null);
  const [pendingWithdraw, setPendingWithdraw] = useState<AuthorSubmission | null>(null);
  const [galleryPending, setGalleryPending] = useState(false);
  const [submittedVersionId, setSubmittedVersionId] = useState<string | null>(null);
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const cover = usePendingImage();
  const clearCover = cover.clear;
  const resetIdentity = useRef<{ projectId: string; versionId: string | null } | null>(null);
  const workingVersionFrozen = Boolean(
    (workingVersionId && entry.project.publishedVersionId === workingVersionId) ||
      (entry.latestSubmission && entry.latestSubmission.versionId === workingVersionId) ||
      (workingVersionId && submittedVersionId === workingVersionId),
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
  } = useDraftAssetSelection(workingVersionFrozen || busy, onNotice);
  const { coverUrl, setCoverNonce, submissions, submissionError, setHistoryNonce } = useDraftCoverAndHistory(
    entry.project.id,
    workingVersionId,
  );
  const check = useMemo(() => runLocalCheck(worldbook, regexAssets), [worldbook, regexAssets]);
  const metadataDirty = JSON.stringify(form) !== savedForm;
  const hasPendingFiles =
    Boolean(cover.pending) ||
    galleryPending ||
    Boolean(worldbook && !worldbookUploaded) ||
    (regexAssets.length > 0 && !regexUploaded);
  const dirty = metadataDirty || parsingAssets > 0 || hasPendingFiles;

  useEffect(() => setRowVersion(entry.rowVersion), [entry.rowVersion]);
  useUnsavedProtection(dirty || busy, onDirtyChange);

  useEffect(() => {
    if (
      resetIdentity.current?.projectId === entry.project.id &&
      resetIdentity.current.versionId === entry.workingVersionId
    ) {
      return;
    }
    resetIdentity.current = { projectId: entry.project.id, versionId: entry.workingVersionId };
    resetAssets();
    clearCover();
    setForm(projectForm(entry.project, entry));
    setSavedForm(JSON.stringify(projectForm(entry.project, entry)));
    setWorkingVersionId(entry.workingVersionId);
  }, [entry, clearCover, resetAssets]);

  useEffect(
    () => () => {
      assetGeneration.current += 1;
    },
    [assetGeneration],
  );

  const { save } = useDraftMetadataActions({
    entry,
    form,
    busy,
    workingVersionFrozen,
    setBusy,
    rowVersion,
    setRowVersion,
    setSavedForm,
    onRefresh,
    onNotice,
    onError,
  });

  async function createFirstVersion(): Promise<void> {
    if (busy || !form.projectType) return;
    setBusy(true);
    try {
      const result = await api.createVersion(entry.project.id, rowVersion, metadataPayload(form));
      setWorkingVersionId(result.versionId);
      setRowVersion(result.rowVersion);
      setWorldbook(null);
      setRegexAssets([]);
      await onRefresh();
      onNotice("已创建新版本，现在可以上传文件。");
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
      setWorldbook(null);
      regexAssetsRef.current = [];
      setRegexAssets([]);
      setWorldbookUploaded(false);
      setRegexUploaded(false);
      setSubmitNotice(null);
      selectionVersion.current += 1;
      assetGeneration.current += 1;
      setParsingAssets(0);
      onNotice("条目已从当前草稿移除；提交审核通过后生效。");
      await onRefresh().catch((reason: unknown) => onError(`条目已移除，刷新失败：${String(reason)}`));
    } finally {
      setBusy(false);
    }
  }

  async function uploadWorldbook(): Promise<void> {
    if (!worldbook || !workingVersionId || busy || workingVersionFrozen) return;
    const version = selectionVersion.current;
    setBusy(true);
    try {
      const result = await api.uploadFile(entry.project.id, workingVersionId, rowVersion, "worldbook", worldbook.file);
      setRowVersion(result.rowVersion);
      if (version === selectionVersion.current) setWorldbookUploaded(true);
      setSubmitNotice(null);
      onNotice("世界书已上传到当前草稿版本。");
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function uploadRegex(): Promise<void> {
    if (regexAssets.length === 0 || !workingVersionId || busy || workingVersionFrozen) return;
    const selected = regexAssets;
    const version = selectionVersion.current;
    const file = mergedRegexUpload(selected);
    if (!file) return;
    setBusy(true);
    try {
      const result = await api.uploadFile(entry.project.id, workingVersionId, rowVersion, "regex", file);
      setRowVersion(result.rowVersion);
      if (version === selectionVersion.current) setRegexUploaded(true);
      setSubmitNotice(null);
      onNotice(selected.length > 1 ? `已合并 ${selected.length} 个正则文件并上传。` : "正则已上传到当前草稿版本。");
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function uploadCover(): Promise<void> {
    const pending = cover.pending;
    if (!pending || !workingVersionId || busy || workingVersionFrozen) return;
    setBusy(true);
    try {
      const result = await api.uploadFile(entry.project.id, workingVersionId, rowVersion, "cover", pending.file);
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
    if (busy || parsingAssets > 0 || !workingVersionId || workingVersionFrozen) return;
    const notice = buildPendingUploadNotice({
      metadataDirty,
      coverPending: Boolean(cover.pending),
      worldbookPending: Boolean(worldbook && !worldbookUploaded),
      regexPending: regexAssets.length > 0 && !regexUploaded,
    });
    if (notice) {
      setSubmitNotice(notice);
      return;
    }
    setSubmitNotice(null);
    if (!check) setConfirm({ kind: "missing" });
    else if (check.gate === "block") setConfirm({ kind: "block" });
    else if (check.gate === "warn" || check.warnings.length > 0) setConfirm({ kind: "warn" });
    else void sendSubmission();
  }

  const posX = Number(form.coverPositionX) || 50;
  const posY = Number(form.coverPositionY) || 50;
  const zoom = Number(form.coverZoom) || 1;

  return (
    <>
      <EditorJumpNav scrollBodyRef={scrollBodyRef} />

      <div ref={scrollBodyRef} className="task-workspace-body">
        {statusBanner}
        <div className="panel editor">
          <ProjectDraftMetadata form={form} setForm={setForm} disabled={busy || workingVersionFrozen} />

          <ProjectVisualsSection
            projectId={entry.project.id}
            rowVersion={rowVersion}
            busy={busy}
            frozen={workingVersionFrozen}
            coverUrl={coverUrl}
            cover={cover}
            posX={posX}
            posY={posY}
            zoom={zoom}
            onCropChange={(next) =>
              setForm((prev) => ({
                ...prev,
                coverPositionX: String(next.posX),
                coverPositionY: String(next.posY),
                coverZoom: String(next.zoom),
              }))
            }
            onUploadCover={() => void uploadCover()}
            setBusy={setBusy}
            onRowVersionChange={setRowVersion}
            onRefresh={onRefresh}
            onNotice={onNotice}
            onError={onError}
            onPendingChange={setGalleryPending}
          />

          <ProjectFilesSection
            projectId={entry.project.id}
            versionId={workingVersionId}
            rowVersion={rowVersion}
            busy={busy}
            frozen={workingVersionFrozen}
            dirty={dirty}
            worldbook={worldbook}
            regexAssets={regexAssets}
            worldbookError={worldbookError}
            regexError={regexError}
            worldbookUploaded={worldbookUploaded}
            regexUploaded={regexUploaded}
            check={check}
            onPickWorldbook={pickWorldbook}
            onPickRegex={pickRegex}
            onRemoveWorldbook={removeWorldbook}
            onRemoveRegex={removeRegex}
            onUploadWorldbook={() => void uploadWorldbook()}
            onUploadRegex={() => void uploadRegex()}
            onDelete={deleteSavedEntry}
            onNotice={onNotice}
            onError={onError}
          />

          <ProjectManagementSections
            entry={entry}
            collections={collections}
            rowVersion={rowVersion}
            busy={busy}
            submissions={submissions}
            submissionError={submissionError}
            setBusy={setBusy}
            onRowVersionChange={setRowVersion}
            onRefresh={onRefresh}
            onNotice={onNotice}
            onError={onError}
            onWithdraw={(submission) => setPendingWithdraw(submission)}
          />
        </div>
      </div>

      <ProjectSubmissionReview
        check={check}
        busy={busy}
        disabled={busy || parsingAssets > 0 || !workingVersionId || workingVersionFrozen}
        saveDisabled={busy || workingVersionFrozen}
        metadataDirty={metadataDirty}
        hasPendingFiles={hasPendingFiles}
        frozen={workingVersionFrozen}
        hasWorkingVersion={Boolean(workingVersionId)}
        submitNotice={submitNotice}
        confirm={confirm}
        onSave={() => void save()}
        onCreateFirstVersion={() => void createFirstVersion()}
        onSubmit={submit}
        onConfirm={() => void sendSubmission()}
        onCancel={() => setConfirm(null)}
      />

      <ConfirmDialog
        open={pendingWithdraw !== null}
        title="撤回审核提交"
        description="确定撤回本次提交吗？撤回后该版本不会发布，线上已发布版本保持不变。"
        confirmLabel="确认撤回"
        busy={busy}
        onConfirm={() => void confirmWithdrawSubmission()}
        onCancel={() => setPendingWithdraw(null)}
      />
    </>
  );
}

function buildPendingUploadNotice({
  metadataDirty,
  coverPending,
  worldbookPending,
  regexPending,
}: {
  metadataDirty: boolean;
  coverPending: boolean;
  worldbookPending: boolean;
  regexPending: boolean;
}): string | null {
  const pendingUploads: string[] = [];
  if (metadataDirty) pendingUploads.push("未保存的资料修改（请先点左侧「保存草稿资料」）");
  if (coverPending) pendingUploads.push("待上传的封面");
  if (worldbookPending) pendingUploads.push("待上传的世界书");
  if (regexPending) pendingUploads.push("待上传的正则");
  return pendingUploads.length > 0 ? `请先完成保存或上传后再提交审核：${pendingUploads.join("、")}。` : null;
}

function EditorJumpNav({ scrollBodyRef }: { scrollBodyRef: RefObject<HTMLDivElement | null> }) {
  return (
    <nav className="editor-jump-nav" aria-label="编辑分区快速跳转">
      {EDITOR_SECTIONS.map((sec) => (
        <button
          key={sec.id}
          type="button"
          onClick={() => {
            scrollBodyRef.current
              ?.querySelector<HTMLElement>(`#${sec.id}`)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          {sec.label}
        </button>
      ))}
    </nav>
  );
}

function ProjectFilesSection({
  projectId,
  versionId,
  rowVersion,
  busy,
  frozen,
  dirty,
  worldbook,
  regexAssets,
  worldbookError,
  regexError,
  worldbookUploaded,
  regexUploaded,
  check,
  onPickWorldbook,
  onPickRegex,
  onRemoveWorldbook,
  onRemoveRegex,
  onUploadWorldbook,
  onUploadRegex,
  onDelete,
  onNotice,
  onError,
}: {
  projectId: string;
  versionId: string | null;
  rowVersion: number;
  busy: boolean;
  frozen: boolean;
  dirty: boolean;
  worldbook: ReturnType<typeof useDraftAssetSelection>["worldbook"];
  regexAssets: ReturnType<typeof useDraftAssetSelection>["regexAssets"];
  worldbookError: string | null;
  regexError: string | null;
  worldbookUploaded: boolean;
  regexUploaded: boolean;
  check: ReturnType<typeof runLocalCheck>;
  onPickWorldbook: ReturnType<typeof useDraftAssetSelection>["pickWorldbook"];
  onPickRegex: ReturnType<typeof useDraftAssetSelection>["pickRegex"];
  onRemoveWorldbook: () => void;
  onRemoveRegex: (index: number) => void;
  onUploadWorldbook: () => void;
  onUploadRegex: () => void;
  onDelete: (kind: "worldbook" | "regex", key: string) => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  return (
    <section id="editor-sec-files" className="workspace-section authoring-section authoring-card">
      <h3>③ 内容文件与本地预检</h3>
      <AssetPicker
        worldbook={worldbook}
        regexAssets={regexAssets}
        worldbookError={worldbookError}
        regexError={regexError}
        worldbookUploaded={worldbookUploaded}
        regexUploaded={regexUploaded}
        busy={busy || frozen}
        onPickWorldbook={onPickWorldbook}
        onPickRegex={onPickRegex}
        onRemoveWorldbook={onRemoveWorldbook}
        onRemoveRegex={onRemoveRegex}
        onUploadWorldbook={onUploadWorldbook}
        onUploadRegex={onUploadRegex}
      />
      {check ? (
        <CheckPanel
          check={check}
          worldbook={worldbook}
          regexAssets={regexAssets}
          onNotice={onNotice}
          onError={onError}
        />
      ) : null}
      <CurrentVersionEntries
        projectId={projectId}
        versionId={versionId}
        rowVersion={rowVersion}
        busy={busy}
        frozen={frozen}
        dirty={dirty}
        onDelete={onDelete}
      />
    </section>
  );
}

function ProjectManagementSections({
  entry,
  collections,
  rowVersion,
  busy,
  submissions,
  submissionError,
  setBusy,
  onRowVersionChange,
  onRefresh,
  onNotice,
  onError,
  onWithdraw,
}: {
  entry: AuthorProject;
  collections: AuthorCollection[];
  rowVersion: number;
  busy: boolean;
  submissions: AuthorSubmission[];
  submissionError: string | null;
  setBusy: (busy: boolean) => void;
  onRowVersionChange: (version: number) => void;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onWithdraw: (submission: AuthorSubmission) => void;
}) {
  return (
    <>
      <div id="editor-sec-collections" className="editor-collections-history-grid">
        <div className="authoring-card">
          <ProjectCollectionsField
            projectId={entry.project.id}
            initialCollectionIds={entry.collectionIds ?? []}
            collections={collections}
            busy={busy}
            setBusy={setBusy}
            onSaved={onRefresh}
            onNotice={onNotice}
            onError={onError}
          />
        </div>
        <div className="authoring-card">
          <SubmissionHistory items={submissions} error={submissionError} busy={busy} onWithdraw={onWithdraw} />
        </div>
      </div>

      <div id="editor-sec-danger">
        <ProjectDangerZone
          entry={entry}
          rowVersion={rowVersion}
          busy={busy}
          setBusy={setBusy}
          onRowVersionChange={onRowVersionChange}
          onRefresh={onRefresh}
          onNotice={onNotice}
          onError={onError}
        />
      </div>
    </>
  );
}

function ProjectVisualsSection({
  projectId,
  rowVersion,
  busy,
  frozen,
  coverUrl,
  cover,
  posX,
  posY,
  zoom,
  onCropChange,
  onUploadCover,
  setBusy,
  onRowVersionChange,
  onRefresh,
  onNotice,
  onError,
  onPendingChange,
}: {
  projectId: string;
  rowVersion: number;
  busy: boolean;
  frozen: boolean;
  coverUrl: string | null;
  cover: ReturnType<typeof usePendingImage>;
  posX: number;
  posY: number;
  zoom: number;
  onCropChange: (next: { posX: number; posY: number; zoom: number }) => void;
  onUploadCover: () => void;
  setBusy: (busy: boolean) => void;
  onRowVersionChange: (version: number) => void;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onPendingChange: (hasPending: boolean) => void;
}) {
  return (
    <section id="editor-sec-visuals" className="workspace-section authoring-section authoring-card">
      <h3>② 封面构图与详情展示图</h3>
      <div className="editor-visuals-grid">
        <div className="editor-cover-column">
          <h4>作品卡片封面（16:9 实时裁切预览）</h4>
          <ImagePicker
            id="cover-file"
            label="选择封面"
            uploadLabel={coverUrl ? "更新封面" : "上传封面"}
            hint="支持 JPEG / PNG / WebP（≤1 MiB，宽高 ≤4096px）。拖拽上方画面调整构图后记得点击底部「保存草稿资料」。"
            disabled={busy || frozen}
            currentUrl={coverUrl}
            currentAlt="当前封面"
            pending={cover.pending}
            error={cover.error}
            crop={{
              posX,
              posY,
              zoom,
              onChange: onCropChange,
            }}
            onPick={(file) => void cover.pick(file)}
            onClear={cover.clear}
            onUpload={onUploadCover}
          />
        </div>
        <div className="editor-gallery-column">
          <GallerySection
            projectId={projectId}
            rowVersion={rowVersion}
            busy={busy}
            setBusy={setBusy}
            onRowVersionChange={onRowVersionChange}
            onRefresh={onRefresh}
            onNotice={onNotice}
            onError={onError}
            onPendingChange={onPendingChange}
          />
        </div>
      </div>
    </section>
  );
}

function useUnsavedProtection(active: boolean, onDirtyChange?: (dirty: boolean) => void) {
  useEffect(() => {
    onDirtyChange?.(active);
    const protect = (event: BeforeUnloadEvent): void => {
      if (!active) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => {
      onDirtyChange?.(false);
      window.removeEventListener("beforeunload", protect);
    };
  }, [active, onDirtyChange]);
}

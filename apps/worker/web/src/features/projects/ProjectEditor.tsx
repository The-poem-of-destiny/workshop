import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { AuthorCollection, AuthorProject, AuthorSubmission } from "../../api";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { runLocalCheck } from "./authoring/checker";
import { ProjectDangerZone } from "./authoring/ProjectDangerZone";
import { ProjectDraftMetadata } from "./authoring/ProjectDraftMetadata";
import { ProjectFilesSection } from "./authoring/ProjectFilesSection";
import { ProjectSubmissionReview } from "./authoring/ProjectSubmissionReview";
import { ProjectVisualsSection } from "./authoring/ProjectVisualsSection";
import { SubmissionHistory } from "./authoring/SubmissionHistory";
import { useDraftAssetSelection } from "./authoring/useDraftAssetSelection";
import { useDraftCoverAndHistory } from "./authoring/useDraftCoverAndHistory";
import { useDraftMetadataActions } from "./authoring/useDraftMetadataActions";
import { useDraftSubmissionActions } from "./authoring/useDraftSubmissionActions";
import { usePendingImage } from "./authoring/usePendingImage";
import { ProjectCollectionsField } from "./CollectionsManager";
import { type ProjectForm, projectForm } from "./projectMetadata";
import "../../styles/workspaces.css";

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
  const assets = useDraftAssetSelection(workingVersionFrozen || busy, onNotice);
  const {
    reset: resetAssets,
    worldbook,
    regexAssets,
    worldbookError,
    regexError,
    worldbookUploaded,
    regexUploaded,
    submitNotice,
    parsingAssets,
    assetGeneration,
    pickWorldbook,
    pickRegex,
    removeWorldbook,
    removeRegex,
  } = assets;
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

  const {
    createFirstVersion,
    deleteSavedEntry,
    uploadWorldbook,
    uploadRegex,
    uploadCover,
    sendSubmission,
    confirmWithdrawSubmission,
    submit,
  } = useDraftSubmissionActions({
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
    setCoverNonce,
    setHistoryNonce,
    setSubmittedVersionId,
    setConfirm,
    pendingWithdraw,
    setPendingWithdraw,
    onRefresh,
    onNotice,
    onError,
  });

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

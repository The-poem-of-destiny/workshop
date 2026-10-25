import { useEffect, useMemo, useRef, useState } from "react";
import { type AuthorProject, type AuthorSubmission, api } from "../../api";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import "../../styles/workspaces.css";
import { AssetPicker } from "./authoring/AssetPicker";
import { CheckPanel } from "./authoring/CheckPanel";
import { runLocalCheck } from "./authoring/checker";
import { ImagePicker } from "./authoring/ImagePicker";
import {
  fileKey,
  loadRegexAsset,
  loadWorldbookAsset,
  mergedRegexUpload,
  type RegexAsset,
  type WorldbookAsset,
} from "./authoring/preview";
import { SubmissionHistory } from "./authoring/SubmissionHistory";
import { TagPicker } from "./authoring/TagPicker";
import { usePendingImage } from "./authoring/usePendingImage";
import { EXTENSION_TYPES, metadataPayload, PROJECT_TYPES, type ProjectForm, projectForm } from "./projectMetadata";

type TextField = Exclude<keyof ProjectForm, "tags">;

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
  const [worldbook, setWorldbook] = useState<WorldbookAsset | null>(null);
  const [regexAssets, setRegexAssets] = useState<RegexAsset[]>([]);
  const [worldbookError, setWorldbookError] = useState<string | null>(null);
  const [regexError, setRegexError] = useState<string | null>(null);
  const [worldbookUploaded, setWorldbookUploaded] = useState(false);
  const [regexUploaded, setRegexUploaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverNonce, setCoverNonce] = useState(0);
  const [submissions, setSubmissions] = useState<AuthorSubmission[]>([]);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [historyNonce, setHistoryNonce] = useState(0);
  const [confirm, setConfirm] = useState<null | { kind: "warn" | "missing" }>(null);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const assetGeneration = useRef(0);
  const selectionVersion = useRef(0);
  const regexAssetsRef = useRef<RegexAsset[]>([]);
  const regexParseChain = useRef<Promise<void>>(Promise.resolve());
  const worldbookPick = useRef(0);
  const cover = usePendingImage();
  const workingRevisionFrozen = Boolean(
    entry.latestSubmission && entry.latestSubmission.revisionId === workingRevisionId,
  );
  const check = useMemo(() => runLocalCheck(worldbook, regexAssets), [worldbook, regexAssets]);

  useEffect(() => {
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
  }, [entry.project.id, entry.workingRevisionId]);

  useEffect(
    () => () => {
      assetGeneration.current += 1;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    if (!workingRevisionId) {
      setCoverUrl(null);
      return;
    }
    api
      .authorCover(entry.project.id, workingRevisionId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setCoverUrl(objectUrl);
      })
      .catch(() => {
        if (active) setCoverUrl(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry.project.id, workingRevisionId, coverNonce]);

  useEffect(() => {
    let active = true;
    api
      .authorSubmissions(entry.project.id)
      .then((response) => {
        if (!active) return;
        setSubmissions(response.items);
        setSubmissionError(null);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setSubmissions([]);
        setSubmissionError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [entry.project.id, historyNonce]);

  function update(key: TextField, value: string): void {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function save(): Promise<void> {
    if (busy || workingRevisionFrozen) return;
    setBusy(true);
    try {
      const result = await api.patchProject(entry.project.id, entry.rowVersion, metadataPayload(form));
      onNotice(`已保存（版本 ${result.rowVersion}）。`);
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

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

  function pickWorldbook(files: FileList): void {
    const file = files[0];
    if (!file || workingRevisionFrozen) return;
    const generation = assetGeneration.current;
    const pick = worldbookPick.current + 1;
    worldbookPick.current = pick;
    setWorldbookError(null);
    setSubmitNotice(null);
    void loadWorldbookAsset(file).then((result) => {
      if (generation !== assetGeneration.current || pick !== worldbookPick.current) return;
      if (!result.ok) {
        setWorldbookError(result.error);
        return;
      }
      setWorldbook(result.value);
      setWorldbookUploaded(false);
      selectionVersion.current += 1;
    });
  }

  function pickRegex(files: FileList): void {
    const incoming = Array.from(files);
    if (incoming.length === 0 || workingRevisionFrozen) return;
    const generation = assetGeneration.current;
    setRegexError(null);
    setSubmitNotice(null);
    regexParseChain.current = regexParseChain.current
      .then(async () => {
        const results = await Promise.all(incoming.map((file) => loadRegexAsset(file)));
        if (generation !== assetGeneration.current) return;
        const errors = results.flatMap((result) => (result.ok ? [] : [result.error]));
        const loaded = results.flatMap((result) => (result.ok ? [result.value] : []));
        if (errors.length > 0) setRegexError(errors.join(" "));
        if (loaded.length === 0) return;
        const keys = new Set(regexAssetsRef.current.map((asset) => fileKey(asset.file)));
        const additions: RegexAsset[] = [];
        let duplicates = 0;
        for (const asset of loaded) {
          const key = fileKey(asset.file);
          if (keys.has(key)) {
            duplicates += 1;
            continue;
          }
          keys.add(key);
          additions.push(asset);
        }
        if (duplicates > 0) onNotice(`${duplicates} 个文件与已选文件重复，已忽略。`);
        if (additions.length > 0) {
          const next = [...regexAssetsRef.current, ...additions];
          regexAssetsRef.current = next;
          setRegexAssets(next);
          setRegexUploaded(false);
          selectionVersion.current += 1;
        }
      })
      .catch(() => undefined);
  }

  function removeWorldbook(): void {
    setWorldbook(null);
    setWorldbookError(null);
    setWorldbookUploaded(false);
    setSubmitNotice(null);
    selectionVersion.current += 1;
  }

  function removeRegex(index: number): void {
    const next = regexAssetsRef.current.filter((_, position) => position !== index);
    regexAssetsRef.current = next;
    setRegexAssets(next);
    setRegexUploaded(false);
    setSubmitNotice(null);
    selectionVersion.current += 1;
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

  async function remove(): Promise<void> {
    if (!window.confirm(`确定删除「${entry.project.title}」？此操作不可撤销。`)) return;
    setBusy(true);
    try {
      await api.deleteProject(entry.project.id, entry.rowVersion);
      onNotice("项目已删除。");
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  let metadataWarnings: { field?: unknown; message?: unknown }[] = [];
  if (entry.metadataFindings) {
    try {
      const parsed: unknown = JSON.parse(entry.metadataFindings);
      if (Array.isArray(parsed)) metadataWarnings = parsed.filter((item) => item && typeof item === "object");
    } catch {
      metadataWarnings = [];
    }
  }

  const input = (key: TextField, label: string, multiline = false) =>
    multiline ? (
      <label htmlFor={`${key}-field`}>
        {label}
        <Textarea
          id={`${key}-field`}
          disabled={busy || workingRevisionFrozen}
          value={form[key]}
          onChange={(event) => update(key, event.target.value)}
        />
      </label>
    ) : (
      <label htmlFor={`${key}-field`}>
        {label}
        <Input
          id={`${key}-field`}
          disabled={busy || workingRevisionFrozen}
          value={form[key]}
          onChange={(event) => update(key, event.target.value)}
        />
      </label>
    );

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

      <section className="workspace-section authoring-section">
        <h3>基本资料</h3>
        {input("title", "标题")}
        {input("description", "简介", true)}
        {input("authorNote", "作者说明", true)}
        {input("precautions", "注意事项", true)}
        <div className="form-grid">
          <label htmlFor="schemaVersion-field">
            适配 schema
            <Input
              id="schemaVersion-field"
              disabled={busy || workingRevisionFrozen}
              value={form.schemaVersion}
              onChange={(event) => update("schemaVersion", event.target.value)}
            />
            <small className="field-hint">填写世界书适配的 schema 版本，例如角色卡 v2；不确定可以留空。</small>
          </label>
          {input("discordThreadUrl", "Discord 讨论链接")}
        </div>
        <div className="form-grid">
          {input("versionLabel", "版本号")}
          <label htmlFor="projectType-field">
            项目类型
            <select
              id="projectType-field"
              disabled={busy || workingRevisionFrozen}
              value={form.projectType}
              onChange={(event) => update("projectType", event.target.value)}
            >
              <option value="">请选择</option>
              {PROJECT_TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label htmlFor="extensionType-field">
            扩展类型
            <select
              id="extensionType-field"
              disabled={busy || workingRevisionFrozen}
              value={form.extensionType}
              onChange={(event) => update("extensionType", event.target.value)}
            >
              <option value="">不适用</option>
              {EXTENSION_TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="workspace-section authoring-section">
        <h3>分类与标签</h3>
        <p className="field-hint">角色项目可以从官方标签组中挑选，也可以输入自定义关键词。</p>
        <TagPicker
          idPrefix="project"
          value={form.tags}
          projectType={form.projectType}
          disabled={busy || workingRevisionFrozen}
          onChange={(tags) => setForm((previous) => ({ ...previous, tags }))}
        />
      </section>

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

      {metadataWarnings.length > 0 ? (
        <div className="findings">
          <strong>元数据提示</strong>
          <ul>
            {metadataWarnings.map((item, index) => (
              <li key={index}>
                {typeof item.field === "string" ? `${item.field}：` : ""}
                {typeof item.message === "string" ? item.message : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="submit-box">
        <strong>提交审核</strong>
        {check ? (
          <span className="status">
            客户端自检（仅覆盖本次选择的文件）：
            {check.gate === "pass"
              ? "通过"
              : check.gate === "warn"
                ? `有 ${check.warnings.length} 条提示，提交前需确认`
                : `${check.counts.high} 个阻断问题，需修复后才能提交`}
          </span>
        ) : (
          <span className="status">本次未在本地检查，提交后将进入人工审核；重新选择文件可先检查。</span>
        )}
        <button
          type="button"
          className="primary"
          onClick={submit}
          disabled={busy || !workingRevisionId || workingRevisionFrozen}
        >
          提交当前版本
        </button>
        {submitNotice ? (
          <p className="asset-error" role="alert">
            {submitNotice}
          </p>
        ) : null}
      </div>

      <SubmissionHistory items={submissions} error={submissionError} />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "warn" ? "提交前确认提示" : "本次未在本地检查"}
        description={
          confirm?.kind === "warn"
            ? "以下提示不会阻止提交，但请确认已经了解这些风险。"
            : "本次未在本地检查，提交后将进入人工审核；重新选择文件可先检查。"
        }
        confirmLabel={confirm?.kind === "warn" ? "确认并提交" : "仍然提交"}
        busy={busy}
        onConfirm={() => void sendSubmission(true)}
        onCancel={() => setConfirm(null)}
      >
        {confirm?.kind === "warn" && check ? (
          check.warnings.length > 0 ? (
            <ul className="confirm-list">
              {check.warnings.map((finding, index) => (
                <li key={`${finding.ruleId}-${index}`}>
                  <strong>
                    [{finding.ruleId}] {finding.title}
                  </strong>
                  {finding.entry ? <span> · {finding.entry}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>本次检查没有列出具体提示条目，但检查结果仍需要你确认。</p>
          )
        ) : null}
      </ConfirmDialog>
    </section>
  );
}

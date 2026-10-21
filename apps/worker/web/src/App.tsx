import { analyzeLocalProjectCode, type CheckerReport } from "@workshop/content";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { AdminTools } from "./AdminTools";
import {
  type AdminSubmissionDetail,
  type AdminSubmissionListItem,
  type AdminSubmissionListResponse,
  type AuthorProject,
  api,
  type HomeResponse,
  type MeResponse,
  type ProjectDetail,
  type ProjectSummary,
  type SubmissionDiff,
  setSessionToken,
} from "./api";

const SORTS = [
  ["updated", "最近更新"],
  ["published", "发布时间"],
  ["downloads", "下载"],
  ["likes", "点赞"],
] as const;
const PROJECT_TYPES = ["事件", "系统核心", "角色", "扩展"] as const;
const DOWNLOAD_LEDGER_KEY = "cw_download_ledger";

function readDownloadLedger(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DOWNLOAD_LEDGER_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}
const EXTENSION_TYPES = ["规则", "内容"] as const;

function clientGate(report: CheckerReport): "pass" | "warn" | "block" {
  if (report.gate === "reject") return "block";
  if (report.certification === "fail" || report.certification === "review" || report.audit === "yellow") return "warn";
  return "pass";
}
type InstallState = "notInstalled" | "upToDate" | "updateAvailable" | "localChanged" | "scanIncomplete";
interface HostContext {
  connected: boolean;
  characterName: string | null;
  worldbooks: { primary: string | null; additional: string[]; available: string[] };
  registry: Record<string, { version: string; worldbookName: string; entryCount?: number }>;
  installStates?: Record<string, "clean" | "localChanged" | "scanIncomplete">;
  clientVersion: string;
  error?: string;
}
interface ProjectForm {
  title: string;
  description: string;
  authorNote: string;
  precautions: string;
  versionLabel: string;
  projectType: string;
  extensionType: string;
  tags: string;
}

function ProjectCard({ project, onOpen }: { project: ProjectSummary; onOpen: (p: ProjectSummary) => void }) {
  const open = (): void => onOpen(project);
  return (
    <article className="card">
      <button className="card-cover-button" type="button" onClick={open} aria-label={`查看 ${project.title}`}>
        <span className="cover">
          {project.coverUrl ? (
            <img
              src={project.coverUrl}
              alt=""
              loading="lazy"
              style={{
                objectPosition: `${project.coverPositionX}% ${project.coverPositionY}%`,
                transform: `scale(${project.coverZoom})`,
              }}
            />
          ) : (
            <span>无封面</span>
          )}
        </span>
      </button>
      <div className="card-body">
        <div className="card-title-row">
          <h3>
            <button className="card-title" type="button" onClick={open}>
              {project.title}
            </button>
          </h3>
          {project.versionLabel ? <span className="version">{project.versionLabel}</span> : null}
        </div>
        <p className="byline">
          {project.author.avatarUrl ? (
            <img src={project.author.avatarUrl} alt="" loading="lazy" />
          ) : (
            <span className="avatar-fallback">{project.author.name.slice(0, 1)}</span>
          )}
          <span>{project.author.name}</span>
        </p>
        <p className="meta">
          世界书 {project.entries.worldbook} 条 | 正则 {project.entries.regex} 条
          {project.schemaVersion ? ` | 适配 ${project.schemaVersion}` : ""}
        </p>
        {project.authorNote ? <p className="note">{project.authorNote.slice(0, 80)}</p> : null}
        <div className="card-footer">
          <p className="meta">
            更新 {project.updatedAt.slice(0, 10)}
            {project.publishedAt ? ` · 发布 ${project.publishedAt.slice(0, 10)}` : ""}
          </p>
          {project.discordThreadUrl ? (
            <a className="discord-link" href={project.discordThreadUrl} target="_blank" rel="noreferrer">
              Discord
            </a>
          ) : null}
        </div>
        <div className="tags">
          {project.projectType ? <span>{project.projectType}</span> : null}
          {project.tags.slice(0, 2).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>
    </article>
  );
}

function Detail({
  project,
  onClose,
  onInstall,
  onUninstall,
  onDownload,
  onAuthor,
  onError,
  downloadedRevision,
  installState,
  loggedIn,
  installing,
  embedded,
}: {
  project: ProjectSummary;
  onClose: () => void;
  onInstall: (p: ProjectSummary) => void;
  onUninstall: (p: ProjectSummary) => void;
  onDownload: (p: ProjectSummary) => void;
  onAuthor: (author: { id: string; name: string }) => void;
  onError: (message: string) => void;
  downloadedRevision: string | null;
  installState: InstallState;
  loggedIn: boolean;
  installing: boolean;
  embedded: boolean;
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [interaction, setInteraction] = useState<{ liked: boolean; subscribed: boolean } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    let active = true;
    api
      .project(project.id)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [project.id]);
  useEffect(() => {
    if (!loggedIn) {
      setInteraction(null);
      return;
    }
    let active = true;
    api
      .meState([project.id])
      .then((result) => {
        if (!active) return;
        const item = result.items.find((value) => value.projectId === project.id);
        setInteraction(item ? { liked: item.liked, subscribed: item.subscribed } : null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loggedIn, project.id]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [
        ...panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = originalOverflow;
      previous?.focus();
    };
  }, [project.id]);
  return (
    <>
      <div className="detail-backdrop" aria-hidden="true" onClick={onClose} />
      <aside className="detail" role="dialog" aria-modal="true" aria-labelledby="detail-title" ref={panelRef}>
        <button className="close" type="button" onClick={onClose} ref={closeRef} aria-label="关闭详情">
          关闭
        </button>
        <h2 id="detail-title">{project.title}</h2>
        <button className="author link" type="button" onClick={() => onAuthor(project.author)}>
          {project.author.avatarUrl ? (
            <img src={project.author.avatarUrl} alt="" />
          ) : (
            <span className="avatar-fallback">{project.author.name.slice(0, 1)}</span>
          )}
          {project.author.name}
        </button>
        <p>{project.description}</p>
        {detail?.authorNote ? (
          <section className="detail-section">
            <h3>作者说明</h3>
            <p>{detail.authorNote}</p>
          </section>
        ) : null}
        {detail?.precautions ? (
          <section className="detail-section detail-warning">
            <h3>注意事项</h3>
            <p>{detail.precautions}</p>
          </section>
        ) : null}
        <section className="detail-section">
          <h3>版本信息</h3>
          <p className="meta">
            更新 {project.updatedAt.slice(0, 10)}
            {project.publishedAt ? ` · 发布 ${project.publishedAt.slice(0, 10)}` : ""}
            {project.schemaVersion ? ` · 适配 ${project.schemaVersion}` : ""}
          </p>
        </section>
        <dl>
          <div>
            <dt>世界书</dt>
            <dd>{project.entries.worldbook} 条</dd>
          </div>
          <div>
            <dt>正则</dt>
            <dd>{project.entries.regex} 条</dd>
          </div>
          <div>
            <dt>下载</dt>
            <dd>{project.counts.downloads}</dd>
          </div>
          <div>
            <dt>点赞</dt>
            <dd>{project.counts.likes}</dd>
          </div>
        </dl>
        {downloadedRevision ? (
          <p className="installed">
            {project.publishedRevisionId && downloadedRevision === project.publishedRevisionId
              ? "本地已下载当前发布版本。"
              : "本地下载记录与当前发布版本不同。"}
          </p>
        ) : null}
        {installState === "upToDate" ? (
          <p className="installed">已安装，且与当前发布版本一致。</p>
        ) : installState === "updateAvailable" ? (
          <p className="installed">已安装；当前发布版本可更新。</p>
        ) : installState === "localChanged" ? (
          <p className="installed">已安装；检测到本地修改，更新会保留这些修改。</p>
        ) : installState === "scanIncomplete" ? (
          <p className="installed">已安装；本地扫描不完整，无法确认是否有修改。</p>
        ) : null}
        {detail?.discordThreadUrl ? (
          <div className="actions">
            <a className="secondary-link" href={detail.discordThreadUrl} target="_blank" rel="noreferrer">
              Discord 讨论
            </a>
          </div>
        ) : null}
        {loggedIn ? (
          <div className="actions">
            <button type="button" disabled={installing} onClick={() => onDownload(project)}>
              下载文件
            </button>
            <button
              type="button"
              aria-pressed={Boolean(interaction?.liked)}
              onClick={() => {
                const next = !interaction?.liked;
                void api
                  .setLike(project.id, next)
                  .then(() =>
                    setInteraction((value) => ({
                      liked: next,
                      subscribed: value?.subscribed ?? false,
                    })),
                  )
                  .catch((reason) => onError(String(reason)));
              }}
            >
              {interaction?.liked ? "已点赞" : "点赞"}
            </button>
            <button
              type="button"
              aria-pressed={Boolean(interaction?.subscribed)}
              onClick={() => {
                const next = !interaction?.subscribed;
                void api
                  .setSubscription(project.id, next)
                  .then(() =>
                    setInteraction((value) => ({
                      liked: value?.liked ?? false,
                      subscribed: next,
                    })),
                  )
                  .catch((reason) => onError(String(reason)));
              }}
            >
              {interaction?.subscribed ? "已订阅" : "订阅"}
            </button>
          </div>
        ) : null}
        {!embedded ? (
          <p className="hint">安装请从 SillyTavern 内的「命定创意工坊」按钮打开。</p>
        ) : !loggedIn ? (
          <p className="hint">请先使用 Discord 登录，再安装到当前角色。</p>
        ) : (
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={installing || installState === "upToDate"}
              onClick={() => onInstall(project)}
            >
              {installing
                ? "安装中…"
                : installState === "upToDate"
                  ? "已是最新"
                  : installState === "localChanged"
                    ? "更新（保留修改）"
                    : installState === "notInstalled"
                      ? "安装"
                      : "更新"}
            </button>
            {installState !== "notInstalled" ? (
              <button type="button" disabled={installing} onClick={() => onUninstall(project)}>
                卸载
              </button>
            ) : null}
          </div>
        )}
      </aside>
    </>
  );
}

function projectForm(project: ProjectSummary, entry?: AuthorProject): ProjectForm {
  return {
    title: project.title,
    description: project.description ?? "",
    authorNote: entry?.authorNote ?? "",
    precautions: entry?.precautions ?? "",
    versionLabel: project.versionLabel ?? "",
    projectType: project.projectType ?? "",
    extensionType: project.extensionType ?? "",
    tags: project.tags.join(", "),
  };
}

function ProjectEditor({
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
  const [localFiles, setLocalFiles] = useState<{ worldbook?: File; regex?: File }>({});
  const [preflight, setPreflight] = useState<{
    status: "empty" | "checking" | "pass" | "warn" | "block";
    warnings: number;
  }>({ status: "empty", warnings: 0 });
  const [busy, setBusy] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverNonce, setCoverNonce] = useState(0);
  useEffect(() => setForm(projectForm(entry.project, entry)), [entry.project.id, entry.workingRevisionId]);
  useEffect(() => setWorkingRevisionId(entry.workingRevisionId), [entry.project.id, entry.workingRevisionId]);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    if (!workingRevisionId) {
      setCoverPreview(null);
      return;
    }
    api
      .authorCover(entry.project.id, workingRevisionId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setCoverPreview(objectUrl);
      })
      .catch(() => {
        if (active) setCoverPreview(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry.project.id, workingRevisionId, coverNonce]);
  useEffect(() => {
    if (!localFiles.worldbook && !localFiles.regex) {
      setPreflight({ status: "empty", warnings: 0 });
      return;
    }
    let active = true;
    setPreflight({ status: "checking", warnings: 0 });
    void (async () => {
      const files = [];
      if (localFiles.worldbook)
        files.push({ fileName: "worldbook.json", type: "worldbook" as const, text: await localFiles.worldbook.text() });
      if (localFiles.regex)
        files.push({ fileName: "regex.json", type: "regex" as const, text: await localFiles.regex.text() });
      if (!active) return;
      const report = analyzeLocalProjectCode(files);
      setPreflight({
        status: clientGate(report),
        warnings: report.findings.filter((finding) => finding.severity !== "info").length,
      });
    })().catch(() => {
      if (active) setPreflight({ status: "empty", warnings: 0 });
    });
    return () => {
      active = false;
    };
  }, [localFiles]);
  const update = (key: keyof ProjectForm, value: string): void =>
    setForm((previous) => ({ ...previous, [key]: value }));
  async function save(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.patchProject(entry.project.id, entry.rowVersion, {
        title: form.title,
        description: form.description || null,
        authorNote: form.authorNote || null,
        precautions: form.precautions || null,
        versionLabel: form.versionLabel || null,
        projectType: form.projectType || null,
        extensionType: form.extensionType || null,
        tags: form.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      onNotice(`已保存（版本 ${result.rowVersion}）。`);
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function newRevision(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.createRevision(entry.project.id, entry.rowVersion, {
        title: form.title,
        description: form.description || null,
        authorNote: form.authorNote || null,
        precautions: form.precautions || null,
        versionLabel: form.versionLabel || null,
        projectType: form.projectType || null,
        extensionType: form.extensionType || null,
        tags: form.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setWorkingRevisionId(result.revisionId);
      setLocalFiles({});
      await onRefresh();
      onNotice(`已创建新版本（版本 ${result.rowVersion}），现在可以上传修改后的文件。`);
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function upload(kind: "worldbook" | "regex" | "cover", file: File | undefined): Promise<void> {
    if (!file || !workingRevisionId) return;
    if (kind !== "cover") setLocalFiles((previous) => ({ ...previous, [kind]: file }));
    setBusy(true);
    try {
      await api.uploadFile(entry.project.id, workingRevisionId, kind, file);
      if (kind === "cover") setCoverNonce((value) => value + 1);
      onNotice(`${kind === "cover" ? "封面" : kind === "worldbook" ? "世界书" : "正则"}已上传。`);
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function submit(): Promise<void> {
    if (!workingRevisionId) return;
    setBusy(true);
    try {
      const files = [];
      if (localFiles.worldbook)
        files.push({ fileName: "worldbook.json", type: "worldbook" as const, text: await localFiles.worldbook.text() });
      if (localFiles.regex)
        files.push({ fileName: "regex.json", type: "regex" as const, text: await localFiles.regex.text() });
      let gate: "pass" | "warn" | "block" | "missing" = "missing";
      let warningCount = 0;
      let checkerRevision: string | undefined;
      if (files.length > 0) {
        const report = analyzeLocalProjectCode(files);
        gate = clientGate(report);
        warningCount = report.findings.filter((finding) => finding.severity !== "info").length;
        checkerRevision = `${report.engine}/${report.policyVersion}`;
      }
      if (gate === "block") {
        onError("客户端检查未通过，请先修复高风险问题后再提交。");
        return;
      }
      if (gate === "warn" && !window.confirm(`客户端检查有 ${warningCount} 条提示，仍要提交吗？`)) return;
      if (gate === "missing" && !window.confirm("没有可检查的本地文件，提交会转入人工审核，确定继续吗？")) return;
      await api.submitProject(entry.project.id, workingRevisionId, {
        gate,
        checkerRevision,
        warningCount,
        acknowledged: true,
      });
      onNotice(
        gate === "missing"
          ? "已提交审核；缺少客户端 checker 的版本会进入人工审核。"
          : `已提交审核（客户端检查 ${gate}）。`,
      );
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
  const input = (key: keyof ProjectForm, label: string, multiline = false) =>
    multiline ? (
      <label>
        {label}
        <textarea value={form[key]} onChange={(event) => update(key, event.target.value)} />
      </label>
    ) : (
      <label>
        {label}
        <input value={form[key]} onChange={(event) => update(key, event.target.value)} />
      </label>
    );
  return (
    <section className="panel editor">
      <div className="panel-heading">
        <div>
          <h2>编辑项目</h2>
          <p className="hint">
            {entry.project.visibility === "public" ? "公开" : "私有"} · rowVersion {entry.rowVersion}
          </p>
        </div>
        <button type="button" onClick={remove} disabled={busy}>
          删除项目
        </button>
      </div>
      {coverPreview ? (
        <img className="cover-preview" src={coverPreview} alt="当前封面" />
      ) : (
        <p className="hint">当前版本还没有封面。</p>
      )}
      {input("title", "标题")}
      {input("description", "简介", true)}
      {input("authorNote", "作者说明", true)}
      {input("precautions", "注意事项", true)}
      <div className="form-grid">
        {input("versionLabel", "版本号")}
        <label>
          项目类型
          <select value={form.projectType} onChange={(event) => update("projectType", event.target.value)}>
            <option value="">请选择</option>
            {PROJECT_TYPES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          扩展类型
          <select value={form.extensionType} onChange={(event) => update("extensionType", event.target.value)}>
            <option value="">不适用</option>
            {EXTENSION_TYPES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        {input("tags", "标签（逗号分隔）")}
      </div>
      <p className={`preflight ${preflight.status}`} role="status">
        客户端自检：
        {preflight.status === "empty"
          ? "未选择本地文件，提交后进入人工审核。"
          : preflight.status === "checking"
            ? "检查中…"
            : preflight.status === "pass"
              ? "通过。"
              : preflight.status === "warn"
                ? `有 ${preflight.warnings} 条提示，提交前需确认。`
                : "存在高风险问题，需修复后才能提交。"}
      </p>
      <div className="actions">
        <button type="button" className="primary" onClick={() => void save()} disabled={busy}>
          保存元数据
        </button>
        <button type="button" onClick={() => void newRevision()} disabled={busy}>
          新建版本
        </button>
        <label className="file-button">
          上传世界书 JSON
          <input
            type="file"
            accept=".json,application/json,text/plain"
            onChange={(event) => void upload("worldbook", event.target.files?.[0])}
          />
        </label>
        <label className="file-button">
          上传正则 JSON
          <input
            type="file"
            accept=".json,application/json,text/plain"
            onChange={(event) => void upload("regex", event.target.files?.[0])}
          />
        </label>
        <label className="file-button">
          上传封面
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => void upload("cover", event.target.files?.[0])}
          />
        </label>
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
        <p className="hint">当前提交按“无客户端 checker”处理，会明确进入人工审核；请确认文件和元数据已经完整。</p>
        <button type="button" className="primary" onClick={() => void submit()} disabled={busy || !workingRevisionId}>
          提交当前版本
        </button>
        {entry.latestSubmission ? (
          <span className="status">
            最近提交：{entry.latestSubmission.status} / {entry.latestSubmission.checkStatus}
            {entry.latestSubmission.reason ? ` · ${entry.latestSubmission.reason}` : ""}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function Discovery({ onOpen }: { onOpen: (project: ProjectSummary) => void }) {
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let active = true;
    api
      .discovery()
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, []);
  const discovered = useMemo(() => {
    const next = [...items];
    for (let index = next.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [next[index], next[swap]] = [next[swap]!, next[index]!];
    }
    return next.slice(0, 4);
  }, [items]);

  if (state === "loading") {
    return (
      <section className="discovery" aria-busy="true">
        <h2>发现</h2>
        <p className="hint">正在整理今日发现…</p>
      </section>
    );
  }
  if (state === "error") {
    return (
      <section className="discovery">
        <h2>发现</h2>
        <p className="hint">暂时无法加载发现内容，主列表不受影响。</p>
      </section>
    );
  }
  if (discovered.length === 0) return null;
  return (
    <section className="discovery">
      <h2>发现</h2>
      <div className="grid discovery-grid">
        {discovered.map((project) => (
          <ProjectCard key={project.id} project={project} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function Subscriptions({
  onOpen,
  onError,
}: {
  onOpen: (project: ProjectSummary) => void;
  onError: (message: string) => void;
}) {
  const [items, setItems] = useState<ProjectSummary[]>([]);
  useEffect(() => {
    api
      .subscriptions()
      .then((result) => setItems(result.items))
      .catch((reason) => onError(String(reason)));
  }, []);
  return (
    <section className="workspace">
      <div className="panel-heading">
        <h2>我的订阅</h2>
      </div>
      {items.length === 0 ? (
        <p className="hint">还没有订阅项目。</p>
      ) : (
        <main className="grid">
          {items.map((project) => (
            <ProjectCard key={project.id} project={project} onOpen={onOpen} />
          ))}
        </main>
      )}
    </section>
  );
}

function MyProjects({
  onError,
  onNotice,
}: {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [items, setItems] = useState<AuthorProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    description: "",
    versionLabel: "",
    projectType: "事件",
    extensionType: "",
    tags: "",
  });
  async function refresh(): Promise<void> {
    try {
      const result = await api.myProjects();
      setItems(result.items);
      if (selectedId && !result.items.some((item) => item.project.id === selectedId)) setSelectedId(null);
    } catch (reason) {
      onError(String(reason));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function create(): Promise<void> {
    if (!createForm.title.trim()) return;
    setCreating(true);
    try {
      const result = await api.createProject({
        title: createForm.title.trim(),
        description: createForm.description || null,
        versionLabel: createForm.versionLabel || null,
        projectType: createForm.projectType || null,
        extensionType: createForm.extensionType || null,
        tags: createForm.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setCreateForm({ title: "", description: "", versionLabel: "", projectType: "事件", extensionType: "", tags: "" });
      setSelectedId(result.project.id);
      onNotice("项目已创建。");
      await refresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setCreating(false);
    }
  }
  const selected = items.find((item) => item.project.id === selectedId) ?? null;
  return (
    <div className="workspace">
      <section className="panel">
        <div className="panel-heading">
          <h2>我的项目</h2>
          <button type="button" onClick={() => void refresh()}>
            刷新
          </button>
        </div>
        {items.length === 0 ? (
          <p className="hint">还没有项目，先创建一个草稿吧。</p>
        ) : (
          <div className="project-list">
            {items.map((item) => (
              <button
                key={item.project.id}
                type="button"
                className={`project-row${item.project.id === selectedId ? " selected" : ""}`}
                onClick={() => setSelectedId(item.project.id)}
              >
                <span>
                  <strong>{item.project.title}</strong>
                  <small>
                    {item.project.visibility === "public" ? "公开" : "私有"} · {item.project.projectType ?? "未分类"} ·
                    v{item.project.versionLabel ?? "未标注"}
                  </small>
                </span>
                <span className="status">
                  {item.latestSubmission
                    ? `${item.latestSubmission.checkStatus} / ${item.latestSubmission.decision ?? item.latestSubmission.status}`
                    : "未提交"}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="panel create-panel">
        <h2>创建项目</h2>
        <div className="form-grid">
          <label>
            标题
            <input
              value={createForm.title}
              onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })}
            />
          </label>
          <label>
            版本号
            <input
              value={createForm.versionLabel}
              onChange={(event) => setCreateForm({ ...createForm, versionLabel: event.target.value })}
            />
          </label>
          <label>
            项目类型
            <select
              value={createForm.projectType}
              onChange={(event) => setCreateForm({ ...createForm, projectType: event.target.value })}
            >
              {PROJECT_TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            扩展类型
            <select
              value={createForm.extensionType}
              onChange={(event) => setCreateForm({ ...createForm, extensionType: event.target.value })}
            >
              <option value="">不适用</option>
              {EXTENSION_TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            标签（逗号分隔）
            <input
              value={createForm.tags}
              onChange={(event) => setCreateForm({ ...createForm, tags: event.target.value })}
            />
          </label>
        </div>
        <label>
          简介
          <textarea
            value={createForm.description}
            onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })}
          />
        </label>
        <button
          type="button"
          className="primary"
          onClick={() => void create()}
          disabled={creating || !createForm.title.trim()}
        >
          创建草稿
        </button>
      </section>
      {selected ? <ProjectEditor entry={selected} onRefresh={refresh} onError={onError} onNotice={onNotice} /> : null}
    </div>
  );
}

function AdminPanel({
  onError,
  onNotice,
}: {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [items, setItems] = useState<AdminSubmissionListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminSubmissionDetail | null>(null);
  const [diff, setDiff] = useState<SubmissionDiff | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<AdminSubmissionListResponse["counts"] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const selectedRef = useRef<string | null>(null);
  const cache = useRef(new Map<string, { detail: AdminSubmissionDetail; diff: SubmissionDiff }>());
  const inflight = useRef(new Map<string, Promise<{ detail: AdminSubmissionDetail; diff: SubmissionDiff }>>());

  async function loadDetail(id: string): Promise<{ detail: AdminSubmissionDetail; diff: SubmissionDiff }> {
    const cached = cache.current.get(id);
    if (cached) return cached;
    const pending = inflight.current.get(id);
    if (pending) return pending;
    const request = Promise.all([api.adminSubmission(id), api.adminDiff(id)])
      .then(([nextDetail, nextDiff]) => {
        const value = { detail: nextDetail, diff: nextDiff };
        cache.current.set(id, value);
        return value;
      })
      .finally(() => inflight.current.delete(id));
    inflight.current.set(id, request);
    return request;
  }

  function nextId(id: string): string | null {
    const index = items.findIndex((item) => item.id === id);
    return index >= 0 ? (items[index + 1]?.id ?? null) : null;
  }

  function prefetch(id: string | null): void {
    if (!id || cache.current.has(id) || inflight.current.has(id)) return;
    void loadDetail(id).catch(() => undefined);
  }

  function clearSelection(): void {
    selectedRef.current = null;
    setSelectedId(null);
    setDetail(null);
    setDiff(null);
  }

  async function refresh(): Promise<void> {
    try {
      const result = await api.adminSubmissions("pending");
      setItems(result.items);
      setCounts(result.counts);
      setNextCursor(result.nextCursor);
      if (selectedId && !result.items.some((item) => item.id === selectedId)) clearSelection();
    } catch (value) {
      onError(String(value));
    }
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api.adminSubmissions("pending", nextCursor);
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...result.items.filter((item) => !seen.has(item.id))];
      });
      setCounts(result.counts);
      setNextCursor(result.nextCursor);
    } catch (value) {
      onError(String(value));
    } finally {
      setLoadingMore(false);
    }
  }

  function advance(currentId: string): void {
    const index = items.findIndex((item) => item.id === currentId);
    const remaining = items.filter((item) => item.id !== currentId);
    const next = remaining.length > 0 ? remaining[Math.min(Math.max(index, 0), remaining.length - 1)] : null;
    setItems(remaining);
    if (next) void select(next.id);
    else clearSelection();
    if (remaining.length < 5 && nextCursor) void loadMore();
  }

  async function select(id: string): Promise<void> {
    selectedRef.current = id;
    setSelectedId(id);
    const cached = cache.current.get(id);
    if (cached) {
      setDetail(cached.detail);
      setDiff(cached.diff);
      prefetch(nextId(id));
      return;
    }
    setDetail(null);
    setDiff(null);
    try {
      const value = await loadDetail(id);
      if (selectedRef.current !== id) return;
      setDetail(value.detail);
      setDiff(value.diff);
      prefetch(nextId(id));
    } catch (value) {
      onError(String(value));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);
  async function review(decision: "approve" | "reject"): Promise<void> {
    if (decision === "reject" && !reason.trim()) {
      onError("拒绝审核必须填写理由。");
      return;
    }
    if (
      (detail?.submission.gate === "block" ||
        detail?.submission.clientGate === "block" ||
        detail?.submission.clientGate === "missing" ||
        detail?.checkRuns[0]?.routeGate === "block") &&
      !reason.trim()
    ) {
      onError("阻断或缺少 checker 的提交必须填写审核说明。");
      return;
    }
    if (!selectedId) return;
    const currentId = selectedId;
    setBusy(true);
    try {
      await api.adminReview(currentId, decision, reason.trim() || undefined);
      setReason("");
      onNotice(decision === "approve" ? "已通过审核。" : "已拒绝审核。");
      cache.current.delete(currentId);
      inflight.current.delete(currentId);
      const nextStatus = decision === "approve" ? "approved" : "rejected";
      setCounts((previous) =>
        previous
          ? { ...previous, pending: Math.max(0, previous.pending - 1), [nextStatus]: previous[nextStatus] + 1 }
          : previous,
      );
      advance(currentId);
    } catch (value) {
      onError(String(value));
    } finally {
      setBusy(false);
    }
  }
  async function recheck(): Promise<void> {
    if (!selectedId) return;
    setBusy(true);
    try {
      await api.adminRecheck(selectedId);
      setCounts((previous) =>
        previous
          ? { ...previous, pending: Math.max(0, previous.pending - 1), checking: previous.checking + 1 }
          : previous,
      );
      cache.current.delete(selectedId);
      advance(selectedId);
      onNotice("已重新排队检查。");
    } catch (value) {
      onError(String(value));
    } finally {
      setBusy(false);
    }
  }
  async function download(kind: "worldbook" | "regex" | "cover"): Promise<void> {
    if (!selectedId) return;
    try {
      const blob = await api.adminFile(selectedId, kind);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selectedId}-${kind}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (value) {
      onError(String(value));
    }
  }
  return (
    <div className="admin-layout">
      <section className="panel">
        <div className="panel-heading">
          <h2>审核台</h2>
          <button type="button" onClick={() => void refresh()}>
            刷新
          </button>
        </div>
        {counts ? (
          <p className="hint">
            待审 {counts.pending} · 检查中 {counts.checking} · 已通过 {counts.approved} · 已拒绝 {counts.rejected}
          </p>
        ) : null}
        {items.length === 0 ? (
          <p className="hint">暂无待处理提交。</p>
        ) : (
          <div className="project-list">
            {items.map((item) => (
              <button
                className={`project-row${item.id === selectedId ? " selected" : ""}`}
                type="button"
                key={item.id}
                onClick={() => void select(item.id)}
                onMouseEnter={() => prefetch(item.id)}
                onFocus={() => prefetch(item.id)}
              >
                <span>
                  <strong>{item.projectTitle}</strong>
                  <small>
                    {item.author.name} · {item.status} · {item.checkStatus}
                  </small>
                </span>
                <span className="status">{item.gate ?? "missing"}</span>
              </button>
            ))}
          </div>
        )}
        {nextCursor ? (
          <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "加载中…" : "加载更多"}
          </button>
        ) : null}
      </section>
      {detail ? (
        <section className="panel review-detail">
          <h2>{detail.project.title}</h2>
          <p className="hint">
            作者：{detail.project.author.name} · revision #{detail.revision.revisionNo}
          </p>
          <dl>
            <div>
              <dt>客户端 gate</dt>
              <dd>{detail.submission.clientGate ?? "missing"}</dd>
            </div>
            <div>
              <dt>检查状态</dt>
              <dd>{detail.submission.checkStatus}</dd>
            </div>
            <div>
              <dt>检查报告 gate</dt>
              <dd>{detail.checkRuns[0]?.routeGate ?? "暂无"}</dd>
            </div>
            <div>
              <dt>提交时间</dt>
              <dd>{detail.submission.submittedAt}</dd>
            </div>
          </dl>
          <h3>检查报告</h3>
          <details className="report-fold">
            <summary>查看原始报告 JSON</summary>
            <pre className="report">{JSON.stringify(detail.submission.checkReport, null, 2) ?? "暂无报告"}</pre>
          </details>
          <h3>差异</h3>
          {diff ? (
            <>
              <p className="meta">
                检查结论：保留 {diff.findings.accepted.length} · 变更 {diff.findings.changed.length} · 新增{" "}
                {diff.findings.added.length} · 移除 {diff.findings.removed.length}
              </p>
              <div className="diff-grid">
                {(["worldbook", "regex"] as const).map((kind) => (
                  <div key={kind}>
                    <strong>{kind === "worldbook" ? "世界书" : "正则"}</strong>
                    <p>
                      新增 {diff[kind].added.length} · 修改 {diff[kind].modified.length} · 删除{" "}
                      {diff[kind].deleted.length}
                    </p>
                    <ul>
                      {[
                        ...diff[kind].added.map((item) => `+ ${item.name}`),
                        ...diff[kind].modified.map((item) => `~ ${item.name}`),
                        ...diff[kind].deleted.map((item) => `- ${item.name}`),
                      ]
                        .slice(0, 12)
                        .map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="hint">暂无差异。</p>
          )}
          <h3>文件</h3>
          <div className="actions">
            {(["worldbook", "regex", "cover"] as const).map((kind) => (
              <button type="button" key={kind} onClick={() => void download(kind)}>
                {kind} 下载
              </button>
            ))}
          </div>
          <label>
            审核说明
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="拒绝、阻断或人工放行时填写理由"
            />
          </label>
          <div className="actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void review("approve")}>
              通过
            </button>
            <button type="button" disabled={busy} onClick={() => void review("reject")}>
              拒绝
            </button>
            <button type="button" disabled={busy} onClick={() => void recheck()}>
              重新检查
            </button>
          </div>
        </section>
      ) : (
        <section className="panel empty-panel">
          <p className="hint">选择左侧提交查看详情。</p>
        </section>
      )}
    </div>
  );
}

export function App() {
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [projectType, setProjectType] = useState("");
  const [author, setAuthor] = useState<{ id: string; name: string } | null>(null);
  const [tag, setTag] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("updated");
  const [selected, setSelected] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse["user"] | null>(null);
  const [context, setContext] = useState<HostContext | null>(null);
  const [installing, setInstalling] = useState(false);
  const [downloaded, setDownloaded] = useState<Record<string, string>>(readDownloadLedger);
  const [loginFallback, setLoginFallback] = useState<string | null>(null);
  const [view, setView] = useState<"browse" | "projects" | "subs" | "admin" | "tools">("browse");
  const listRequest = useRef(0);
  const embedded = new URLSearchParams(location.search).get("embed") === "1";
  function postToHost(payload: Record<string, unknown>): void {
    if (window.parent !== window) window.parent.postMessage(payload, "*");
  }
  async function refreshMe(): Promise<void> {
    if (!api.hasSession()) return;
    try {
      const value = await api.me();
      setMe(value.user);
    } catch {
      setSessionToken(null);
      setMe(null);
    }
  }
  function login(): void {
    setError(null);
    setLoginFallback(null);
    const mode = embedded ? "device" : "browser";
    void api
      .createFlow(mode)
      .then(async (flow) => {
        if (mode === "browser") {
          const onMessage = (event: MessageEvent): void => {
            if (event.origin !== location.origin) return;
            const data: { type?: unknown; token?: unknown } = event.data;
            if (data.type !== "oauth-success" || typeof data.token !== "string") return;
            setSessionToken(data.token);
            setLoginFallback(null);
            window.removeEventListener("message", onMessage);
            void refreshMe();
          };
          window.addEventListener("message", onMessage);
        }
        const popup = window.open(flow.url, "cw-discord-login", "width=520,height=720");
        if (!popup) {
          setLoginFallback(flow.url);
          setNotice("请在打开的新页面完成 Discord 登录，本页会自动继续。");
        }
        if (mode !== "device" || !flow.deviceCode) return;
        const deadline = Date.now() + 10 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const status = await api.authFlowStatus(flow.id, flow.deviceCode);
          if (status.status === "authorized") {
            const session = await api.redeemFlow(flow.id, flow.deviceCode);
            setSessionToken(session.token);
            setLoginFallback(null);
            setNotice("登录成功。");
            await refreshMe();
            return;
          }
          if (status.status === "expired") {
            setError("登录已过期，请重新发起。");
            return;
          }
          if (status.status === "redeemed") {
            setError("登录凭据已被使用，请重新发起。");
            return;
          }
        }
        setError("等待登录超时，请重新发起。");
      })
      .catch((reason) => setError(String(reason)));
  }
  function logout(): void {
    void api.logout().finally(() => {
      setMe(null);
      setView("browse");
    });
  }
  function install(project: ProjectSummary): void {
    if (!context?.connected) {
      setError("没有检测到 SillyTavern 上下文，请从酒馆内打开。");
      return;
    }
    setInstalling(true);
    setNotice(null);
    void api
      .acquisitions(project.id)
      .then(async (payload) => {
        const files: { worldbook?: string; regex?: string } = {};
        for (const ticket of payload.tickets) {
          files[ticket.kind] = await api.downloadTicketText(ticket.url);
        }
        const target = context.worldbooks.primary ?? context.worldbooks.available[0] ?? null;
        postToHost({
          type: "cw:install",
          project: payload.project,
          files,
          targetWorldbook: target,
        });
      })
      .catch((reason) => {
        setError(String(reason));
        setInstalling(false);
      });
  }
  function uninstall(project: ProjectSummary): void {
    setInstalling(true);
    postToHost({ type: "cw:uninstall", projectId: project.id });
  }
  function download(project: ProjectSummary): void {
    setInstalling(true);
    void api
      .downloadTickets(project.id)
      .then(async (tickets) => {
        for (const file of tickets.files) {
          const blob = await api.downloadTicket(file.url);
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `${project.title}-${file.kind}.json`;
          link.click();
          URL.revokeObjectURL(url);
        }
        setDownloaded((previous) => {
          const next = { ...previous, [project.id]: project.publishedRevisionId ?? "unknown" };
          try {
            localStorage.setItem(DOWNLOAD_LEDGER_KEY, JSON.stringify(next));
          } catch {
            /* storage may be unavailable */
          }
          return next;
        });
        setNotice("下载已开始。");
      })
      .catch((reason) => setError(`下载失败：${String(reason)}`))
      .finally(() => setInstalling(false));
  }
  useEffect(() => {
    api
      .home()
      .then(setHome)
      .catch((reason) => setError(String(reason)));
    void refreshMe();
    if (embedded) postToHost({ type: "cw:ready" });
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window.parent) return;
      const data: { type?: unknown; [key: string]: unknown } = event.data;
      if (typeof data.type !== "string") return;
      if (data.type === "cw:context") setContext(data as unknown as HostContext);
      else if (data.type === "cw:install-result") {
        setInstalling(false);
        setNotice(data.ok ? "安装完成。" : `安装失败：${String(data.message ?? "")}`);
        if (data.ok) postToHost({ type: "cw:request-context" });
      } else if (data.type === "cw:uninstall-result") {
        setInstalling(false);
        const preservedEntries = Number(data.preservedEntries ?? 0);
        const preservedRegexes = Number(data.preservedRegexes ?? 0);
        setNotice(
          data.ok
            ? preservedEntries + preservedRegexes > 0
              ? `卸载完成；保留了 ${preservedEntries} 个玩家修改条目、${preservedRegexes} 条玩家修改正则。`
              : "卸载完成。"
            : `卸载失败：${String(data.message ?? "")}`,
        );
        if (data.ok) postToHost({ type: "cw:request-context" });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embedded]);
  useEffect(() => {
    let cancelled = false;
    const requestId = ++listRequest.current;
    const timer = setTimeout(() => {
      api
        .projects({
          search: search.trim() || undefined,
          sort,
          projectType: projectType || undefined,
          authorId: author?.id,
          tag: tag.trim() || undefined,
        })
        .then((result) => {
          if (!cancelled && requestId === listRequest.current) {
            setProjects(result.items);
            setNextCursor(result.nextCursor);
          }
        })
        .catch((reason) => {
          if (!cancelled && requestId === listRequest.current) setError(String(reason));
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, sort, projectType, author, tag]);
  function loadMore(): void {
    if (!nextCursor) return;
    const requestId = listRequest.current;
    api
      .projects({
        search: search.trim() || undefined,
        sort,
        projectType: projectType || undefined,
        authorId: author?.id,
        tag: tag.trim() || undefined,
        cursor: nextCursor,
      })
      .then((result) => {
        if (requestId !== listRequest.current) return;
        setProjects((previous) => [...previous, ...result.items]);
        setNextCursor(result.nextCursor);
      })
      .catch((reason) => {
        if (requestId === listRequest.current) setError(String(reason));
      });
  }
  function installationState(project: ProjectSummary): InstallState {
    const record = context?.registry?.[project.id];
    if (!record) return "notInstalled";
    if (project.publishedRevisionId && record.version !== project.publishedRevisionId) return "updateAvailable";
    const scan = context?.installStates?.[project.id];
    if (scan === "localChanged") return "localChanged";
    if (scan === "scanIncomplete" || !scan) return "scanIncomplete";
    return "upToDate";
  }
  const selectedInstallState = selected ? installationState(selected) : "notInstalled";
  const reviewer = me?.role === "reviewer" || me?.role === "owner";
  return (
    <div className={`shell${embedded ? " embedded" : ""}`}>
      <header>
        <div>
          <p className="eyebrow">命定之诗与黄昏之歌</p>
          <h1>创意工坊</h1>
        </div>
        <div className="header-tools">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索项目、作者、标签"
            aria-label="搜索"
          />
          {me ? (
            <div className="account">
              <span>{me.globalName || me.username}</span>
              <button type="button" onClick={logout}>
                退出
              </button>
            </div>
          ) : (
            <button type="button" className="login" onClick={login}>
              Discord 登录
            </button>
          )}
        </div>
      </header>
      {me ? (
        <nav className="main-nav" aria-label="主导航">
          <button type="button" className={view === "browse" ? "active" : ""} onClick={() => setView("browse")}>
            工坊
          </button>
          <button type="button" className={view === "projects" ? "active" : ""} onClick={() => setView("projects")}>
            我的项目
          </button>
          <button type="button" className={view === "subs" ? "active" : ""} onClick={() => setView("subs")}>
            订阅
          </button>
          {reviewer ? (
            <button type="button" className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>
              审核台
            </button>
          ) : null}
          {me?.role === "owner" ? (
            <button type="button" className={view === "tools" ? "active" : ""} onClick={() => setView("tools")}>
              管理
            </button>
          ) : null}
        </nav>
      ) : null}
      {home?.banner?.imageUrl && view === "browse" ? (
        <div
          className="banner"
          style={
            {
              backgroundImage: `url(${home.banner.imageUrl})`,
              "--banner-x": `${home.banner.positionX}%`,
              "--banner-y": `${home.banner.positionY}%`,
              "--banner-mobile-x": `${home.banner.mobilePositionX ?? home.banner.positionX}%`,
              "--banner-mobile-y": `${home.banner.mobilePositionY ?? home.banner.positionY}%`,
              "--banner-size": home.banner.zoom > 1 ? `${home.banner.zoom * 100}% auto` : "cover",
              "--banner-mobile-size":
                (home.banner.mobileZoom ?? home.banner.zoom) > 1
                  ? `${(home.banner.mobileZoom ?? home.banner.zoom) * 100}% auto`
                  : "cover",
            } as CSSProperties
          }
        />
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="关闭提示">
            ×
          </button>
        </p>
      ) : null}
      {loginFallback ? (
        <p className="notice">
          <a href={loginFallback} target="_blank" rel="noopener opener">
            打开 Discord 登录页
          </a>
        </p>
      ) : null}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      {view === "projects" && me ? (
        <MyProjects
          onError={(message) => {
            setError(message);
            setNotice(null);
          }}
          onNotice={(message) => {
            setNotice(message);
            setError(null);
          }}
        />
      ) : view === "subs" && me ? (
        <Subscriptions
          onOpen={(project) => {
            setSelected(project);
            setView("browse");
          }}
          onError={(message) => {
            setError(message);
            setNotice(null);
          }}
        />
      ) : view === "admin" && reviewer ? (
        <AdminPanel
          onError={(message) => {
            setError(message);
            setNotice(null);
          }}
          onNotice={(message) => {
            setNotice(message);
            setError(null);
          }}
        />
      ) : view === "tools" && me?.role === "owner" ? (
        <AdminTools
          onError={(message) => {
            setError(message);
            setNotice(null);
          }}
          onNotice={(message) => {
            setNotice(message);
            setError(null);
          }}
        />
      ) : (
        <>
          {" "}
          {!search.trim() && !projectType && !author && !tag.trim() ? <Discovery onOpen={setSelected} /> : null}
          <nav className="sorts" aria-label="排序">
            {SORTS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={sort === value ? "active" : ""}
                onClick={() => setSort(value)}
              >
                {label}
              </button>
            ))}
          </nav>
          <nav className="sorts filters" aria-label="类型">
            {["", ...PROJECT_TYPES].map((value) => (
              <button
                key={value || "all"}
                type="button"
                className={projectType === value ? "active" : ""}
                onClick={() => setProjectType(value)}
              >
                {value || "全部"}
              </button>
            ))}
            <input
              className="tag-filter"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              placeholder="标签筛选"
              aria-label="标签筛选"
            />
          </nav>
          {author ? (
            <p className="active-filter">
              作者：{author.name}
              <button type="button" onClick={() => setAuthor(null)}>
                清除
              </button>
            </p>
          ) : null}
          <p className="list-range">{projects.length === 0 ? "暂无项目" : `第 1–${projects.length} 条`}</p>
          <main className="grid">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} onOpen={setSelected} />
            ))}
          </main>
          {nextCursor ? (
            <div className="load-more">
              <button type="button" onClick={loadMore}>
                加载更多
              </button>
            </div>
          ) : null}
        </>
      )}
      {selected && view === "browse" ? (
        <Detail
          project={selected}
          onClose={() => setSelected(null)}
          onInstall={install}
          onUninstall={uninstall}
          onDownload={download}
          onAuthor={(value) => {
            setAuthor(value);
            setSelected(null);
          }}
          onError={setError}
          downloadedRevision={downloaded[selected.id] ?? null}
          installState={selectedInstallState}
          loggedIn={Boolean(me)}
          installing={installing}
          embedded={embedded}
        />
      ) : null}
    </div>
  );
}

import { analyzeLocalProjectCode, type CheckerReport } from "@workshop/content";
import { useEffect, useState } from "react";
import { type AuthorProject, api } from "../../api";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { EXTENSION_TYPES, metadataPayload, PROJECT_TYPES, type ProjectForm, projectForm } from "./projectMetadata";

function clientGate(report: CheckerReport): "pass" | "warn" | "block" {
  if (report.gate === "reject") return "block";
  if (report.certification === "fail" || report.certification === "review" || report.audit === "yellow") return "warn";
  return "pass";
}

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
  const [localFiles, setLocalFiles] = useState<{ worldbook?: File; regex?: File }>({});
  const [preflight, setPreflight] = useState<{
    status: "empty" | "checking" | "pass" | "warn" | "block";
    warnings: number;
  }>({ status: "empty", warnings: 0 });
  const [busy, setBusy] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverNonce, setCoverNonce] = useState(0);
  const workingRevisionFrozen = Boolean(
    entry.latestSubmission && entry.latestSubmission.revisionId === workingRevisionId,
  );
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
      if (workingRevisionFrozen) return;
      const result = await api.patchProject(entry.project.id, entry.rowVersion, metadataPayload(form));
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
      const result = await api.createRevision(entry.project.id, entry.rowVersion, metadataPayload(form));
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
    if (!file || !workingRevisionId || workingRevisionFrozen) return;
    if (kind !== "cover") setLocalFiles((previous) => ({ ...previous, [kind]: file }));
    setBusy(true);
    try {
      await api.uploadFile(entry.project.id, workingRevisionId, entry.rowVersion, kind, file);
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
      if (!workingRevisionId || workingRevisionFrozen) return;
      if (gate === "missing" && !window.confirm("没有可检查的本地文件，提交会转入人工审核，确定继续吗？")) return;
      await api.submitProject(entry.project.id, workingRevisionId, entry.rowVersion, {
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
      {workingRevisionFrozen ? (
        <p className="notice">这个版本已提交并冻结。修改内容请先新建版本；公开展示信息可在下方单独编辑。</p>
      ) : null}
      {input("title", "标题")}
      {input("description", "简介", true)}
      {input("authorNote", "作者说明", true)}
      {input("precautions", "注意事项", true)}
      <div className="form-grid">
        {input("schemaVersion", "适配 schema")}
        {input("discordThreadUrl", "Discord 讨论链接")}
      </div>
      <div className="form-grid">
        {input("versionLabel", "版本号")}
        <label>
          项目类型
          <select
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
        <label>
          扩展类型
          <select
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
        <button type="button" className="primary" onClick={() => void save()} disabled={busy || workingRevisionFrozen}>
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
            disabled={busy || workingRevisionFrozen}
            onChange={(event) => void upload("worldbook", event.target.files?.[0])}
          />
        </label>
        <label className="file-button">
          上传正则 JSON
          <input
            type="file"
            accept=".json,application/json,text/plain"
            disabled={busy || workingRevisionFrozen}
            onChange={(event) => void upload("regex", event.target.files?.[0])}
          />
        </label>
        <label className="file-button">
          上传封面
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy || workingRevisionFrozen}
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
        <button
          type="button"
          className="primary"
          onClick={() => void submit()}
          disabled={busy || !workingRevisionId || workingRevisionFrozen}
        >
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

import { useEffect, useState } from "react";
import {
  api,
  setSessionToken,
  type AdminSubmissionDetail,
  type AdminSubmissionListItem,
  type AuthorProject,
  type HomeResponse,
  type MeResponse,
  type ProjectSummary,
  type SubmissionDiff,
} from "./api";
import { AdminTools } from "./AdminTools";

const SORTS = [["updated", "最近更新"], ["published", "发布时间"], ["downloads", "下载"], ["likes", "点赞"]] as const;
const PROJECT_TYPES = ["事件", "系统核心", "角色", "扩展"] as const;
const EXTENSION_TYPES = ["规则", "内容"] as const;
interface HostContext { connected: boolean; characterName: string | null; worldbooks: { primary: string | null; additional: string[]; available: string[] }; registry: Record<string, { version: string; worldbookName: string; entryCount?: number }>; clientVersion: string; error?: string; }
interface ProjectForm { title: string; description: string; authorNote: string; precautions: string; versionLabel: string; projectType: string; extensionType: string; tags: string; }

function ProjectCard({ project, onOpen }: { project: ProjectSummary; onOpen: (p: ProjectSummary) => void }) {
  return <button className="card" type="button" onClick={() => onOpen(project)}>
    <div className="cover">{project.coverUrl ? <img src={project.coverUrl} alt="" loading="lazy" /> : <span>无封面</span>}</div>
    <div className="card-body"><h3>{project.title}</h3><p className="author">{project.author.name}</p><p className="meta">世界书 {project.entries.worldbook} 条 | 正则 {project.entries.regex} 条</p><div className="tags">{project.projectType ? <span>{project.projectType}</span> : null}{project.schemaVersion ? <span>适配 {project.schemaVersion}</span> : null}{project.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}</div></div>
  </button>;
}

function Detail({ project, onClose, onInstall, onUninstall, installedVersion, loggedIn, installing, embedded }: { project: ProjectSummary; onClose: () => void; onInstall: (p: ProjectSummary) => void; onUninstall: (p: ProjectSummary) => void; installedVersion: string | null; loggedIn: boolean; installing: boolean; embedded: boolean }) {
  return <aside className="detail"><button className="close" type="button" onClick={onClose}>关闭</button><h2>{project.title}</h2><p className="author">{project.author.name}</p><p>{project.description}</p><dl><div><dt>世界书</dt><dd>{project.entries.worldbook} 条</dd></div><div><dt>正则</dt><dd>{project.entries.regex} 条</dd></div><div><dt>下载</dt><dd>{project.counts.downloads}</dd></div><div><dt>点赞</dt><dd>{project.counts.likes}</dd></div></dl>{installedVersion ? <p className="installed">已安装：{installedVersion}</p> : null}{!embedded ? <p className="hint">安装请从 SillyTavern 内的「命定创意工坊」按钮打开。</p> : !loggedIn ? <p className="hint">请先使用 Discord 登录，再安装到当前角色。</p> : <div className="actions"><button type="button" className="primary" disabled={installing} onClick={() => onInstall(project)}>{installing ? "安装中…" : installedVersion ? "更新" : "安装"}</button>{installedVersion ? <button type="button" disabled={installing} onClick={() => onUninstall(project)}>卸载</button> : null}</div>}</aside>;
}

function projectForm(project: ProjectSummary): ProjectForm {
  return { title: project.title, description: project.description ?? "", authorNote: "", precautions: "", versionLabel: project.versionLabel ?? "", projectType: project.projectType ?? "", extensionType: project.extensionType ?? "", tags: project.tags.join(", ") };
}

function ProjectEditor({ entry, onRefresh, onError, onNotice }: { entry: AuthorProject; onRefresh: () => Promise<void>; onError: (message: string) => void; onNotice: (message: string) => void }) {
  const [form, setForm] = useState<ProjectForm>(() => projectForm(entry.project));
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(projectForm(entry.project)), [entry.project.id]);
  const update = (key: keyof ProjectForm, value: string): void => setForm(previous => ({ ...previous, [key]: value }));
  async function save(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.patchProject(entry.project.id, entry.rowVersion, {
        title: form.title, description: form.description || null, authorNote: form.authorNote || null, precautions: form.precautions || null,
        versionLabel: form.versionLabel || null, projectType: form.projectType || null, extensionType: form.extensionType || null,
        tags: form.tags.split(",").map(tag => tag.trim()).filter(Boolean),
      });
      onNotice(`已保存（版本 ${result.rowVersion}）。`);
      await onRefresh();
    } catch (reason) { onError(String(reason)); } finally { setBusy(false); }
  }
  async function upload(kind: "worldbook" | "regex" | "cover", file: File | undefined): Promise<void> {
    if (!file || !entry.workingRevisionId) return;
    setBusy(true);
    try { await api.uploadFile(entry.project.id, entry.workingRevisionId, kind, file); onNotice(`${kind === "cover" ? "封面" : kind === "worldbook" ? "世界书" : "正则"}已上传。`); await onRefresh(); }
    catch (reason) { onError(String(reason)); } finally { setBusy(false); }
  }
  async function submit(): Promise<void> {
    if (!entry.workingRevisionId) return;
    if (!window.confirm("提交后将进入审核流程。若没有客户端 checker，系统会转入人工审核，确定提交吗？")) return;
    setBusy(true);
    try { await api.submitProject(entry.project.id, entry.workingRevisionId, { gate: "missing", acknowledged: true, warningCount: 0 }); onNotice("已提交审核；缺少客户端 checker 的版本会进入人工审核。"); await onRefresh(); }
    catch (reason) { onError(String(reason)); } finally { setBusy(false); }
  }
  async function remove(): Promise<void> {
    if (!window.confirm(`确定删除「${entry.project.title}」？此操作不可撤销。`)) return;
    setBusy(true);
    try { await api.deleteProject(entry.project.id, entry.rowVersion); onNotice("项目已删除。"); await onRefresh(); }
    catch (reason) { onError(String(reason)); } finally { setBusy(false); }
  }
  const input = (key: keyof ProjectForm, label: string, multiline = false) => multiline
    ? <label>{label}<textarea value={form[key]} onChange={event => update(key, event.target.value)} /></label>
    : <label>{label}<input value={form[key]} onChange={event => update(key, event.target.value)} /></label>;
  return <section className="panel editor"><div className="panel-heading"><div><h2>编辑项目</h2><p className="hint">{entry.project.visibility === "public" ? "公开" : "私有"} · rowVersion {entry.rowVersion}</p></div><button type="button" onClick={remove} disabled={busy}>删除项目</button></div>
    {input("title", "标题")}{input("description", "简介", true)}{input("authorNote", "作者说明", true)}{input("precautions", "注意事项", true)}
    <div className="form-grid">{input("versionLabel", "版本号")}<label>项目类型<select value={form.projectType} onChange={event => update("projectType", event.target.value)}><option value="">请选择</option>{PROJECT_TYPES.map(value => <option key={value}>{value}</option>)}</select></label><label>扩展类型<select value={form.extensionType} onChange={event => update("extensionType", event.target.value)}><option value="">不适用</option>{EXTENSION_TYPES.map(value => <option key={value}>{value}</option>)}</select></label>{input("tags", "标签（逗号分隔）")}</div>
    <div className="actions"><button type="button" className="primary" onClick={() => void save()} disabled={busy}>保存元数据</button><label className="file-button">上传世界书 JSON<input type="file" accept=".json,application/json,text/plain" onChange={event => void upload("worldbook", event.target.files?.[0])} /></label><label className="file-button">上传正则 JSON<input type="file" accept=".json,application/json,text/plain" onChange={event => void upload("regex", event.target.files?.[0])} /></label><label className="file-button">上传封面<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void upload("cover", event.target.files?.[0])} /></label></div>
    <div className="submit-box"><strong>提交审核</strong><p className="hint">当前提交按“无客户端 checker”处理，会明确进入人工审核；请确认文件和元数据已经完整。</p><button type="button" className="primary" onClick={() => void submit()} disabled={busy || !entry.workingRevisionId}>提交当前版本</button>{entry.latestSubmission ? <span className="status">最近提交：{entry.latestSubmission.status} / {entry.latestSubmission.checkStatus}{entry.latestSubmission.reason ? ` · ${entry.latestSubmission.reason}` : ""}</span> : null}</div>
  </section>;
}

function MyProjects({ onError, onNotice }: { onError: (message: string) => void; onNotice: (message: string) => void }) {
  const [items, setItems] = useState<AuthorProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ title: "", description: "", versionLabel: "", projectType: "事件", extensionType: "", tags: "" });
  async function refresh(): Promise<void> {
    try { const result = await api.myProjects(); setItems(result.items); if (selectedId && !result.items.some(item => item.project.id === selectedId)) setSelectedId(null); }
    catch (reason) { onError(String(reason)); }
  }
  useEffect(() => { void refresh(); }, []);
  async function create(): Promise<void> {
    if (!createForm.title.trim()) return;
    setCreating(true);
    try {
      const result = await api.createProject({ title: createForm.title.trim(), description: createForm.description || null, versionLabel: createForm.versionLabel || null, projectType: createForm.projectType || null, extensionType: createForm.extensionType || null, tags: createForm.tags.split(",").map(tag => tag.trim()).filter(Boolean) });
      setCreateForm({ title: "", description: "", versionLabel: "", projectType: "事件", extensionType: "", tags: "" }); setSelectedId(result.project.id); onNotice("项目已创建。"); await refresh();
    } catch (reason) { onError(String(reason)); } finally { setCreating(false); }
  }
  const selected = items.find(item => item.project.id === selectedId) ?? null;
  return <div className="workspace"><section className="panel"><div className="panel-heading"><h2>我的项目</h2><button type="button" onClick={() => void refresh()}>刷新</button></div>{items.length === 0 ? <p className="hint">还没有项目，先创建一个草稿吧。</p> : <div className="project-list">{items.map(item => <button key={item.project.id} type="button" className={`project-row${item.project.id === selectedId ? " selected" : ""}`} onClick={() => setSelectedId(item.project.id)}><span><strong>{item.project.title}</strong><small>{item.project.visibility === "public" ? "公开" : "私有"} · {item.project.projectType ?? "未分类"} · v{item.project.versionLabel ?? "未标注"}</small></span><span className="status">{item.latestSubmission ? `${item.latestSubmission.checkStatus} / ${item.latestSubmission.decision ?? item.latestSubmission.status}` : "未提交"}</span></button>)}</div>}</section>
    <section className="panel create-panel"><h2>创建项目</h2><div className="form-grid"><label>标题<input value={createForm.title} onChange={event => setCreateForm({ ...createForm, title: event.target.value })} /></label><label>版本号<input value={createForm.versionLabel} onChange={event => setCreateForm({ ...createForm, versionLabel: event.target.value })} /></label><label>项目类型<select value={createForm.projectType} onChange={event => setCreateForm({ ...createForm, projectType: event.target.value })}>{PROJECT_TYPES.map(value => <option key={value}>{value}</option>)}</select></label><label>扩展类型<select value={createForm.extensionType} onChange={event => setCreateForm({ ...createForm, extensionType: event.target.value })}><option value="">不适用</option>{EXTENSION_TYPES.map(value => <option key={value}>{value}</option>)}</select></label><label>标签（逗号分隔）<input value={createForm.tags} onChange={event => setCreateForm({ ...createForm, tags: event.target.value })} /></label></div><label>简介<textarea value={createForm.description} onChange={event => setCreateForm({ ...createForm, description: event.target.value })} /></label><button type="button" className="primary" onClick={() => void create()} disabled={creating || !createForm.title.trim()}>创建草稿</button></section>
    {selected ? <ProjectEditor entry={selected} onRefresh={refresh} onError={onError} onNotice={onNotice} /> : null}</div>;
}

function AdminPanel({ onError, onNotice }: { onError: (message: string) => void; onNotice: (message: string) => void }) {
  const [items, setItems] = useState<AdminSubmissionListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminSubmissionDetail | null>(null);
  const [diff, setDiff] = useState<SubmissionDiff | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh(): Promise<void> {
    try { const [pending, checking] = await Promise.all([api.adminSubmissions("pending"), api.adminSubmissions("checking")]); const merged = [...pending.items, ...checking.items].filter((item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index); setItems(merged); if (selectedId) await select(selectedId); }
    catch (value) { onError(String(value)); }
  }
  async function select(id: string): Promise<void> {
    setSelectedId(id);
    try { const [nextDetail, nextDiff] = await Promise.all([api.adminSubmission(id), api.adminDiff(id)]); setDetail(nextDetail); setDiff(nextDiff); }
    catch (value) { onError(String(value)); }
  }
  useEffect(() => { void refresh(); }, []);
  async function review(decision: "approve" | "reject"): Promise<void> {
    if (decision === "reject" && !reason.trim()) { onError("拒绝审核必须填写理由。"); return; }
    if ((detail?.submission.gate === "block" || detail?.submission.clientGate === "missing") && !reason.trim()) { onError("阻断或缺少 checker 的提交必须填写审核说明。"); return; }
    if (!selectedId) return;
    setBusy(true);
    try { await api.adminReview(selectedId, decision, reason.trim() || undefined); setReason(""); onNotice(decision === "approve" ? "已通过审核。" : "已拒绝审核。"); await refresh(); }
    catch (value) { onError(String(value)); } finally { setBusy(false); }
  }
  async function recheck(): Promise<void> { if (!selectedId) return; setBusy(true); try { await api.adminRecheck(selectedId); onNotice("已重新排队检查。"); await refresh(); } catch (value) { onError(String(value)); } finally { setBusy(false); } }
  async function download(kind: "worldbook" | "regex" | "cover"): Promise<void> { if (!selectedId) return; try { const blob = await api.adminFile(selectedId, kind); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${selectedId}-${kind}`; link.click(); URL.revokeObjectURL(url); } catch (value) { onError(String(value)); } }
  return <div className="admin-layout"><section className="panel"><div className="panel-heading"><h2>审核台</h2><button type="button" onClick={() => void refresh()}>刷新</button></div>{items.length === 0 ? <p className="hint">暂无待处理提交。</p> : <div className="project-list">{items.map(item => <button className={`project-row${item.id === selectedId ? " selected" : ""}`} type="button" key={item.id} onClick={() => void select(item.id)}><span><strong>{item.projectTitle}</strong><small>{item.author.name} · {item.status} · {item.checkStatus}</small></span><span className="status">{item.gate ?? "missing"}</span></button>)}</div>}</section>
    {detail ? <section className="panel review-detail"><h2>{detail.project.title}</h2><p className="hint">作者：{detail.project.author.name} · revision #{detail.revision.revisionNo}</p><dl><div><dt>客户端 gate</dt><dd>{detail.submission.clientGate ?? "missing"}</dd></div><div><dt>检查状态</dt><dd>{detail.submission.checkStatus}</dd></div><div><dt>检查报告 gate</dt><dd>{detail.checkRuns[0]?.routeGate ?? "暂无"}</dd></div><div><dt>提交时间</dt><dd>{detail.submission.submittedAt}</dd></div></dl><h3>检查报告</h3><pre className="report">{JSON.stringify(detail.submission.checkReport, null, 2) ?? "暂无报告"}</pre><h3>差异</h3>{diff ? <div className="diff-grid">{(["worldbook", "regex"] as const).map(kind => <div key={kind}><strong>{kind === "worldbook" ? "世界书" : "正则"}</strong><p>新增 {diff[kind].added.length} · 修改 {diff[kind].modified.length} · 删除 {diff[kind].deleted.length}</p><ul>{[...diff[kind].added.map(item => `+ ${item.name}`), ...diff[kind].modified.map(item => `~ ${item.name}`), ...diff[kind].deleted.map(item => `- ${item.name}`)].slice(0, 12).map(item => <li key={item}>{item}</li>)}</ul></div>)}</div> : <p className="hint">暂无差异。</p>}<h3>文件</h3><div className="actions">{(["worldbook", "regex", "cover"] as const).map(kind => <button type="button" key={kind} onClick={() => void download(kind)}>{kind} 下载</button>)}</div><label>审核说明<textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="拒绝、阻断或人工放行时填写理由" /></label><div className="actions"><button type="button" className="primary" disabled={busy} onClick={() => void review("approve")}>通过</button><button type="button" disabled={busy} onClick={() => void review("reject")}>拒绝</button><button type="button" disabled={busy} onClick={() => void recheck()}>重新检查</button></div></section> : <section className="panel empty-panel"><p className="hint">选择左侧提交查看详情。</p></section>}</div>;
}

export function App() {
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("updated");
  const [selected, setSelected] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse["user"] | null>(null);
  const [context, setContext] = useState<HostContext | null>(null);
  const [installing, setInstalling] = useState(false);
  const [view, setView] = useState<"browse" | "projects" | "admin" | "tools">("browse");
  const embedded = new URLSearchParams(location.search).get("embed") === "1";
  function postToHost(payload: Record<string, unknown>): void { if (window.parent !== window) window.parent.postMessage(payload, "*"); }
  async function refreshMe(): Promise<void> { if (!api.hasSession()) return; try { const value = await api.me(); setMe(value.user); } catch { setSessionToken(null); setMe(null); } }
  function login(): void { setError(null); void api.createFlow().then(flow => { const popup = window.open(flow.url, "cw-discord-login", "width=520,height=720"); if (!popup) { setError("登录窗口被浏览器拦截，请允许弹窗后重试。"); return; } const onMessage = (event: MessageEvent): void => { if (event.origin !== location.origin) return; const data: { type?: unknown; token?: unknown } = event.data; if (data.type !== "oauth-success" || typeof data.token !== "string") return; setSessionToken(data.token); window.removeEventListener("message", onMessage); void refreshMe(); }; window.addEventListener("message", onMessage); }).catch(reason => setError(String(reason))); }
  function logout(): void { void api.logout().finally(() => { setMe(null); setView("browse"); }); }
  function install(project: ProjectSummary): void { if (!context?.connected) { setError("没有检测到 SillyTavern 上下文，请从酒馆内打开。"); return; } setInstalling(true); setNotice(null); void api.install(project.id).then(payload => { const target = context.worldbooks.primary ?? context.worldbooks.available[0] ?? null; postToHost({ type: "cw:install", project: payload.project, files: payload.files, targetWorldbook: target }); }).catch(reason => { setError(String(reason)); setInstalling(false); }); }
  function uninstall(project: ProjectSummary): void { setInstalling(true); postToHost({ type: "cw:uninstall", projectId: project.id }); }
  useEffect(() => { api.home().then(setHome).catch(reason => setError(String(reason))); void refreshMe(); if (embedded) postToHost({ type: "cw:ready" }); const onMessage = (event: MessageEvent): void => { if (event.source !== window.parent) return; const data: { type?: unknown; [key: string]: unknown } = event.data; if (typeof data.type !== "string") return; if (data.type === "cw:context") setContext(data as unknown as HostContext); else if (data.type === "cw:install-result") { setInstalling(false); setNotice(data.ok ? "安装完成。" : `安装失败：${String(data.message ?? "")}`); if (data.ok) postToHost({ type: "cw:request-context" }); } else if (data.type === "cw:uninstall-result") { setInstalling(false); setNotice(data.ok ? "卸载完成。" : `卸载失败：${String(data.message ?? "")}`); if (data.ok) postToHost({ type: "cw:request-context" }); } }; window.addEventListener("message", onMessage); return () => window.removeEventListener("message", onMessage); }, [embedded]);
  useEffect(() => { let cancelled = false; const timer = setTimeout(() => { api.projects({ search: search.trim() || undefined, sort }).then(result => { if (!cancelled) setProjects(result.items); }).catch(reason => { if (!cancelled) setError(String(reason)); }); }, 200); return () => { cancelled = true; clearTimeout(timer); }; }, [search, sort]);
  const installed = selected ? context?.registry?.[selected.id] ?? null : null;
  const reviewer = me?.role === "reviewer" || me?.role === "owner";
  return <div className={`shell${embedded ? " embedded" : ""}`}><header><div><p className="eyebrow">命定之诗与黄昏之歌</p><h1>创意工坊</h1></div><div className="header-tools"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索项目、作者、标签" aria-label="搜索" />{me ? <div className="account"><span>{me.globalName || me.username}</span><button type="button" onClick={logout}>退出</button></div> : <button type="button" className="login" onClick={login}>Discord 登录</button>}</div></header>
    {me ? <nav className="main-nav" aria-label="主导航"><button type="button" className={view === "browse" ? "active" : ""} onClick={() => setView("browse")}>工坊</button><button type="button" className={view === "projects" ? "active" : ""} onClick={() => setView("projects")}>我的项目</button>{reviewer ? <button type="button" className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>审核台</button> : null}{me?.role === "owner" ? <button type="button" className={view === "tools" ? "active" : ""} onClick={() => setView("tools")}>管理</button> : null}</nav> : null}
    {home?.banner?.imageUrl && view === "browse" ? <div className="banner" style={{ backgroundImage: `url(${home.banner.imageUrl})` }} /> : null}{error ? <p className="error">{error}<button type="button" onClick={() => setError(null)}>×</button></p> : null}{notice ? <p className="notice">{notice}</p> : null}
    {view === "projects" && me ? <MyProjects onError={message => { setError(message); setNotice(null); }} onNotice={message => { setNotice(message); setError(null); }} /> : view === "admin" && reviewer ? <AdminPanel onError={message => { setError(message); setNotice(null); }} onNotice={message => { setNotice(message); setError(null); }} /> : view === "tools" && me?.role === "owner" ? <AdminTools onError={message => { setError(message); setNotice(null); }} onNotice={message => { setNotice(message); setError(null); }} /> : <><nav className="sorts" aria-label="排序">{SORTS.map(([value, label]) => <button key={value} type="button" className={sort === value ? "active" : ""} onClick={() => setSort(value)}>{label}</button>)}</nav><main className="grid">{projects.map(project => <ProjectCard key={project.id} project={project} onOpen={setSelected} />)}</main></>}
    {selected && view === "browse" ? <Detail project={selected} onClose={() => setSelected(null)} onInstall={install} onUninstall={uninstall} installedVersion={installed?.version ?? null} loggedIn={Boolean(me)} installing={installing} embedded={embedded} /> : null}</div>;
}

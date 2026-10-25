import { useEffect, useRef, useState } from "react";
import {
  type AdminAuditEvent,
  type AdminMember,
  type AdminProject,
  ApiError,
  api,
  type JsonValue,
  type Recommendation,
  type ReferenceSet,
  type SiteBanner,
  type SiteSettings,
} from "./api";
import { ConfirmDialog } from "./components/ui/confirm-dialog";

type Role = "member" | "reviewer" | "owner";

const ROLE_LABELS: Record<Role, string> = {
  member: "成员",
  reviewer: "审核员",
  owner: "站长",
};

const EMPTY_BANNER: SiteBanner = {
  imageUrl: null,
  positionX: 50,
  positionY: 50,
  zoom: 1,
  mobilePositionX: 50,
  mobilePositionY: 50,
  mobileZoom: 1,
};

/** Chinese labels for the action strings written by apps/worker/src (audit_events inserts). */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "checker.recheck": "重新校验",
  "review.approve": "审核通过",
  "review.reject": "审核拒绝",
  "review.auto_publish": "自动发布",
  "review.auto_publish_conflict": "自动发布冲突",
  "project.patch": "编辑项目",
  "project.delete": "删除项目",
  "project.published_metadata.patch": "编辑已发布信息",
  "project.published_cover.put": "更新已发布封面",
  "member.role_change": "修改成员角色",
  "recommendation.update": "更新编辑精选",
  "recommendation.delete": "移除编辑精选",
  "reference_set.create": "创建角色基线",
  "reference_set.update": "更新角色基线",
  "reference_version.create": "新建基线版本",
  "site.update": "更新站点设置",
};

const AUDIT_ACTION_OPTIONS = Object.keys(AUDIT_ACTION_LABELS);

function parseJson(text: string): JsonValue {
  return JSON.parse(text) as JsonValue;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

function auditReason(detail: JsonValue): string | null {
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) return null;
  const reason = (detail as Record<string, JsonValue>).reason;
  return typeof reason === "string" && reason.trim() ? reason : null;
}

function roleErrorMessage(value: unknown): string {
  if (value instanceof ApiError) {
    if (value.status === 409 && /last owner/i.test(value.message)) {
      return "无法降级最后一位站长：站点必须至少保留一名站长（owner）。";
    }
    if (value.status === 403) return "只有站长可以修改成员角色。";
    return value.message;
  }
  return String(value);
}

export function AdminTools({
  onError,
  onNotice,
}: {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [memberCursor, setMemberCursor] = useState<string | null>(null);
  const [memberLoadingMore, setMemberLoadingMore] = useState(false);
  const [memberRoleFilter, setMemberRoleFilter] = useState<"all" | Role>("all");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<{ member: AdminMember; role: Role } | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [audit, setAudit] = useState<AdminAuditEvent[]>([]);
  const [auditAction, setAuditAction] = useState("");
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recSearch, setRecSearch] = useState("");
  const [recResults, setRecResults] = useState<AdminProject[]>([]);
  const [recSearched, setRecSearched] = useState(false);
  const [recSearching, setRecSearching] = useState(false);
  const [selectedProject, setSelectedProject] = useState<AdminProject | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [reaction, setReaction] = useState("");
  const [recBusy, setRecBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Recommendation | null>(null);
  const [sets, setSets] = useState<ReferenceSet[]>([]);
  const [site, setSite] = useState<SiteSettings | null>(null);
  const [banner, setBanner] = useState<SiteBanner>(EMPTY_BANNER);
  const [siteText, setSiteText] = useState("{}");
  const [setId, setSetId] = useState("");
  const [setName, setSetName] = useState("");
  const [setDescription, setSetDescription] = useState("");
  const [setVersion, setSetVersion] = useState("");
  const [setItems, setSetItems] = useState("[]");
  const [newSetName, setNewSetName] = useState("");
  const [newSetVersion, setNewSetVersion] = useState("1");
  const [busy, setBusy] = useState(false);
  /** Bumped by every audit load so a slower, older request cannot overwrite newer results or the cursor. */
  const auditGeneration = useRef(0);
  /** Same guard for recommendation project searches, which can overlap with form resets. */
  const recSearchGeneration = useRef(0);
  /** Synchronous in-flight guards: state updates land too late to stop a double-click from firing twice. */
  const memberLoadingRef = useRef(false);
  const roleBusyRef = useRef(false);
  const recBusyRef = useRef(false);

  async function refresh(): Promise<void> {
    setBusy(true);
    try {
      const [projectList, memberList, referenceList, siteValue, recommendationList] = await Promise.all([
        api.adminProjects(projectSearch || undefined),
        api.adminMembers(),
        api.referenceSets(),
        api.site(),
        api.recommendations(),
      ]);
      setProjects(projectList.items);
      setMembers(memberList.items);
      setMemberCursor(memberList.nextCursor);
      setMemberError(null);
      setSets(referenceList.items);
      setSite(siteValue);
      setBanner(siteValue.banner ?? EMPTY_BANNER);
      setSiteText(JSON.stringify(siteValue.siteContent ?? {}, null, 2));
      setRecommendations(recommendationList.items);
    } catch (value) {
      onError(String(value));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    void loadAudit("");
  }, []);

  async function loadAudit(action: string, cursor?: string): Promise<void> {
    const generation = ++auditGeneration.current;
    if (cursor) {
      setAuditLoadingMore(true);
    } else {
      setAuditBusy(true);
      // A fresh first page invalidates pagination from the previous filter result set.
      setAuditCursor(null);
    }
    try {
      const result = await api.auditEvents({ action: action || undefined, cursor });
      if (generation !== auditGeneration.current) return;
      setAudit((previous) => (cursor ? [...previous, ...result.items] : result.items));
      setAuditCursor(result.nextCursor);
    } catch (value) {
      if (generation !== auditGeneration.current) return;
      onError(`审计日志加载失败：${String(value)}`);
    } finally {
      if (generation === auditGeneration.current) {
        setAuditBusy(false);
        setAuditLoadingMore(false);
      }
    }
  }

  function changeAuditAction(action: string): void {
    setAuditAction(action);
    void loadAudit(action);
  }

  async function loadMoreMembers(): Promise<void> {
    if (!memberCursor || memberLoadingRef.current) return;
    memberLoadingRef.current = true;
    setMemberLoadingMore(true);
    try {
      const result = await api.adminMembers(memberCursor);
      setMembers((previous) => [...previous, ...result.items]);
      setMemberCursor(result.nextCursor);
    } catch (value) {
      onError(`成员加载失败：${String(value)}`);
    } finally {
      memberLoadingRef.current = false;
      setMemberLoadingMore(false);
    }
  }

  function selectSet(id: string): void {
    const set = sets.find((item) => item.id === id);
    if (!set) return;
    const version = set.versions[0];
    setSetId(id);
    setSetName(set.name);
    setSetDescription(set.description ?? "");
    setSetVersion(version?.label ?? "");
    setSetItems(
      JSON.stringify(
        version?.items?.map((item) => ({
          kind: item.kind,
          displayName: item.displayName,
          exactHash: item.exactHash,
          normalizedContentHash: item.normalizedContentHash,
          nameHash: item.nameHash,
          structureHash: item.structureHash,
        })) ?? [],
        null,
        2,
      ),
    );
  }

  async function uploadBanner(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const result = await api.uploadBanner(file);
      setBanner(result.banner);
      setSite((previous) => (previous ? { ...previous, banner: result.banner } : previous));
      onNotice("Banner 已上传。");
    } catch (value) {
      onError(`Banner 上传失败：${String(value)}`);
    }
  }

  async function saveSite(): Promise<void> {
    try {
      const updated = await api.updateSite({ banner, siteContent: parseJson(siteText) });
      setSite(updated);
      onNotice("站点设置已保存。");
    } catch (value) {
      onError(`站点设置保存失败：${String(value)}`);
    }
  }

  function requestRoleChange(member: AdminMember, role: Role): void {
    if (role === member.role) return;
    setMemberError(null);
    setPendingRole({ member, role });
  }

  async function confirmRoleChange(): Promise<void> {
    if (!pendingRole || roleBusyRef.current) return;
    const { member, role } = pendingRole;
    roleBusyRef.current = true;
    setRoleBusy(true);
    try {
      await api.adminSetRole(member.id, role);
      setMembers((previous) => previous.map((item) => (item.id === member.id ? { ...item, role } : item)));
      setMemberError(null);
      setPendingRole(null);
      onNotice(`已将 ${member.globalName || member.username} 的角色改为${ROLE_LABELS[role]}。`);
    } catch (value) {
      setMemberError(roleErrorMessage(value));
      setPendingRole(null);
    } finally {
      roleBusyRef.current = false;
      setRoleBusy(false);
    }
  }

  async function searchRecommendationProjects(): Promise<void> {
    const generation = ++recSearchGeneration.current;
    setRecSearching(true);
    setRecSearched(true);
    try {
      const result = await api.adminProjects(recSearch.trim() || undefined);
      if (generation !== recSearchGeneration.current) return;
      setRecResults(result.items.slice(0, 12));
    } catch (value) {
      if (generation !== recSearchGeneration.current) return;
      onError(`项目搜索失败：${String(value)}`);
    } finally {
      if (generation === recSearchGeneration.current) setRecSearching(false);
    }
  }

  function pickProject(project: AdminProject): void {
    const existing = recommendations.find((item) => item.project.id === project.id);
    recSearchGeneration.current += 1;
    setRecSearching(false);
    setSelectedProject(project);
    setEditingId(null);
    setComment(existing?.comment ?? "");
    setReaction(existing?.reaction ?? "");
  }

  function editRecommendation(item: Recommendation): void {
    recSearchGeneration.current += 1;
    setRecSearching(false);
    setSelectedProject(null);
    setEditingId(item.project.id);
    setComment(item.comment);
    setReaction(item.reaction);
  }

  function clearRecommendationForm(): void {
    recSearchGeneration.current += 1;
    setRecSearching(false);
    setSelectedProject(null);
    setEditingId(null);
    setComment("");
    setReaction("");
  }

  async function saveRecommendation(): Promise<void> {
    const projectId = editingId ?? selectedProject?.id;
    if (!projectId || recBusyRef.current) return;
    recBusyRef.current = true;
    setRecBusy(true);
    try {
      await api.updateRecommendation(projectId, { comment, reaction });
      const list = await api.recommendations();
      setRecommendations(list.items);
      clearRecommendationForm();
      setRecSearch("");
      setRecResults([]);
      setRecSearched(false);
      onNotice("编辑精选已保存。");
    } catch (value) {
      onError(`精选保存失败：${String(value)}`);
    } finally {
      recBusyRef.current = false;
      setRecBusy(false);
    }
  }

  async function confirmRemoveRecommendation(): Promise<void> {
    if (!removeTarget || recBusyRef.current) return;
    recBusyRef.current = true;
    setRecBusy(true);
    try {
      await api.deleteRecommendation(removeTarget.project.id);
      const list = await api.recommendations();
      setRecommendations(list.items);
      setRemoveTarget(null);
      onNotice("编辑精选已移除。");
    } catch (value) {
      onError(`精选移除失败：${String(value)}`);
    } finally {
      recBusyRef.current = false;
      setRecBusy(false);
    }
  }

  async function saveSet(): Promise<void> {
    if (!setId) return;
    try {
      const parsedItems: unknown = parseJson(setItems);
      if (!Array.isArray(parsedItems)) throw new Error("items 必须是 JSON 数组");
      await api.updateReferenceSet(setId, {
        name: setName,
        description: setDescription || null,
        versionLabel: setVersion,
        items: parsedItems,
      });
      onNotice("基线已保存。");
      await refresh();
    } catch (value) {
      onError(`基线保存失败：${String(value)}`);
    }
  }

  async function createSet(): Promise<void> {
    if (!newSetName.trim() || !newSetVersion.trim()) return;
    try {
      await api.createReferenceSet({ name: newSetName.trim(), versionLabel: newSetVersion.trim() });
      setNewSetName("");
      onNotice("基线已创建。");
      await refresh();
    } catch (value) {
      onError(`基线创建失败：${String(value)}`);
    }
  }

  async function createVersion(): Promise<void> {
    if (!setId || !setVersion.trim()) return;
    try {
      await api.createReferenceVersion(setId, { versionLabel: setVersion.trim() });
      onNotice("新基线版本已创建。");
      await refresh();
    } catch (value) {
      onError(`版本创建失败：${String(value)}`);
    }
  }

  const visibleMembers =
    memberRoleFilter === "all" ? members : members.filter((member) => member.role === memberRoleFilter);

  return (
    <div className="workspace admin-tools">
      <section className="panel">
        <div className="panel-heading">
          <h2>站点设置</h2>
          <button type="button" disabled={busy} onClick={() => void refresh()}>
            刷新
          </button>
        </div>
        {site ? <p className="hint">Banner 与站点文案写入 `site_settings`，保存即生效。</p> : null}
        <h3>Banner</h3>
        <label className="file-button">
          上传 Banner
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => void uploadBanner(event.target.files?.[0])}
          />
        </label>
        <div className="form-grid">
          <label>
            图片地址
            <input
              value={banner.imageUrl ?? ""}
              onChange={(event) => setBanner({ ...banner, imageUrl: event.target.value || null })}
            />
          </label>
          <label>
            缩放
            <input
              type="number"
              min="1"
              max="3"
              step="0.1"
              value={banner.zoom}
              onChange={(event) => setBanner({ ...banner, zoom: Number(event.target.value) })}
            />
          </label>
          <label>
            桌面 X
            <input
              type="number"
              min="0"
              max="100"
              value={banner.positionX}
              onChange={(event) => setBanner({ ...banner, positionX: Number(event.target.value) })}
            />
          </label>
          <label>
            桌面 Y
            <input
              type="number"
              min="0"
              max="100"
              value={banner.positionY}
              onChange={(event) => setBanner({ ...banner, positionY: Number(event.target.value) })}
            />
          </label>
          <label>
            手机 X
            <input
              type="number"
              min="0"
              max="100"
              value={banner.mobilePositionX}
              onChange={(event) => setBanner({ ...banner, mobilePositionX: Number(event.target.value) })}
            />
          </label>
          <label>
            手机 Y
            <input
              type="number"
              min="0"
              max="100"
              value={banner.mobilePositionY}
              onChange={(event) => setBanner({ ...banner, mobilePositionY: Number(event.target.value) })}
            />
          </label>
          <label>
            手机缩放
            <input
              type="number"
              min="1"
              max="3"
              step="0.1"
              value={banner.mobileZoom}
              onChange={(event) => setBanner({ ...banner, mobileZoom: Number(event.target.value) })}
            />
          </label>
        </div>
        <label>
          站点内容 JSON
          <textarea value={siteText} onChange={(event) => setSiteText(event.target.value)} rows={8} />
        </label>
        <button type="button" className="primary" onClick={() => void saveSite()}>
          保存站点设置
        </button>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>项目</h2>
          <span className="hint">{projects.length} 个</span>
        </div>
        <label>
          搜索
          <input
            value={projectSearch}
            onChange={(event) => setProjectSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void refresh();
            }}
          />
        </label>
        <div className="project-list">
          {projects.map((project) => (
            <div className="member-row" key={project.id}>
              <span>
                <strong>{project.title}</strong>
                <small>
                  {project.author.name} · {project.visibility === "public" ? "公开" : "私有"} ·{" "}
                  {project.publishedRevisionId ? "已发布" : "未发布"}
                </small>
              </span>
              <span className="status">{project.deletedAt ? "已删除" : (project.projectType ?? "未分类")}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>成员</h2>
          <span className="hint">{visibleMembers.length} 人</span>
        </div>
        <label>
          角色筛选
          <select
            value={memberRoleFilter}
            onChange={(event) => setMemberRoleFilter(event.target.value as "all" | Role)}
          >
            <option value="all">全部角色</option>
            <option value="member">成员</option>
            <option value="reviewer">审核员</option>
            <option value="owner">站长</option>
          </select>
        </label>
        {memberError ? (
          <p className="panel-error" role="alert">
            {memberError}
          </p>
        ) : null}
        <div className="project-list">
          {visibleMembers.length === 0 ? (
            <p className="hint">没有符合筛选条件的成员。</p>
          ) : (
            visibleMembers.map((member) => (
              <div className="member-row" key={member.id}>
                <span>
                  <strong>{member.globalName || member.username}</strong>
                  <small>
                    {ROLE_LABELS[member.role as Role] ?? member.role} · {member.id}
                  </small>
                </span>
                <select value={member.role} onChange={(event) => requestRoleChange(member, event.target.value as Role)}>
                  <option value="member">成员</option>
                  <option value="reviewer">审核员</option>
                  <option value="owner">站长</option>
                </select>
              </div>
            ))
          )}
        </div>
        {memberCursor ? (
          <button
            type="button"
            className="load-more"
            disabled={memberLoadingMore}
            onClick={() => void loadMoreMembers()}
          >
            {memberLoadingMore ? "加载中…" : "加载更多成员"}
          </button>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>编辑精选</h2>
          <span className="hint">{recommendations.length} 个</span>
        </div>
        <div className="recommendation-list">
          {recommendations.length === 0 ? (
            <p className="hint">暂无编辑精选。</p>
          ) : (
            recommendations.map((item) => (
              <div className="recommendation-row" key={item.id}>
                <div className="recommendation-main">
                  <strong>{item.project.title}</strong>
                  <small>
                    {item.project.author.name}
                    {item.reaction ? ` · 反应 ${item.reaction}` : ""}
                  </small>
                  {item.comment ? <p>{item.comment}</p> : null}
                </div>
                <div className="recommendation-actions">
                  <button type="button" onClick={() => editRecommendation(item)}>
                    编辑
                  </button>
                  <button type="button" className="danger" onClick={() => setRemoveTarget(item)}>
                    移除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <h3>{editingId ? "编辑精选" : "添加精选"}</h3>
        {editingId || selectedProject ? (
          <p className="hint">
            已选项目：
            <strong>
              {editingId
                ? recommendations.find((item) => item.project.id === editingId)?.project.title
                : selectedProject?.title}
            </strong>
            <button type="button" className="link-button" onClick={clearRecommendationForm}>
              重新选择
            </button>
          </p>
        ) : (
          <>
            <label>
              搜索项目
              <input
                value={recSearch}
                placeholder="输入项目标题或作者"
                onChange={(event) => setRecSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void searchRecommendationProjects();
                  }
                }}
              />
            </label>
            <button type="button" disabled={recSearching} onClick={() => void searchRecommendationProjects()}>
              {recSearching ? "搜索中…" : "搜索项目"}
            </button>
            {recResults.length > 0 ? (
              <div className="project-list">
                {recResults.map((project) => (
                  <button type="button" className="project-row" key={project.id} onClick={() => pickProject(project)}>
                    <span>
                      <strong>{project.title}</strong>
                      <small>
                        {project.author.name} · {project.visibility === "public" ? "公开" : "私有"}
                      </small>
                    </span>
                    <span className="status">
                      {recommendations.some((item) => item.project.id === project.id) ? "已精选" : "未精选"}
                    </span>
                  </button>
                ))}
              </div>
            ) : recSearched ? (
              <p className="hint">没有匹配的项目。</p>
            ) : null}
          </>
        )}
        {editingId || selectedProject ? (
          <div className="form-grid">
            <label>
              评语
              <input value={comment} onChange={(event) => setComment(event.target.value)} />
            </label>
            <label>
              反应
              <input value={reaction} onChange={(event) => setReaction(event.target.value)} />
            </label>
          </div>
        ) : null}
        {editingId || selectedProject ? (
          <div className="button-row">
            <button type="button" className="primary" disabled={recBusy} onClick={() => void saveRecommendation()}>
              {recBusy ? "保存中…" : "保存精选"}
            </button>
            <button type="button" disabled={recBusy} onClick={clearRecommendationForm}>
              取消
            </button>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>角色基线</h2>
          <button type="button" disabled={busy} onClick={() => void refresh()}>
            刷新
          </button>
        </div>
        <div className="form-grid">
          <label>
            新参考集名称
            <input value={newSetName} onChange={(event) => setNewSetName(event.target.value)} />
          </label>
          <label>
            初始版本
            <input value={newSetVersion} onChange={(event) => setNewSetVersion(event.target.value)} />
          </label>
        </div>
        <button type="button" onClick={() => void createSet()}>
          创建参考集
        </button>
        <label>
          参考集
          <select value={setId} onChange={(event) => selectSet(event.target.value)}>
            <option value="">选择参考集</option>
            {sets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </select>
        </label>
        {setId ? (
          <>
            <div className="form-grid">
              <label>
                名称
                <input value={setName} onChange={(event) => setSetName(event.target.value)} />
              </label>
              <label>
                版本标签
                <input value={setVersion} onChange={(event) => setSetVersion(event.target.value)} />
              </label>
            </div>
            <label>
              说明
              <textarea value={setDescription} onChange={(event) => setSetDescription(event.target.value)} />
            </label>
            <label>
              items JSON
              <textarea value={setItems} onChange={(event) => setSetItems(event.target.value)} rows={10} />
            </label>
            <div className="button-row">
              <button type="button" className="primary" onClick={() => void saveSet()}>
                保存基线
              </button>
              <button type="button" onClick={() => void createVersion()}>
                用当前版本号新建版本
              </button>
            </div>
          </>
        ) : (
          <p className="hint">选择参考集后编辑名称、版本和 items；items 全量替换。</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>审计日志</h2>
          <button type="button" disabled={auditBusy} onClick={() => void loadAudit(auditAction)}>
            刷新
          </button>
        </div>
        <label>
          操作类型
          <select value={auditAction} onChange={(event) => changeAuditAction(event.target.value)}>
            <option value="">全部操作</option>
            {AUDIT_ACTION_OPTIONS.map((action) => (
              <option key={action} value={action}>
                {AUDIT_ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </label>
        <div className="audit-list">
          {audit.length === 0 ? (
            <p className="hint">{auditBusy ? "加载中…" : "暂无审计事件。"}</p>
          ) : (
            audit.map((event) => {
              const reason = auditReason(event.detail);
              return (
                <article className="audit-event" key={event.id}>
                  <div className="audit-event-heading">
                    <strong title={event.action}>{AUDIT_ACTION_LABELS[event.action] ?? event.action}</strong>
                    <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                  </div>
                  <small>
                    {event.actorName ?? event.actorId ?? "系统"} · {event.targetType}
                    {event.targetId ? ` · ${event.targetId}` : ""}
                  </small>
                  {reason ? <p className="audit-reason">原因：{reason}</p> : null}
                  <details>
                    <summary>原始数据</summary>
                    <pre>{JSON.stringify(event.detail, null, 2)}</pre>
                  </details>
                </article>
              );
            })
          )}
        </div>
        {auditCursor ? (
          <button
            type="button"
            className="load-more"
            disabled={auditLoadingMore}
            onClick={() => void loadAudit(auditAction, auditCursor)}
          >
            {auditLoadingMore ? "加载中…" : "加载更多审计"}
          </button>
        ) : null}
      </section>

      <ConfirmDialog
        open={pendingRole !== null}
        title="确认修改成员角色"
        description={
          pendingRole
            ? `将把 ${pendingRole.member.globalName || pendingRole.member.username} 的角色从「${
                ROLE_LABELS[pendingRole.member.role as Role] ?? pendingRole.member.role
              }」改为「${ROLE_LABELS[pendingRole.role]}」。该成员的所有会话将被撤销，需要重新登录。`
            : undefined
        }
        confirmLabel="确认修改"
        busy={roleBusy}
        onConfirm={() => void confirmRoleChange()}
        onCancel={() => setPendingRole(null)}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title="移除编辑精选"
        description={
          removeTarget ? `将把《${removeTarget.project.title}》从编辑精选中移除，站点首页不再展示这条推荐。` : undefined
        }
        confirmLabel="移除"
        danger
        busy={recBusy}
        onConfirm={() => void confirmRemoveRecommendation()}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}

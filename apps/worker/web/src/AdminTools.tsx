import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AdminAudit } from "./AdminAudit";
import { AdminConfirmations } from "./AdminConfirmations";
import { AdminMembers } from "./AdminMembers";
import { AdminProjects } from "./AdminProjects";
import { AdminRecommendations } from "./AdminRecommendations";
import { AdminReferences } from "./AdminReferences";
import { AdminSite } from "./AdminSite";
import { ConfirmDialog } from "./components/ui/confirm-dialog";
import { useAdminAudit } from "./useAdminAudit";
import { useAdminData } from "./useAdminData";
import { useAdminMembers } from "./useAdminMembers";
import { useAdminRecommendations } from "./useAdminRecommendations";
import "./styles/management-sections.css";

const MANAGEMENT_SECTIONS = [
  { id: "site", title: "站点设置", description: "管理 Banner 和站点文案，保存后立即生效。" },
  { id: "projects", title: "项目索引", description: "搜索项目，查看发布状态、可见性与作者。" },
  { id: "members", title: "成员权限", description: "按角色查看成员，确认后调整权限。" },
  { id: "recommendations", title: "编辑精选", description: "搜索、添加、编辑和移除首页精选。" },
  { id: "references", title: "角色基线", description: "维护参考集、基线内容和版本。" },
  { id: "audit", title: "审计日志", description: "按操作筛选日志，逐页查看详细记录。" },
] as const;

type ManagementSection = (typeof MANAGEMENT_SECTIONS)[number]["id"];

export function AdminTools({
  onError,
  onNotice,
}: {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  // Hooks stay mounted so returning to the index retains drafts, filters and loaded pages.
  const [section, setSection] = useState<ManagementSection | null>(null);
  const sectionTitle = MANAGEMENT_SECTIONS.find((item) => item.id === section)?.title;
  const indexButtons = useRef<Partial<Record<ManagementSection, HTMLButtonElement | null>>>({});
  const taskHeading = useRef<HTMLHeadingElement>(null);
  const [pendingWrite, setPendingWrite] = useState<{
    title: string;
    description: string;
    run: () => Promise<void>;
  } | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const writeBusyRef = useRef(false);

  async function confirmWrite(): Promise<void> {
    if (!pendingWrite || writeBusyRef.current) return;
    writeBusyRef.current = true;
    setWriteBusy(true);
    try {
      await pendingWrite.run();
      setPendingWrite(null);
    } finally {
      writeBusyRef.current = false;
      setWriteBusy(false);
    }
  }

  useEffect(() => {
    if (section) taskHeading.current?.focus();
  }, [section]);

  function returnToIndex(): void {
    const previous = section;
    setSection(null);
    requestAnimationFrame(() => {
      if (previous) indexButtons.current[previous]?.focus();
    });
  }
  const members = useAdminMembers({ onError, onNotice });
  const recommendationsState = useAdminRecommendations({ onError, onNotice });
  const data = useAdminData({ ...members, ...recommendationsState, onError, onNotice });
  const auditState = useAdminAudit({ onError });
  const {
    visibleMembers,
    memberRoleFilter,
    setMemberRoleFilter,
    memberError,
    requestRoleChange,
    memberCursor,
    memberLoadingMore,
    loadMoreMembers,
    pendingRole,
    roleBusy,
    confirmRoleChange,
    setPendingRole,
  } = members;
  const {
    recommendations,
    reaction,
    comment,
    editRecommendation,
    setRemoveTarget,
    editingId,
    selectedProject,
    clearRecommendationForm,
    recSearch,
    setRecSearch,
    searchRecommendationProjects,
    recSearching,
    recResults,
    pickProject,
    recSearched,
    setComment,
    setReaction,
    recBusy,
    saveRecommendation,
    removeTarget,
    confirmRemoveRecommendation,
  } = recommendationsState;
  const {
    busy,
    refresh,
    site,
    uploadBanner,
    banner,
    setBanner,
    siteText,
    setSiteText,
    saveSite,
    projects,
    projectSearch,
    setProjectSearch,
    newSetName,
    setNewSetName,
    newSetVersion,
    setNewSetVersion,
    createSet,
    setId,
    selectSet,
    sets,
    setName,
    setSetName,
    setVersion,
    setSetVersion,
    setDescription,
    setSetDescription,
    setItems,
    setSetItems,
    saveSet,
    createVersion,
  } = data;
  const { auditBusy, loadAudit, auditAction, changeAuditAction, audit, auditCursor, auditLoadingMore } = auditState;
  const loadInitial = useEffectEvent(() => {
    void refresh();
    void loadAudit("");
  });
  useEffect(() => {
    loadInitial();
  }, []);
  return (
    <div className="admin-tools management-sections">
      {section === null ? (
        <section className="management-index" aria-labelledby="management-index-title">
          <h2 id="management-index-title">管理工具</h2>
          <p className="hint">选择一项任务。返回工具索引会保留当前输入、筛选和已加载的记录。</p>
          <nav className="management-index-links" aria-label="管理任务">
            {MANAGEMENT_SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                ref={(node) => {
                  indexButtons.current[item.id] = node;
                }}
                onClick={() => setSection(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{item.description}</span>
                <span aria-hidden="true">进入 →</span>
              </button>
            ))}
          </nav>
        </section>
      ) : (
        <header className="management-task-heading">
          <button type="button" onClick={returnToIndex}>
            ← 工具索引
          </button>
          <h2 tabIndex={-1} ref={taskHeading}>
            {sectionTitle}
          </h2>
          <span className="hint">输入与筛选在返回后保留</span>
        </header>
      )}
      {busy ? <p role="status">正在加载管理数据…</p> : null}
      {data.loadError ? (
        <div className="panel-error" role="alert">
          {data.loadError}{" "}
          <button type="button" disabled={busy} onClick={() => void refresh()}>
            重新加载
          </button>
        </div>
      ) : null}
      {section === "site" && !busy && !data.loadError ? (
        <AdminSite
          busy={busy}
          refresh={refresh}
          site={site}
          uploadBanner={async (file) => {
            if (file)
              setPendingWrite({
                title: "上传站点 Banner",
                description: "上传将替换站点 Banner，立即对访问者生效。",
                run: () => uploadBanner(file),
              });
          }}
          banner={banner}
          setBanner={setBanner}
          siteText={siteText}
          setSiteText={setSiteText}
          saveSite={async () => {
            setPendingWrite({
              title: "保存站点设置",
              description: "Banner 与站点文案将立即生效。请确认输入内容。",
              run: saveSite,
            });
          }}
        />
      ) : null}
      {section === "projects" && !busy && !data.loadError ? (
        <AdminProjects
          projects={projects}
          projectSearch={projectSearch}
          setProjectSearch={setProjectSearch}
          searchProjects={data.searchProjects}
          projectBusy={data.projectBusy}
          projectError={data.projectError}
        />
      ) : null}
      {section === "members" && !busy && !data.loadError ? (
        <AdminMembers
          visibleMembers={visibleMembers}
          memberRoleFilter={memberRoleFilter}
          setMemberRoleFilter={setMemberRoleFilter}
          memberError={memberError}
          requestRoleChange={requestRoleChange}
          memberCursor={memberCursor}
          memberLoadingMore={memberLoadingMore}
          loadMoreMembers={loadMoreMembers}
        />
      ) : null}
      {section === "recommendations" && !busy && !data.loadError ? (
        <AdminRecommendations
          recommendations={recommendations}
          reaction={reaction}
          comment={comment}
          editRecommendation={editRecommendation}
          setRemoveTarget={setRemoveTarget}
          editingId={editingId}
          selectedProject={selectedProject}
          clearRecommendationForm={clearRecommendationForm}
          recSearch={recSearch}
          setRecSearch={setRecSearch}
          searchRecommendationProjects={searchRecommendationProjects}
          recSearching={recSearching}
          recSearchError={recommendationsState.recSearchError}
          recResults={recResults}
          pickProject={pickProject}
          recSearched={recSearched}
          setComment={setComment}
          setReaction={setReaction}
          recBusy={recBusy}
          saveRecommendation={async () => {
            setPendingWrite({
              title: "保存编辑精选",
              description: "保存后首页精选会采用当前项目、评语和反应。",
              run: saveRecommendation,
            });
          }}
        />
      ) : null}
      {section === "references" && !busy && !data.loadError ? (
        <AdminReferences
          busy={busy}
          refresh={refresh}
          newSetName={newSetName}
          setNewSetName={setNewSetName}
          newSetVersion={newSetVersion}
          setNewSetVersion={setNewSetVersion}
          createSet={async () => {
            setPendingWrite({
              title: "创建参考集",
              description: `创建「${newSetName.trim()}」及初始版本「${newSetVersion.trim()}」。`,
              run: createSet,
            });
          }}
          setId={setId}
          selectSet={selectSet}
          sets={sets}
          setName={setName}
          setSetName={setSetName}
          setVersion={setVersion}
          setSetVersion={setSetVersion}
          setDescription={setDescription}
          setSetDescription={setSetDescription}
          setItems={setItems}
          setSetItems={setSetItems}
          saveSet={async () => {
            setPendingWrite({
              title: "保存角色基线",
              description: "将保存名称与版本信息，并全量替换当前版本的 items。",
              run: saveSet,
            });
          }}
          createVersion={async () => {
            setPendingWrite({
              title: "新建基线版本",
              description: `将为当前参考集创建版本「${setVersion.trim()}」。`,
              run: createVersion,
            });
          }}
        />
      ) : null}
      {section === "audit" ? (
        <AdminAudit
          auditBusy={auditBusy}
          loadAudit={loadAudit}
          auditAction={auditAction}
          changeAuditAction={changeAuditAction}
          audit={audit}
          auditCursor={auditCursor}
          auditLoadingMore={auditLoadingMore}
          auditError={auditState.auditError}
        />
      ) : null}
      <ConfirmDialog
        open={pendingWrite !== null}
        title={pendingWrite?.title ?? "确认管理操作"}
        description={pendingWrite?.description}
        confirmLabel="确认执行"
        busy={writeBusy}
        onConfirm={() => void confirmWrite()}
        onCancel={() => setPendingWrite(null)}
      />
      <AdminConfirmations
        pendingRole={pendingRole}
        roleBusy={roleBusy}
        confirmRoleChange={confirmRoleChange}
        setPendingRole={setPendingRole}
        removeTarget={removeTarget}
        recBusy={recBusy}
        confirmRemoveRecommendation={confirmRemoveRecommendation}
        setRemoveTarget={setRemoveTarget}
      />
    </div>
  );
}

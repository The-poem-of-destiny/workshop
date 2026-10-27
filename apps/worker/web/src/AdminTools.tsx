import { useEffect, useEffectEvent } from "react";
import { AdminAudit } from "./AdminAudit";
import { AdminConfirmations } from "./AdminConfirmations";
import { AdminMembers } from "./AdminMembers";
import { AdminProjects } from "./AdminProjects";
import { AdminRecommendations } from "./AdminRecommendations";
import { AdminReferences } from "./AdminReferences";
import { AdminSite } from "./AdminSite";
import { useAdminAudit } from "./useAdminAudit";
import { useAdminData } from "./useAdminData";
import { useAdminMembers } from "./useAdminMembers";
import { useAdminRecommendations } from "./useAdminRecommendations";
export function AdminTools({
  onError,
  onNotice,
}: {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
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
    <div className="workspace admin-tools">
      <AdminSite
        busy={busy}
        refresh={refresh}
        site={site}
        uploadBanner={uploadBanner}
        banner={banner}
        setBanner={setBanner}
        siteText={siteText}
        setSiteText={setSiteText}
        saveSite={saveSite}
      />
      <AdminProjects
        projects={projects}
        projectSearch={projectSearch}
        setProjectSearch={setProjectSearch}
        refresh={refresh}
      />
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
        recResults={recResults}
        pickProject={pickProject}
        recSearched={recSearched}
        setComment={setComment}
        setReaction={setReaction}
        recBusy={recBusy}
        saveRecommendation={saveRecommendation}
      />
      <AdminReferences
        busy={busy}
        refresh={refresh}
        newSetName={newSetName}
        setNewSetName={setNewSetName}
        newSetVersion={newSetVersion}
        setNewSetVersion={setNewSetVersion}
        createSet={createSet}
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
        saveSet={saveSet}
        createVersion={createVersion}
      />
      <AdminAudit
        auditBusy={auditBusy}
        loadAudit={loadAudit}
        auditAction={auditAction}
        changeAuditAction={changeAuditAction}
        audit={audit}
        auditCursor={auditCursor}
        auditLoadingMore={auditLoadingMore}
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

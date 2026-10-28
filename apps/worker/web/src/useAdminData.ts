import { useState } from "react";
import { type AdminProject, api, type JsonValue, type SiteBanner, type SiteSettings } from "./api";
import type { useAdminMembers } from "./useAdminMembers";
import type { useAdminRecommendations } from "./useAdminRecommendations";
import { useAdminReferences } from "./useAdminReferences";

const EMPTY_BANNER: SiteBanner = {
  imageUrl: null,
  positionX: 50,
  positionY: 50,
  zoom: 1,
  mobilePositionX: 50,
  mobilePositionY: 50,
  mobileZoom: 1,
};

function parseJson(text: string): JsonValue {
  return JSON.parse(text) as JsonValue;
}

type AdminDataOptions = Pick<
  ReturnType<typeof useAdminMembers> & ReturnType<typeof useAdminRecommendations>,
  "setMembers" | "setMemberCursor" | "setMemberError" | "setRecommendations"
> & { onError: (message: string) => void; onNotice: (message: string) => void };
export function useAdminData({
  setMembers,
  setMemberCursor,
  setMemberError,
  setRecommendations,
  onError,
  onNotice,
}: AdminDataOptions) {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [site, setSite] = useState<SiteSettings | null>(null);
  const [banner, setBanner] = useState<SiteBanner>(EMPTY_BANNER);
  const [siteText, setSiteText] = useState("{}");
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const references = useAdminReferences({ refresh, onError, onNotice });
  const {
    setSets,
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
  } = references;
  async function refresh(): Promise<void> {
    setBusy(true);
    setLoadError(null);
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
      setLoadError(`管理数据加载失败：${String(value)}`);
      onError(String(value));
    } finally {
      setBusy(false);
    }
  }

  async function searchProjects(): Promise<void> {
    if (projectBusy) return;
    setProjectBusy(true);
    setProjectError(null);
    try {
      const result = await api.adminProjects(projectSearch.trim() || undefined);
      setProjects(result.items);
    } catch (value) {
      setProjectError(`项目搜索失败：${String(value)}`);
    } finally {
      setProjectBusy(false);
    }
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
  return {
    busy,
    loadError,
    projectBusy,
    projectError,
    searchProjects,
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
  };
}

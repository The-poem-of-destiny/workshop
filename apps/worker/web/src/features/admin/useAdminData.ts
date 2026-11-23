import { parseDiscordInviteUrl, WORKSHOP_LIMITS } from "@workshop/domain";
import { useRef, useState } from "react";
import {
  type AdminProject,
  api,
  formatUserError,
  getSessionGeneration,
  type JsonValue,
  type SiteBanner,
  type SiteSettings,
} from "../../api";
import { parseSiteContent } from "../../lib/siteContent";
import type { useAdminMembers } from "./useAdminMembers";
import type { useAdminRecommendations } from "./useAdminRecommendations";

const EMPTY_BANNER: SiteBanner = {
  imageUrl: null,
  positionX: 50,
  positionY: 50,
  zoom: 1,
  mobilePositionX: 50,
  mobilePositionY: 50,
  mobileZoom: 1,
};

function parseExtraObject(text: string): Record<string, JsonValue> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as JsonValue;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("高级扩展内容必须是 JSON 对象");
  }
  return parsed as Record<string, JsonValue>;
}

function buildSitePayload(
  siteText: string,
  communityInviteInput: string,
  announcementInput: string,
): { ok: true; siteContent: Record<string, JsonValue> } | { ok: false; message: string } {
  const extra = parseExtraObject(siteText);
  const checkedInvite = parseDiscordInviteUrl(communityInviteInput);
  if (!checkedInvite.ok) {
    return { ok: false, message: "社区邀请链接格式无效，请输入 https://discord.gg/... 格式的邀请链接。" };
  }
  const siteContent: Record<string, JsonValue> = { ...extra };
  if (checkedInvite.value) siteContent.communityInviteUrl = checkedInvite.value;
  else delete siteContent.communityInviteUrl;
  const announcement = announcementInput.trim();
  if (announcement) siteContent.announcement = announcement;
  else delete siteContent.announcement;
  return { ok: true, siteContent };
}

function useAdminSiteState({
  onError,
  onNotice,
}: {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [site, setSite] = useState<SiteSettings | null>(null);
  const [banner, setBanner] = useState<SiteBanner>(EMPTY_BANNER);
  const [communityInviteInput, setCommunityInviteInput] = useState("");
  const [announcementInput, setAnnouncementInput] = useState("");
  const [siteText, setSiteText] = useState("{}");

  function hydrateSite(siteValue: SiteSettings): void {
    setSite(siteValue);
    setBanner(siteValue.banner ?? EMPTY_BANNER);
    const parsed = parseSiteContent(siteValue);
    setCommunityInviteInput(parsed.customInviteUrl);
    setAnnouncementInput(parsed.announcement);
    setSiteText(JSON.stringify(parsed.extra, null, 2));
  }

  async function uploadBanner(file: File | undefined): Promise<void> {
    if (!file) return;
    if (file.size > WORKSHOP_LIMITS.bannerUploadBytes) {
      onError("Banner 不能超过 2 MiB。");
      return;
    }
    try {
      const result = await api.uploadBanner(file);
      setBanner(result.banner);
      setSite((previous) => (previous ? { ...previous, banner: result.banner } : previous));
      onNotice("Banner 已上传。");
    } catch (value) {
      onError(`Banner 上传失败：${formatUserError(value)}`);
    }
  }

  async function saveSite(): Promise<void> {
    try {
      const built = buildSitePayload(siteText, communityInviteInput, announcementInput);
      if (!built.ok) {
        onError(built.message);
        return;
      }
      const updated = await api.updateSite({ banner, siteContent: built.siteContent });
      hydrateSite(updated);
      onNotice("站点设置已保存。");
    } catch (value) {
      onError(`站点设置保存失败：${formatUserError(value)}`);
    }
  }

  return {
    site,
    banner,
    setBanner,
    communityInviteInput,
    setCommunityInviteInput,
    announcementInput,
    setAnnouncementInput,
    siteText,
    setSiteText,
    hydrateSite,
    uploadBanner,
    saveSite,
  };
}

type AdminDataOptions = Pick<
  ReturnType<typeof useAdminMembers> & ReturnType<typeof useAdminRecommendations>,
  "setMembers" | "setMemberCursor" | "setMemberError" | "resetMemberLoads" | "setRecommendations"
> & { onError: (message: string) => void; onNotice: (message: string) => void };

export function useAdminData({
  setMembers,
  setMemberCursor,
  setMemberError,
  resetMemberLoads,
  setRecommendations,
  onError,
  onNotice,
}: AdminDataOptions) {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const refreshGeneration = useRef(0);
  const projectSearchGeneration = useRef(0);
  const siteState = useAdminSiteState({ onError, onNotice });

  async function refresh(): Promise<void> {
    const generation = ++refreshGeneration.current;
    const searchGen = ++projectSearchGeneration.current;
    const sessionGeneration = getSessionGeneration();
    resetMemberLoads();
    setProjectBusy(false);
    setBusy(true);
    setLoadError(null);
    try {
      const [projectList, memberList, siteValue, recommendationList] = await Promise.all([
        api.adminProjects(projectSearch || undefined),
        api.adminMembers(),
        api.site(),
        api.recommendations(),
      ]);
      if (generation !== refreshGeneration.current || sessionGeneration !== getSessionGeneration()) return;
      if (searchGen === projectSearchGeneration.current) {
        setProjects(projectList.items);
        setProjectError(null);
      }
      resetMemberLoads();
      setMembers(memberList.items);
      setMemberCursor(memberList.nextCursor);
      setMemberError(null);
      siteState.hydrateSite(siteValue);
      setRecommendations(recommendationList.items);
    } catch (value) {
      if (generation !== refreshGeneration.current || sessionGeneration !== getSessionGeneration()) return;
      const msg = formatUserError(value);
      setLoadError(`管理数据加载失败：${msg}`);
      onError(msg);
    } finally {
      if (generation === refreshGeneration.current && sessionGeneration === getSessionGeneration()) {
        setBusy(false);
      }
    }
  }

  async function searchProjects(): Promise<void> {
    const generation = ++projectSearchGeneration.current;
    const sessionGeneration = getSessionGeneration();
    setProjectBusy(true);
    setProjectError(null);
    try {
      const result = await api.adminProjects(projectSearch.trim() || undefined);
      if (generation !== projectSearchGeneration.current || sessionGeneration !== getSessionGeneration()) return;
      setProjects(result.items);
    } catch (value) {
      if (generation !== projectSearchGeneration.current || sessionGeneration !== getSessionGeneration()) return;
      setProjectError(`项目搜索失败：${formatUserError(value)}`);
    } finally {
      if (generation === projectSearchGeneration.current && sessionGeneration === getSessionGeneration()) {
        setProjectBusy(false);
      }
    }
  }

  async function toggleProjectVisibility(project: AdminProject): Promise<void> {
    const next = project.visibility === "public" ? "private" : "public";
    try {
      const result = await api.setVisibility(project.id, project.rowVersion, next);
      setProjects((prev) =>
        prev.map((item) =>
          item.id === project.id ? { ...item, visibility: next, rowVersion: result.rowVersion } : item,
        ),
      );
      onNotice(next === "private" ? `已将《${project.title}》设为私有（下架）。` : `已恢复公开《${project.title}》。`);
    } catch (value) {
      onError(`更新项目可见性失败：${formatUserError(value)}`);
    }
  }

  async function removeAdminProject(project: AdminProject): Promise<void> {
    try {
      await api.deleteProject(project.id, project.rowVersion);
      setProjects((prev) => prev.filter((item) => item.id !== project.id));
      onNotice(`已删除项目《${project.title}》。`);
    } catch (value) {
      onError(`删除项目失败：${formatUserError(value)}`);
    }
  }

  return {
    busy,
    loadError,
    projectBusy,
    projectError,
    searchProjects,
    toggleProjectVisibility,
    removeAdminProject,
    refresh,
    ...siteState,
    projects,
    projectSearch,
    setProjectSearch,
  };
}

import { useRef, useState } from "react";
import { type AdminProject, api, type Recommendation } from "./api";

type AdminRecommendationsOptions = { onError: (message: string) => void; onNotice: (message: string) => void };
export function useAdminRecommendations({ onError, onNotice }: AdminRecommendationsOptions) {
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
  /** Same guard for recommendation project searches, which can overlap with form resets. */
  const recSearchGeneration = useRef(0);
  const recBusyRef = useRef(false);
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
  return {
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
    setRecommendations,
  };
}

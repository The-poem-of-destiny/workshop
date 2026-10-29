import { useEffect, useRef, useState } from "react";
import { api, type ProjectSummary } from "./api";
import type { InstalledItem } from "./features/installed/Installed";

import type { HostContext } from "./useHostConnection";

type InstalledProjectsOptions = HostContext | null;
export function useInstalledProjects(context: InstalledProjectsOptions, enabled: boolean) {
  const [installedProjects, setInstalledProjects] = useState<Record<string, ProjectSummary | null | undefined>>({});
  const [installedFailed, setInstalledFailed] = useState<Record<string, true>>({});
  const [installedReload, setInstalledReload] = useState(0);
  const [installedLoading, setInstalledLoading] = useState(false);
  const checkRequested = useRef(false);
  const instances = context?.installationScan?.instances ?? [];
  const registryKey = JSON.stringify([...new Set(instances.map((instance) => instance.projectId))].sort());
  const installedRequest = useRef<{ active: boolean; generation: number } | null>(null);
  useEffect(() => {
    if (!context?.connected) {
      setInstalledProjects({});
      setInstalledFailed({});
      setInstalledLoading(false);
      return;
    }
    if (!enabled && !checkRequested.current) {
      setInstalledLoading(false);
      return;
    }
    const ids = JSON.parse(registryKey) as string[];
    if (ids.length === 0) {
      setInstalledProjects({});
      setInstalledFailed({});
      setInstalledLoading(false);
      return;
    }
    checkRequested.current = false;
    const request = { active: true, generation: installedReload };
    installedRequest.current = request;
    setInstalledLoading(true);
    setInstalledProjects({});
    setInstalledFailed({});
    const batches: string[][] = [];
    for (let index = 0; index < ids.length; index += 50) batches.push(ids.slice(index, index + 50));
    void Promise.all(
      batches.map(async (batch) => {
        try {
          const result = await api.projectsByIds(batch);
          if (!request.active || installedRequest.current !== request) return;
          setInstalledProjects((previous) => ({
            ...previous,
            ...Object.fromEntries(result.items.map((project) => [project.id, project])),
            ...Object.fromEntries(result.missingIds.map((id) => [id, null])),
          }));
        } catch {
          if (!request.active || installedRequest.current !== request) return;
          setInstalledFailed((previous) => ({
            ...previous,
            ...Object.fromEntries(batch.map((id) => [id, true as const])),
          }));
        }
      }),
    ).then(() => {
      if (!request.active || installedRequest.current !== request) return;
      setInstalledLoading(false);
    });
    return () => {
      request.active = false;
    };
  }, [context?.connected, enabled, registryKey, installedReload]);
  const installedItems: InstalledItem[] = instances.map((instance) => ({
    instance,
    project: installedProjects[instance.projectId],
    failed: Boolean(installedFailed[instance.projectId]),
  }));
  const installedPending = installedItems.some((item) => item.project === undefined && !item.failed);
  const installedUpdateCount =
    installedPending || Object.keys(installedFailed).length > 0
      ? null
      : installedItems.filter((item) =>
          Boolean(item.project?.publishedRevisionId && item.instance.version !== item.project.publishedRevisionId),
        ).length;
  function reloadInstalledProjects(): void {
    checkRequested.current = true;
    setInstalledReload((value) => value + 1);
  }
  return {
    registryKey,
    installedUpdateCount,
    installedItems,
    installedLoading,
    installedPending,
    reloadInstalledProjects,
  };
}

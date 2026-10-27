import { useEffect, useRef, useState } from "react";
import { ApiError, api, type ProjectSummary } from "./api";
import type { InstalledItem } from "./features/installed/Installed";

import type { HostContext } from "./useHostConnection";

type InstalledProjectsOptions = HostContext | null;
export function useInstalledProjects(context: InstalledProjectsOptions) {
  const [installedProjects, setInstalledProjects] = useState<Record<string, ProjectSummary | null | undefined>>({});
  const [installedFailed, setInstalledFailed] = useState<Record<string, true>>({});
  const [installedReload, setInstalledReload] = useState(0);
  const [installedLoading, setInstalledLoading] = useState(false);
  const registryKey = JSON.stringify(context?.registry ?? {});
  const installedRequest = useRef<{ active: boolean; generation: number } | null>(null);
  useEffect(() => {
    if (!context?.connected) {
      setInstalledProjects({});
      setInstalledFailed({});
      setInstalledLoading(false);
      return;
    }
    const ids = Object.keys(JSON.parse(registryKey) as HostContext["registry"]);
    if (ids.length === 0) {
      setInstalledProjects({});
      setInstalledFailed({});
      setInstalledLoading(false);
      return;
    }
    const request = { active: true, generation: installedReload };
    installedRequest.current = request;
    setInstalledLoading(true);
    void Promise.all(
      ids.map(async (id) => {
        try {
          return { id, project: await api.project(id), failed: false } as const;
        } catch (reason) {
          // A 404 means the project left the workshop; anything else is a transient lookup failure.
          if (reason instanceof ApiError && reason.status === 404) return { id, project: null, failed: false } as const;
          return { id, project: null, failed: true } as const;
        }
      }),
    ).then((entries) => {
      if (!request.active || installedRequest.current !== request) return;
      setInstalledProjects(Object.fromEntries(entries.map((entry) => [entry.id, entry.project] as const)));
      setInstalledFailed(
        Object.fromEntries(entries.filter((entry) => entry.failed).map((entry) => [entry.id, true] as const)),
      );
      setInstalledLoading(false);
    });
    return () => {
      request.active = false;
    };
  }, [context?.connected, registryKey, installedReload]);
  const installedItems: InstalledItem[] = Object.entries(context?.registry ?? {}).map(([id, record]) => ({
    id,
    record,
    project: installedProjects[id],
    failed: Boolean(installedFailed[id]),
  }));
  const installedPending = installedItems.some((item) => item.project === undefined && !item.failed);
  const installedUpdateCount = installedItems.filter(
    (item) =>
      !item.failed &&
      Boolean(item.project?.publishedRevisionId && item.record.version !== item.project.publishedRevisionId),
  ).length;
  function reloadInstalledProjects(): void {
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

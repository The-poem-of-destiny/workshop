import type { ProjectSummary } from "./api";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./components/ui/dialog";
import type { InstalledItem } from "./features/installed/Installed";

export function InstallInstanceChoice({
  instanceChoice,
  setInstanceChoice,
  installing,
  installBlock,
  prepareInstall,
  instanceOperation,
  installedItems,
}: {
  instanceChoice: { project: ProjectSummary; action: "update" | "uninstall" } | null;
  setInstanceChoice: (value: { project: ProjectSummary; action: "update" | "uninstall" } | null) => void;
  installing: boolean;
  installBlock: string | null;
  prepareInstall: (project: ProjectSummary, action?: "install" | "update", instanceId?: string) => Promise<void>;
  instanceOperation: (item: InstalledItem, action: "uninstall" | "migrate") => void;
  installedItems: InstalledItem[];
}) {
  return (
    <Dialog
      open={instanceChoice !== null}
      onOpenChange={(open) => {
        if (!open && !installing) setInstanceChoice(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>选择安装位置或实例</DialogTitle>
          <DialogDescription>每次操作只针对明确选择的实例，不会自动更新第一个位置。</DialogDescription>
        </DialogHeader>
        {installBlock ? <p role="status">{installBlock}</p> : null}
        {installedItems
          .filter((item) => item.instance.projectId === instanceChoice?.project.id)
          .map((item) => (
            <Button
              key={item.instance.instanceId}
              variant="secondary"
              disabled={installing || Boolean(installBlock)}
              onClick={() => {
                if (!instanceChoice) return;
                if (instanceChoice.action === "uninstall") instanceOperation(item, "uninstall");
                else void prepareInstall(instanceChoice.project, "update", item.instance.instanceId);
              }}
            >
              {instanceChoice?.action === "uninstall" ? "卸载" : "更新"}：
              {item.instance.location.worldbook ?? "无世界书"} / {item.instance.location.character ?? "无角色"} ·{" "}
              {item.instance.instanceId}
            </Button>
          ))}
        <Button variant="ghost" disabled={installing} onClick={() => setInstanceChoice(null)}>
          取消
        </Button>
      </DialogContent>
    </Dialog>
  );
}

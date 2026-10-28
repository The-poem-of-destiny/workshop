import type { InstallIntent, InstallPreview } from "../../../packages/contracts/src/install.js";
import { capture, discover } from "./install-discovery.js";
import { copy, type InstallHost, type Plan } from "./install-model.js";
import { preparePlan } from "./install-preview.js";
import { applyPlan } from "./installation.js";

export function createInstallManager(host: InstallHost) {
  const pending = new Map<string, Plan>();
  let busy = false;
  async function scan() {
    return discover(await capture(host)).scan;
  }
  async function preview(intent: InstallIntent): Promise<InstallPreview> {
    const plan = await preparePlan(host, intent);
    pending.set(plan.result.previewId, plan);
    return copy(plan.result);
  }
  function cancel(previewId: string) {
    return { cancelled: pending.delete(previewId) };
  }
  async function confirm(previewId: string) {
    if (busy) throw new Error("另一个安装操作正在执行");
    const plan = pending.get(previewId);
    if (!plan) throw new Error("预览不存在或已取消，请重新预览");
    pending.delete(previewId);
    busy = true;
    try {
      return await applyPlan(host, plan);
    } finally {
      busy = false;
    }
  }
  return { scan, preview, confirm, cancel };
}

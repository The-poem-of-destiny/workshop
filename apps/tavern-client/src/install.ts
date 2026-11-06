import type { InstallIntent, InstallPreview } from "../../../packages/contracts/src/install.js";
import { capture, discover } from "./install-discovery.js";
import { copy, type InstallHost, identity, type Plan, stable } from "./install-model.js";
import { preparePlan } from "./install-preview.js";
import { applyPlan } from "./installation.js";
import { entryIdentity, indexProject, readIndex, updateIndex, writeEntry } from "./workshop-yaml.js";

function confirmedScope(worldbooks: unknown): string[] {
  if (!Array.isArray(worldbooks) || !worldbooks.length || worldbooks.some((name) => typeof name !== "string" || !name))
    throw new Error("转换范围无效，请重新扫描并确认");
  const confirmed = [...worldbooks].sort();
  if (new Set(confirmed).size !== confirmed.length) throw new Error("转换范围无效，请重新扫描并确认");
  return confirmed;
}
function checkScope(host: InstallHost, confirmed: string[]) {
  if (stable([...host.names()].sort()) !== stable(confirmed)) throw new Error("世界书扫描范围已改变，请重新扫描并确认");
}

export function createInstallManager(host: InstallHost) {
  const pending = new Map<string, Plan>();
  let busy = false;
  let generation = 0;
  async function scan() {
    return discover(await capture(host)).scan;
  }
  async function preview(intent: InstallIntent): Promise<InstallPreview> {
    const current = generation;
    const plan = await preparePlan(host, intent);
    if (current !== generation) throw new Error("预览已取消，请重新预览");
    pending.set(plan.result.previewId, plan);
    return copy(plan.result);
  }
  function cancel(previewId: string) {
    return { cancelled: pending.delete(previewId) };
  }
  function cancelAll() {
    generation++;
    pending.clear();
  }
  async function convertLegacy(worldbooks: unknown) {
    if (busy) throw new Error("另一个安装操作正在执行");
    busy = true;
    cancelAll();
    let converted = 0,
      skipped = 0;
    try {
      const confirmed = confirmedScope(worldbooks);
      const snapshot = await capture(host);
      if (stable(snapshot.names) !== stable(confirmed)) throw new Error("世界书扫描范围已改变，请重新扫描并确认");
      checkScope(host, confirmed);
      const found = discover(snapshot);
      for (const [name, rows] of snapshot.books) {
        const groups = [...found.groups.values()].filter(
          (group) => group.instance.location.worldbook === name && group.book.length,
        );
        if (found.ambiguousBooks.has(name)) {
          skipped += groups.length || 1;
          continue;
        }
        let next = rows;
        let count = 0;
        for (const group of groups) {
          if (group.invalid) {
            skipped++;
            continue;
          }
          const legacy = group.book.some((row) => !entryIdentity(String(row.content ?? "")));
          if (!legacy) continue;
          const prior = readIndex(next).find((item) => item.project_id === group.instance.projectId);
          if (prior && prior.version_id !== group.instance.version) {
            skipped++;
            continue;
          }
          const originals = new Set(group.book.map(stable));
          next = next.map((row) => (originals.has(stable(row)) ? writeEntry(row, identity(row)!) : row));
          next = updateIndex(
            next,
            group.instance.projectId,
            prior ?? indexProject(group.instance.projectId, group.instance.version),
          );
          count++;
        }
        if (!count) continue;
        checkScope(host, confirmed);
        if (host.character() !== snapshot.character) throw new Error("角色已改变");
        await host.updateBook(name, (current) => {
          checkScope(host, confirmed);
          if (stable(current) !== stable(rows)) throw new Error("世界书已改变，请重新扫描");
          return next;
        });
        if (stable(await host.book(name)) !== stable(next)) throw new Error("世界书写入后重读不一致");
        converted += count;
      }
      return { converted, skipped };
    } catch (error) {
      throw new Error(`转换失败，宿主可能已局部写入；请重新扫描并核对。${String(error)}`);
    } finally {
      busy = false;
    }
  }
  async function confirm(previewId: string) {
    if (busy) throw new Error("另一个安装操作正在执行");
    const plan = pending.get(previewId);
    if (!plan) throw new Error("预览不存在或已取消，请重新预览");
    pending.delete(previewId);
    busy = true;
    const current = generation;
    try {
      return await applyPlan(host, plan, () => {
        if (current !== generation) throw new Error("预览已取消，请重新预览");
      });
    } finally {
      busy = false;
    }
  }
  return { scan, preview, confirm, cancel, cancelAll, convertLegacy };
}

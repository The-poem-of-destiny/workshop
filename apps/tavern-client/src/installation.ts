import type { InstallInstance } from "../../../packages/contracts/src/install.js";
import { capture, discover } from "./install-discovery.js";
import { copy, type InstallHost, type Plan, type Row, type Snapshot, stable } from "./install-model.js";

async function persistPending(host: InstallHost, plan: Plan, fresh: Snapshot) {
  const { old, intent, result, book, regex } = plan;
  // UUID regex identity must be durable before the host drops unsupported custom fields.
  // A failed operation remains explicitly pending/ambiguous rather than becoming orphan content.
  if (regex.length) {
    const records = copy(fresh.records);
    records[result.instanceId] = {
      pending: true,
      instance: {
        instanceId: result.instanceId,
        projectId: intent.project?.id ?? old!.instance.projectId,
        version: intent.project?.version ?? old!.instance.version,
        location: result.target,
        source: "native",
        state: "baselineUnknown",
        entryCount: book.length,
        regexCount: regex.length,
      },
      baseline: {
        book,
        regex: [...(old?.regex ?? []).filter((row) => !regex.some((next) => next.id === row.id)), ...regex],
      },
    };
    await host.saveRecords(records);
  }
}

async function persistComplete(host: InstallHost, plan: Plan, fresh: Snapshot) {
  const { old, intent, result, book, regex } = plan;
  const records = copy(fresh.records);
  delete records[result.instanceId];
  if (intent.action === "install") {
    for (const id of discover(fresh).clearedPending) {
      if (fresh.records[id]!.instance.projectId === intent.project?.id) delete records[id];
    }
  }
  if (intent.action !== "uninstall") {
    const instance: InstallInstance = {
      instanceId: result.instanceId,
      projectId: intent.project?.id ?? old!.instance.projectId,
      version: intent.project?.version ?? old!.instance.version,
      location: result.target,
      source: old?.instance.source ?? "native",
      state: "clean",
      entryCount: book.length,
      regexCount: regex.length,
    };
    records[result.instanceId] = { instance, baseline: { book, regex } };
  }
  await host.saveRecords(records);
}

export async function applyPlan(host: InstallHost, plan: Plan) {
  const fresh = await capture(host);
  const signature = (s: Snapshot) => stable({ ...s, books: [...s.books] });
  if (signature(fresh) !== signature(plan.snapshot)) throw new Error("预览后内容或角色状态已改变，请重新查看 diff");
  const { old, intent, result, book, regex } = plan;
  const source = old?.instance.location.worldbook;
  const target = result.target.worldbook;
  const expected = new Map(fresh.books);
  const oldRows = new Set((old?.book ?? []).map((r: Row) => stable(r)));
  const oldRegex = new Set((old?.regex ?? []).map((r: Row) => stable(r)));
  const checkContext = () => {
    if (host.character() !== fresh.character || stable(host.bindings()) !== stable(fresh.bindings))
      throw new Error("角色或绑定已改变，请重新预览");
  };
  checkContext();
  try {
    await persistPending(host, plan, fresh);
    if (target && !fresh.names.includes(target)) {
      await host.createBook(target);
      expected.set(target, []);
    }
    const touched = [...new Set([book.length ? target : null, source].filter(Boolean))] as string[];
    // Best-effort comparison of the snapshot TH supplies to the updater, not atomic CAS.
    // TH performs GET -> updater -> unconditional replace; external edits after the
    // updater and before persistence cannot be prevented by this API. Re-read detects
    // divergent saved results but cannot recover an already overwritten external edit.
    for (const name of touched) {
      checkContext();
      await host.updateBook(name, (rows) => {
        checkContext();
        if (stable(rows) !== stable(expected.get(name))) throw new Error("世界书已改变，请重新预览");
        return [
          ...rows.filter((row) => !(name === source && oldRows.has(stable(row)))),
          ...(name === target ? book : []),
        ];
      });
      const actual = await host.book(name);
      const desired = [
        ...(expected.get(name) ?? []).filter((row) => !(name === source && oldRows.has(stable(row)))),
        ...(name === target ? book : []),
      ];
      if (stable(actual) !== stable(desired)) throw new Error("状态未知：世界书写入后重读不一致，请重新扫描");
    }
    if ((old?.regex.length ?? 0) || regex.length) {
      checkContext();
      await host.updateRegex((rows) => {
        checkContext();
        if (stable(rows) !== stable(fresh.regex)) throw new Error("角色正则已改变，请重新预览");
        return [...rows.filter((row) => !oldRegex.has(stable(row))), ...regex];
      });
      if (stable(host.regex()) !== stable([...fresh.regex.filter((row) => !oldRegex.has(stable(row))), ...regex]))
        throw new Error("状态未知：正则写入后重读不一致，请重新扫描");
    }
    if (intent.bindWorldbook && target) {
      checkContext();
      await host.bind(target);
    }
    await persistComplete(host, plan, fresh);
    return { instanceId: result.instanceId, action: intent.action, scan: discover(await capture(host)).scan };
  } catch (error) {
    throw new Error(`安装操作失败，宿主可能已局部写入；没有自动回滚，请重新扫描并核对目标实例。${String(error)}`);
  }
}

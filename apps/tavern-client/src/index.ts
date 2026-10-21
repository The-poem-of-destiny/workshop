/* SillyTavern script: Creative Workshop host, installer and bridge. */
// @ts-nocheck -- Tavern exposes untyped browser globals; runtime guards live below.
declare const $: unknown;
declare const SillyTavern: unknown;
declare function getScriptId(): string;
declare function getVariables(options: { type: "script"; script_id: string }): Record<string, unknown>;
declare function updateVariablesWith(
  updater: (variables: Record<string, unknown>) => Record<string, unknown>,
  options: { type: "script"; script_id: string },
): Promise<void>;
declare function getCharWorldbookNames(scope: "current"): { primary: string | null; additional: string[] };
declare function getWorldbookNames(): string[];
declare function getWorldbook(name: string): Promise<Record<string, unknown>[]>;
declare function createWorldbook(name: string, entries: Record<string, unknown>[]): Promise<void>;
declare function rebindCharWorldbooks(
  scope: "current",
  bindings: { primary: string | null; additional: string[] },
): Promise<void>;
declare function updateWorldbookWith(
  name: string,
  updater: (entries: Record<string, unknown>[]) => Record<string, unknown>[],
): Promise<Record<string, unknown>[]>;
declare function getTavernRegexes(options: { scope: "character"; enable_state: "all" }): Record<string, unknown>[];
declare function updateTavernRegexesWith(
  updater: (regexes: Record<string, unknown>[]) => Record<string, unknown>[],
  options: { scope: "character" },
): Promise<Record<string, unknown>[]>;

declare const __CW_CLIENT_VERSION__: string;
declare const __CW_DEFAULT_ORIGIN__: string;

import { entryKey, entryName, hashText, projectEntry, regexEntries, worldbookEntries } from "./lib.js";

const CLIENT_VERSION = __CW_CLIENT_VERSION__;
const DEFAULT_ORIGIN = __CW_DEFAULT_ORIGIN__;
const ORIGIN_VARIABLE = "cw_worker_origin";

const REGISTRY_VARIABLE = "cw_install_registry";
const BUTTON_ID = "cw-open-button";
const OVERLAY_ID = "cw-overlay";
const AGREEMENT_KEY = "cw_agreement_accepted";

type InstallFileSet = { worldbook?: string; regex?: string };
type InstallProject = { id: string; title?: string; version?: string; projectType?: string | null };
type InstallRegistryEntry = {
  version: string;
  worldbookName: string;
  entries: Record<string, { hash: string; name: string }>;
  regexIds: string[];
  updatedAt: string;
};
type InstallRegistry = Record<string, InstallRegistryEntry>;

let activeFrame: HTMLIFrameElement | null = null;

function scriptVariables(): Record<string, unknown> {
  try {
    return getVariables({ type: "script", script_id: getScriptId() }) ?? {};
  } catch {
    return {};
  }
}

async function saveScriptVariables(updater: (variables: Record<string, unknown>) => void): Promise<void> {
  await updateVariablesWith(variables => {
    updater(variables);
    return variables;
  }, { type: "script", script_id: getScriptId() });
}

function normalizeOrigin(value: unknown): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_ORIGIN;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return DEFAULT_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

function workshopOrigin(): string {
  const variables = scriptVariables();
  return normalizeOrigin(variables[ORIGIN_VARIABLE]);
}

function currentChannel(): "stable" | "staging" {
  try {
    const script = document.currentScript as HTMLScriptElement | null;
    return script?.src && /\/staging\//.test(script.src) ? "staging" : "stable";
  } catch {
    return "stable";
  }
}

function readRegistry(): InstallRegistry {
  const raw = scriptVariables()[REGISTRY_VARIABLE];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as InstallRegistry : {};
}

async function writeRegistry(registry: InstallRegistry): Promise<void> {
  await saveScriptVariables(variables => {
    variables[REGISTRY_VARIABLE] = registry;
  });
}

async function ensureTargetWorldbook(requested?: string | null): Promise<string> {
  const bindings = getCharWorldbookNames("current");
  const target = (requested || bindings.primary || "").trim();
  if (!target) throw new Error("当前角色卡未绑定世界书，请先创建或选择一本世界书");
  if (!getWorldbookNames().includes(target)) await createWorldbook(target, []);
  if (target !== bindings.primary && !(bindings.additional || []).includes(target)) {
    await rebindCharWorldbooks("current", {
      primary: bindings.primary,
      additional: [...(bindings.additional || []), target],
    });
  }
  return target;
}

async function installProject(project: InstallProject, files: InstallFileSet, targetWorldbook?: string | null) {
  if (!project?.id) throw new Error("缺少项目 ID");
  const registry = readRegistry();
  const previous = registry[project.id];
  const target = await ensureTargetWorldbook(targetWorldbook);

  if (previous && previous.worldbookName && previous.worldbookName !== target) {
    const oldBook = previous.worldbookName;
    if (getWorldbookNames().includes(oldBook)) {
      await updateWorldbookWith(oldBook, entries => entries.filter(entry =>
        entry?.extensions?.cw_project_id !== project.id || entry?.extensions?.cw_project_version !== previous.version,
      ));
    }
  }

  const incoming = worldbookEntries(files.worldbook ? JSON.parse(files.worldbook) : null);
  if (files.worldbook && incoming.length === 0) throw new Error("世界书文件没有有效条目");
  const current = await getWorldbook(target);
  const oldByKey = new Map<string, Record<string, unknown>>();
  for (const [index, entry] of current.entries()) oldByKey.set(entryKey(entry, index), entry);

  const desiredKeys = new Set<string>();
  const conflicts: string[] = [];
  const result: Record<string, unknown>[] = [];
  for (const entry of current) {
    if (!projectEntry(entry) || entry.extensions.cw_project_id !== project.id) result.push(entry);
  }

  for (const [index, raw] of incoming.entries()) {
    const key = entryKey(raw, index);
    if (desiredKeys.has(key)) throw new Error(`世界书条目身份重复：${key}`);
    desiredKeys.add(key);
    const old = oldByKey.get(key);
    const oldHash = old?.extensions?.cw_installed_hash;
    const oldContentHash = old ? await hashText(String(old.content ?? "")) : null;
    if (old && typeof oldHash === "string" && oldContentHash !== oldHash) {
      result.push(old);
      conflicts.push(`${entryName(old, key)}（玩家已修改，保留当前内容）`);
      continue;
    }
    const contentHash = await hashText(String(raw.content ?? ""));
    const extensions = raw.extensions && typeof raw.extensions === "object" ? { ...raw.extensions } : {};
    result.push({
      ...raw,
      extensions: {
        ...extensions,
        cw_project_id: project.id,
        cw_project_version: project.version ?? "",
        cw_entry_key: key,
        cw_project_name_display: project.title ?? "",
        cw_installed_hash: contentHash,
      },
    });
  }

  for (const entry of current) {
    if (!projectEntry(entry) || entry.extensions.cw_project_id !== project.id) continue;
    const key = entryKey(entry, current.indexOf(entry));
    if (desiredKeys.has(key)) continue;
    const oldHash = entry.extensions.cw_installed_hash;
    const currentHash = await hashText(String(entry.content ?? ""));
    if (typeof oldHash === "string" && currentHash !== oldHash) {
      result.push(entry);
      conflicts.push(`${entryName(entry, key)}（玩家已修改，未自动删除）`);
    }
  }

  await updateWorldbookWith(target, () => result);

  const regexIds: string[] = [];
  if (files.regex) {
    const incomingRegex = regexEntries(JSON.parse(files.regex));
    const all = getTavernRegexes({ scope: "character", enable_state: "all" });
    const prefix = `cw-${project.id}-`;
    const existing = new Map(all.map(regex => [String(regex.id ?? ""), regex]));
    const kept = all.filter(regex => !String(regex.id ?? "").startsWith(prefix));
    const added = incomingRegex.map((entry, index) => {
      const id = `${prefix}${index}`;
      regexIds.push(id);
      const old = existing.get(id);
      return {
        id,
        script_name: `[工坊] ${project.title ?? project.id} - ${entry.scriptName ?? entry.script_name ?? entry.id ?? index + 1}`,
        enabled: old?.enabled ?? true,
        scope: "character",
        find_regex: String(entry.findRegex ?? entry.find_regex ?? ""),
        replace_string: String(entry.replaceString ?? entry.replace_string ?? ""),
        trim_strings: Array.isArray(entry.trimStrings) ? entry.trimStrings : [],
        source: entry.placement ? {
          user_input: entry.placement.includes(1),
          ai_output: entry.placement.includes(2),
          slash_command: entry.placement.includes(3),
          world_info: entry.placement.includes(5),
          reasoning: entry.placement.includes(6),
        } : old?.source,
        destination: old?.destination ?? {
          display: Boolean(entry.markdownOnly),
          prompt: Boolean(entry.promptOnly),
        },
        run_on_edit: Boolean(entry.runOnEdit),
        min_depth: Number.isFinite(entry.minDepth) ? entry.minDepth : null,
        max_depth: Number.isFinite(entry.maxDepth) ? entry.maxDepth : null,
      };
    });
    await updateTavernRegexesWith(() => [...kept, ...added], { scope: "character" });
  } else if (previous?.regexIds?.length) {
    const prefix = `cw-${project.id}-`;
    await updateTavernRegexesWith(
      regexes => regexes.filter(regex => !String(regex.id ?? "").startsWith(prefix)),
      { scope: "character" },
    );
  }

  const entryIndex: InstallRegistryEntry["entries"] = {};
  for (const [index, entry] of result.entries()) {
    if (entry?.extensions?.cw_project_id === project.id) {
      const key = entryKey(entry, index);
      entryIndex[key] = {
        hash: await hashText(String(entry.content ?? "")),
        name: entryName(entry, key),
      };
    }
  }
  registry[project.id] = {
    version: project.version ?? "",
    worldbookName: target,
    entries: entryIndex,
    regexIds,
    updatedAt: new Date().toISOString(),
  };
  await writeRegistry(registry);
  return { target, entryCount: incoming.length, regexCount: regexIds.length, conflicts };
}

async function uninstallProject(projectId: string) {
  const registry = readRegistry();
  const record = registry[projectId];
  if (record?.worldbookName && getWorldbookNames().includes(record.worldbookName)) {
    await updateWorldbookWith(record.worldbookName, entries =>
      entries.filter(entry => entry?.extensions?.cw_project_id !== projectId),
    );
  }
  if (record?.regexIds?.length) {
    const ids = new Set(record.regexIds);
    await updateTavernRegexesWith(regexes => regexes.filter(regex => !ids.has(String(regex.id ?? ""))), {
      scope: "character",
    });
  }
  delete registry[projectId];
  await writeRegistry(registry);
  return { removed: Boolean(record) };
}

function contextPayload() {
  try {
    const bindings = getCharWorldbookNames("current");
    return {
      connected: true,
      characterName: typeof SillyTavern !== "undefined" ? SillyTavern.getCurrentCharacterName?.() ?? null : null,
      worldbooks: {
        primary: bindings.primary,
        additional: bindings.additional || [],
        available: getWorldbookNames(),
      },
      registry: readRegistry(),
      clientVersion: CLIENT_VERSION,
    };
  } catch {
    return { connected: false, error: "无法读取 SillyTavern 上下文" };
  }
}

function send(payload: Record<string, unknown>) {
  activeFrame?.contentWindow?.postMessage(payload, workshopOrigin());
}

function showOverlay() {
  const hostWindow = window.parent !== window ? window.parent : window;
  const hostDocument = hostWindow.document;
  const host$ = Reflect.get(hostWindow, "$");
  if (typeof host$ !== "function") throw new Error("SillyTavern jQuery 未就绪");

  host$(`#${OVERLAY_ID}`).remove();
  const $overlay = host$(`<div id="${OVERLAY_ID}">`).css({
    position: "fixed", inset: "0", zIndex: 2147483600, background: "rgba(0,0,0,.72)",
    display: "flex", alignItems: "stretch", justifyContent: "center", padding: "16px",
    boxSizing: "border-box", backdropFilter: "blur(4px)",
  });
  const $card = host$("<div>").css({
    position: "relative", display: "flex", flexDirection: "column", width: "min(1200px, 100%)",
    height: "100%", background: "#0f1012", borderRadius: "18px", overflow: "hidden",
    boxShadow: "0 24px 80px rgba(0,0,0,.5)",
  });
  const $bar = host$("<div>").css({
    display: "flex", alignItems: "center", justifyContent: "space-between",
    flex: "0 0 46px", padding: "0 8px 0 16px", background: "#1b1d22",
    color: "#e5e7eb", font: "600 13px system-ui",
  });
  const $close = host$("<button type='button' aria-label='关闭'>×</button>").css({
    width: "40px", height: "40px", border: "0", borderRadius: "9px",
    background: "transparent", color: "#d1d5db", fontSize: "26px", cursor: "pointer",
  });
  const $frame = host$("<iframe frameborder='0'>").css({
    flex: "1 1 0", minHeight: "0", width: "100%", border: "0", background: "#0f1012",
  });
  $bar.append(host$("<span>命定创意工坊</span>"), $close);
  $card.append($bar, $frame);
  $overlay.append($card).appendTo(hostDocument.body);
  activeFrame = $frame[0] as HTMLIFrameElement;

  const close = () => {
    activeFrame = null;
    $overlay.remove();
  };
  $close.on("click", close);
  $overlay.on("click", (event: Event) => { if (event.target === $overlay[0]) close(); });

  const origin = workshopOrigin();
  (async () => {
    let target = `${origin}/?embed=1&clientVersion=${encodeURIComponent(CLIENT_VERSION)}`;
    try {
      const response = await fetch(
        `${origin}/api/v1/client/compatibility?version=${encodeURIComponent(CLIENT_VERSION)}&channel=${currentChannel()}`,
        { cache: "no-store" },
      );
      const version = await response.json() as { compatible?: boolean; required?: string | null };
      if (version.compatible === false) {
        $frame.remove();
        $card.append(host$("<div>").css({
          padding: "32px", color: "#fbbf24", font: "14px/1.7 system-ui",
        }).text(`客户端版本 ${CLIENT_VERSION} 与工坊要求不一致，需要 ${version.required ?? "更新版本"}。请刷新页面或更新脚本。`));
        return;
      }
    } catch {
      // Offline/bootstrap: still attempt to open the workshop.
    }
    $frame.attr("src", target);
  })();

  window.addEventListener("message", onMessage);
}

function onMessage(event: MessageEvent) {
  if (!activeFrame || event.source !== activeFrame.contentWindow) return;
  if (event.origin !== workshopOrigin()) return;
  const data = event.data;
  if (!data || typeof data !== "object" || typeof data.type !== "string") return;

  if (data.type === "cw:ready" || data.type === "cw:request-context") {
    send({ type: "cw:context", ...contextPayload() });
    return;
  }
  if (data.type === "cw:close") {
    $(`#${OVERLAY_ID}`).remove();
    activeFrame = null;
    return;
  }
  if (data.type === "cw:scan") {
    send({ type: "cw:scan-result", ok: true, registry: readRegistry() });
    return;
  }
  if (data.type === "cw:uninstall") {
    void uninstallProject(String(data.projectId ?? ""))
      .then(result => send({ type: "cw:uninstall-result", ok: true, projectId: data.projectId, ...result }))
      .catch(error => send({ type: "cw:uninstall-result", ok: false, message: String(error?.message ?? error) }));
    return;
  }
  if (data.type === "cw:install") {
    const project = data.project as InstallProject;
    const files = data.files as InstallFileSet;
    if (!project || !files || typeof files.worldbook !== "string" && typeof files.regex !== "string") {
      send({ type: "cw:install-result", ok: false, message: "安装数据不完整" });
      return;
    }
    void installProject(project, files, typeof data.targetWorldbook === "string" ? data.targetWorldbook : null)
      .then(result => send({ type: "cw:install-result", ok: true, projectId: project.id, ...result }))
      .catch(error => send({ type: "cw:install-result", ok: false, message: String(error?.message ?? error) }));
  }
}

function installButton() {
  $(() => {
    const bind = () => {
      if ($(`#${BUTTON_ID}`).length) return;
      const $button = $(`<button id="${BUTTON_ID}" type="button">命定创意工坊</button>`).css({
        position: "fixed", right: "18px", bottom: "18px", zIndex: 2147483500,
        border: "1px solid rgba(184,157,118,.5)", borderRadius: "999px",
        background: "#18191c", color: "#e8dfcf", padding: "10px 16px",
        font: "600 13px system-ui", cursor: "pointer", boxShadow: "0 8px 30px rgba(0,0,0,.35)",
      });
      $button.on("click", () => {
        if (localStorage.getItem(AGREEMENT_KEY) !== "true") {
          localStorage.setItem(AGREEMENT_KEY, "true");
        }
        try { showOverlay(); }
        catch (error) { console.error("[CreativeWorkshop] open failed", error); }
      });
      $("body").append($button);
    };
    bind();
    const observer = new MutationObserver(bind);
    observer.observe(document.body, { childList: true });
  });
}

installButton();

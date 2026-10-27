/* SillyTavern script: Creative Workshop host, installer and bridge. */

import {
  type InstallFileSet,
  type InstallProject,
  readRegistry,
  saveScriptVariables,
  workshopOrigin,
} from "./install-registry.js";
import { installProject, scanInstallStates, uninstallProject } from "./installation.js";
import { normalizeWorkshopOrigin } from "./lib.js";

const CLIENT_VERSION = __CW_CLIENT_VERSION__;
const DEFAULT_ORIGIN = __CW_DEFAULT_ORIGIN__;
const ORIGIN_VARIABLE = "cw_worker_origin";
const BUTTON_ID = "cw-open-button";
const OVERLAY_ID = "cw-overlay";
const AGREEMENT_KEY = "cw_agreement_accepted";

let activeFrame: HTMLIFrameElement | null = null;

const SCRIPT_CHANNEL: "stable" | "staging" = (() => {
  try {
    const script = document.currentScript;
    return script instanceof HTMLScriptElement && /\/staging\//.test(script.src) ? "staging" : "stable";
  } catch {
    return "stable";
  }
})();

async function contextPayload() {
  try {
    const bindings = getCharWorldbookNames("current");
    const registry = readRegistry();
    return {
      connected: true,
      characterName: typeof SillyTavern !== "undefined" ? (SillyTavern.getCurrentCharacterName?.() ?? null) : null,
      worldbooks: {
        primary: bindings.primary,
        additional: bindings.additional || [],
        available: getWorldbookNames(),
      },
      registry,
      installStates: await scanInstallStates(registry),
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
  const host$ = hostWindow.$;
  if (typeof host$ !== "function") throw new Error("SillyTavern jQuery 未就绪");

  host$(`#${OVERLAY_ID}`).remove();
  const $overlay = host$(`<div id="${OVERLAY_ID}">`).css({
    position: "fixed",
    inset: "0",
    zIndex: 2147483600,
    background: "rgba(0,0,0,.72)",
    display: "flex",
    alignItems: "stretch",
    justifyContent: "center",
    padding: "16px",
    boxSizing: "border-box",
    backdropFilter: "blur(4px)",
  });
  const $card = host$("<div>").css({
    position: "relative",
    display: "flex",
    flexDirection: "column",
    width: "min(1200px, 100%)",
    height: "100%",
    background: "#0f1012",
    borderRadius: "18px",
    overflow: "hidden",
    boxShadow: "0 24px 80px rgba(0,0,0,.5)",
  });
  const $bar = host$("<div>").css({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flex: "0 0 46px",
    padding: "0 8px 0 16px",
    background: "#1b1d22",
    color: "#e5e7eb",
    font: "600 13px system-ui",
  });
  const $close = host$("<button type='button' aria-label='关闭'>×</button>").css({
    width: "40px",
    height: "40px",
    border: "0",
    borderRadius: "9px",
    background: "transparent",
    color: "#d1d5db",
    fontSize: "26px",
    cursor: "pointer",
  });
  const $frame = host$("<iframe frameborder='0'>").css({
    flex: "1 1 0",
    minHeight: "0",
    width: "100%",
    border: "0",
    background: "#0f1012",
  });
  $bar.append(host$("<span>命定创意工坊</span>"), $close);
  $card.append($bar, $frame);
  $overlay.append($card).appendTo(hostDocument.body);
  activeFrame = $frame[0];

  const close = () => {
    activeFrame = null;
    $overlay.remove();
  };
  $close.on("click", close);
  $overlay.on("click", (event: Event) => {
    if (event.target === $overlay[0]) close();
  });

  const origin = workshopOrigin();
  const target = new URL("/", origin);
  target.searchParams.set("embed", "1");
  target.searchParams.set("clientVersion", CLIENT_VERSION);
  target.searchParams.set("clientChannel", SCRIPT_CHANNEL);
  (async () => {
    try {
      const response = await fetch(
        `${origin}/api/v1/client/compatibility?version=${encodeURIComponent(CLIENT_VERSION)}&channel=${SCRIPT_CHANNEL}`,
        { cache: "no-store" },
      );
      const version = (await response.json()) as {
        bootstrap?: boolean;
        compatible?: boolean;
        required?: string | null;
      };
      if (version.bootstrap === true) {
        console.warn("[CreativeWorkshop] 当前渠道尚未发布客户端，已进入引导模式。");
      } else if (version.compatible === false) {
        $frame.remove();
        $card.append(
          host$("<div>")
            .css({
              padding: "32px",
              color: "#fbbf24",
              font: "14px/1.7 system-ui",
            })
            .text(
              `客户端版本 ${CLIENT_VERSION} 与工坊要求不一致，需要 ${version.required ?? "更新版本"}。请刷新页面或更新脚本。`,
            ),
        );
        return;
      }
    } catch {
      // Offline compatibility checks must not prevent opening the workshop.
    }
    $frame.attr("src", target.toString());
  })();

  window.addEventListener("message", onMessage);
}

function onMessage(
  event: MessageEvent<{
    type?: string;
    project?: InstallProject;
    files?: InstallFileSet;
    projectId?: unknown;
    targetWorldbook?: unknown;
  } | null>,
) {
  if (!activeFrame || event.source !== activeFrame.contentWindow) return;
  if (event.origin !== workshopOrigin()) return;
  const data = event.data;
  if (!data || typeof data !== "object" || typeof data.type !== "string") return;

  if (data.type === "cw:ready" || data.type === "cw:request-context") {
    void contextPayload()
      .then((payload) => send({ type: "cw:context", ...payload }))
      .catch((error) => send({ type: "cw:context", connected: false, error: String(error?.message ?? error) }));
    return;
  }
  if (data.type === "cw:close") {
    $(`#${OVERLAY_ID}`).remove();
    activeFrame = null;
    return;
  }
  if (data.type === "cw:scan") {
    const registry = readRegistry();
    void scanInstallStates(registry)
      .then((installStates) => send({ type: "cw:scan-result", ok: true, registry, installStates }))
      .catch((error) => send({ type: "cw:scan-result", ok: false, message: String(error?.message ?? error) }));
    return;
  }
  if (data.type === "cw:uninstall") {
    void uninstallProject(String(data.projectId ?? ""))
      .then((result) => send({ type: "cw:uninstall-result", ok: true, projectId: data.projectId, ...result }))
      .catch((error) => send({ type: "cw:uninstall-result", ok: false, message: String(error?.message ?? error) }));
    return;
  }
  if (data.type === "cw:install") {
    const project = data.project;
    const files = data.files;
    if (!project || !files || (typeof files.worldbook !== "string" && typeof files.regex !== "string")) {
      send({ type: "cw:install-result", ok: false, message: "安装数据不完整" });
      return;
    }
    void installProject(project, files, typeof data.targetWorldbook === "string" ? data.targetWorldbook : null)
      .then((result) => send({ type: "cw:install-result", ok: true, projectId: project.id, ...result }))
      .catch((error) => send({ type: "cw:install-result", ok: false, message: String(error?.message ?? error) }));
  }
}

function hostJQuery(): WorkshopJQuery {
  const hostWindow = window.parent !== window ? window.parent : window;
  const host$ = hostWindow.$;
  if (typeof host$ !== "function") throw new Error("SillyTavern jQuery 未就绪");
  return host$;
}

function showAgreement(): Promise<boolean> {
  return new Promise((resolve) => {
    const host$ = hostJQuery();
    host$("#cw-agreement").remove();
    const $overlay = host$(`<div id="cw-agreement">`).css({
      position: "fixed",
      inset: "0",
      zIndex: 2147483601,
      background: "rgba(0,0,0,.72)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      boxSizing: "border-box",
    });
    const $card = host$("<div>").css({
      width: "min(560px, 100%)",
      background: "#17191f",
      color: "#e8dfcf",
      border: "1px solid #3a3428",
      borderRadius: "14px",
      padding: "22px",
      font: "14px/1.75 system-ui",
      boxShadow: "0 24px 80px rgba(0,0,0,.5)",
    });
    $card.append(host$("<h3>使用前说明</h3>").css({ margin: "0 0 10px", fontSize: "18px" }));
    $card.append(
      host$("<p>").text(
        "创意工坊会把你选择的世界书与正则安装到当前 SillyTavern 角色。安装前请备份角色卡；卸载会移除工坊写入的条目，但不会恢复已被你覆盖的原条目。",
      ),
    );
    $card.append(host$("<p>").text("服务地址默认为官方工坊。仅在自建或测试环境修改；地址必须与你信任的工坊一致。"));
    const $actions = host$("<div>").css({
      display: "flex",
      gap: "10px",
      justifyContent: "flex-end",
      marginTop: "16px",
    });
    const $cancel = host$("<button type='button'>取消</button>").css({
      padding: "8px 14px",
      borderRadius: "8px",
      border: "1px solid #4b5563",
      background: "transparent",
      color: "#d1d5db",
      cursor: "pointer",
    });
    const $accept = host$("<button type='button'>同意并继续</button>").css({
      padding: "8px 14px",
      borderRadius: "8px",
      border: "0",
      background: "#d8b46a",
      color: "#1a1a1a",
      fontWeight: "600",
      cursor: "pointer",
    });
    $actions.append($cancel, $accept);
    $card.append($actions);
    $overlay.append($card).appendTo((window.parent !== window ? window.parent : window).document.body);
    const finish = (value: boolean) => {
      $overlay.remove();
      resolve(value);
    };
    $cancel.on("click", () => finish(false));
    $accept.on("click", () => finish(true));
    $overlay.on("click", (event: Event) => {
      if (event.target === $overlay[0]) finish(false);
    });
  });
}

function showOriginSettings(): Promise<void> {
  return new Promise((resolve) => {
    const host$ = hostJQuery();
    host$("#cw-origin-settings").remove();
    const $overlay = host$(`<div id="cw-origin-settings">`).css({
      position: "fixed",
      inset: "0",
      zIndex: 2147483601,
      background: "rgba(0,0,0,.72)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      boxSizing: "border-box",
    });
    const $card = host$("<div>").css({
      width: "min(520px, 100%)",
      background: "#17191f",
      color: "#e8dfcf",
      border: "1px solid #3a3428",
      borderRadius: "14px",
      padding: "22px",
      font: "14px/1.7 system-ui",
    });
    $card.append(host$("<h3>工坊服务地址</h3>").css({ margin: "0 0 10px", fontSize: "18px" }));
    const $input = host$("<input type='url'>").css({
      width: "100%",
      boxSizing: "border-box",
      padding: "9px 11px",
      borderRadius: "8px",
      border: "1px solid #4b5563",
      background: "#0f1012",
      color: "#e5e7eb",
    });
    $input.val(workshopOrigin());
    $card.append($input);
    const $hint = host$("<p>")
      .css({ color: "#9ca3af", fontSize: "12px", margin: "8px 0 0" })
      .text("留空恢复默认：" + DEFAULT_ORIGIN);
    $card.append($hint);
    const $actions = host$("<div>").css({
      display: "flex",
      gap: "10px",
      justifyContent: "flex-end",
      marginTop: "14px",
    });
    const $cancel = host$("<button type='button'>取消</button>").css({
      padding: "8px 14px",
      borderRadius: "8px",
      border: "1px solid #4b5563",
      background: "transparent",
      color: "#d1d5db",
      cursor: "pointer",
    });
    const $save = host$("<button type='button'>保存</button>").css({
      padding: "8px 14px",
      borderRadius: "8px",
      border: "0",
      background: "#d8b46a",
      color: "#1a1a1a",
      fontWeight: "600",
      cursor: "pointer",
    });
    $actions.append($cancel, $save);
    $card.append($actions);
    $overlay.append($card).appendTo((window.parent !== window ? window.parent : window).document.body);
    const finish = () => {
      $overlay.remove();
      resolve();
    };
    $cancel.on("click", finish);
    $save.on("click", () => {
      const next = normalizeWorkshopOrigin($input.val(), DEFAULT_ORIGIN);
      void saveScriptVariables((variables) => {
        if (next === DEFAULT_ORIGIN) delete variables[ORIGIN_VARIABLE];
        else variables[ORIGIN_VARIABLE] = next;
      }).finally(finish);
    });
    $overlay.on("click", (event: Event) => {
      if (event.target === $overlay[0]) finish();
    });
  });
}

async function openWithAgreement(): Promise<void> {
  if (localStorage.getItem(AGREEMENT_KEY) !== "true") {
    const accepted = await showAgreement();
    if (!accepted) return;
    localStorage.setItem(AGREEMENT_KEY, "true");
  }
  showOverlay();
}

function installButton() {
  $(() => {
    const bind = () => {
      if ($(`#${BUTTON_ID}`).length) return;
      const $button = $(`<button id="${BUTTON_ID}" type="button">命定创意工坊</button>`).css({
        position: "fixed",
        right: "18px",
        bottom: "18px",
        zIndex: 2147483500,
        border: "1px solid rgba(184,157,118,.5)",
        borderRadius: "999px",
        background: "#18191c",
        color: "#e8dfcf",
        padding: "10px 16px",
        font: "600 13px system-ui",
        cursor: "pointer",
        boxShadow: "0 8px 30px rgba(0,0,0,.35)",
      });
      $button.on("click", () => {
        try {
          void openWithAgreement();
        } catch (error) {
          console.error("[CreativeWorkshop] open failed", error);
        }
      });
      const $settings = $(`<button id="cw-settings-button" type="button" aria-label="工坊设置">⚙</button>`).css({
        position: "fixed",
        right: "18px",
        bottom: "68px",
        zIndex: 2147483500,
        width: "36px",
        height: "36px",
        border: "1px solid rgba(184,157,118,.5)",
        borderRadius: "50%",
        background: "#18191c",
        color: "#e8dfcf",
        cursor: "pointer",
      });
      $settings.on("click", () => {
        void showOriginSettings().catch((error) => console.error("[CreativeWorkshop] settings failed", error));
      });
      $("body").append($button, $settings);
    };
    bind();
    const observer = new MutationObserver(bind);
    observer.observe(document.body, { childList: true });
  });
}

installButton();

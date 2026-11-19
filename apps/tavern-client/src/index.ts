/* SillyTavern script: Creative Workshop host, installer and bridge. */
import type { InstallIntent } from "@workshop/contracts/install";
import { hostJQuery, hostWindow, showAgreement, showOriginSettings } from "./dialogs.js";
import { createInstallManager } from "./install.js";
import type { RecordSet } from "./install-model.js";
import { saveScriptVariables, scriptVariables, workshopOrigin } from "./install-registry.js";
import { characterRegexHost } from "./regex-host.js";

const CLIENT_VERSION = __CW_CLIENT_VERSION__;
const DEFAULT_ORIGIN = __CW_DEFAULT_ORIGIN__;

const BUTTON_ID = "cw-open-button";
const OVERLAY_ID = "cw-overlay";
const AGREEMENT_KEY = "cw_agreement_accepted";

let activeFrame: HTMLIFrameElement | null = null;
let cleanupResize: (() => void) | null = null;

const SCRIPT_CHANNEL: "stable" | "staging" = (() => {
  try {
    const script = document.currentScript;
    return script instanceof HTMLScriptElement && /\/staging\//.test(script.src) ? "staging" : "stable";
  } catch {
    return "stable";
  }
})();

const installations = createInstallManager({
  character() {
    const context = SillyTavern.getContext();
    return context.characters?.[context.characterId]?.avatar ?? null;
  },
  names: () => getWorldbookNames(),
  bindings: () => getCharWorldbookNames("current"),
  book: (name) => getWorldbook(name),
  ...characterRegexHost(getTavernRegexes, updateTavernRegexesWith),
  updateBook: (name, update) => updateWorldbookWith(name, update),
  createBook: (name) => createWorldbook(name, []),
  async bind(name) {
    const bindings = getCharWorldbookNames("current");
    if (bindings.primary !== name && !bindings.additional.includes(name)) {
      await rebindCharWorldbooks("current", { primary: bindings.primary, additional: [...bindings.additional, name] });
    }
  },
  records: () => (scriptVariables().cw_install_instances as Record<string, RecordSet>) ?? {},
  saveRecords: (records) =>
    saveScriptVariables((variables) => {
      variables.cw_install_instances = JSON.parse(
        JSON.stringify(records, (_key, value) =>
          value instanceof RegExp ? { $regexp: value.source, flags: value.flags } : value,
        ),
      );
    }),
  uuid: () => crypto.randomUUID(),
});

async function contextPayload() {
  const bindings = getCharWorldbookNames("current");
  return {
    connected: true,
    characterName: SillyTavern.getCurrentCharacterName?.() ?? null,
    worldbooks: { primary: bindings.primary, additional: bindings.additional || [], available: getWorldbookNames() },
    installationScan: await installations.scan(),
    clientVersion: CLIENT_VERSION,
  };
}

function closeOverlay() {
  installations.cancelAll();
  activeFrame = null;
  cleanupResize?.();
  cleanupResize = null;
  const host = hostWindow();
  host.removeEventListener("message", onMessage);
  hostJQuery()(`#${OVERLAY_ID}`).remove();
}

function send(frame: HTMLIFrameElement, payload: Record<string, unknown>) {
  if (activeFrame === frame) frame.contentWindow?.postMessage(payload, workshopOrigin());
}

function showOverlay() {
  const host = hostWindow();
  const hostDocument = host.document;
  const host$ = hostJQuery();

  closeOverlay();
  const applyResponsiveShell = (overlayEl: HTMLElement | undefined, cardEl: HTMLElement | undefined) => {
    if (!overlayEl || !cardEl) return;
    const narrow = host.innerWidth <= 768;
    overlayEl.style.padding = narrow ? "0" : "12px";
    cardEl.style.width = narrow ? "100vw" : "min(1720px, calc(100vw - 24px))";
    cardEl.style.height = narrow ? "100dvh" : "100%";
    cardEl.style.borderRadius = narrow ? "0" : "14px";
    cardEl.style.border = narrow ? "0" : "1px solid rgba(200, 174, 130, 0.2)";
  };

  const $overlay = host$(`<div id="${OVERLAY_ID}">`).css({
    position: "fixed",
    inset: "0",
    zIndex: 2147483600,
    background: "rgba(6, 7, 10, .76)",
    display: "flex",
    alignItems: "stretch",
    justifyContent: "center",
    padding: "12px",
    boxSizing: "border-box",
    backdropFilter: "blur(6px)",
  });
  const $card = host$("<div>").css({
    position: "relative",
    display: "flex",
    flexDirection: "column",
    width: "min(1720px, calc(100vw - 24px))",
    height: "100%",
    background: "#111318",
    borderRadius: "14px",
    overflow: "hidden",
    boxShadow: "0 24px 72px rgba(0,0,0,.55)",
  });
  const $frame = host$("<iframe frameborder='0'>").css({
    flex: "1 1 0",
    minHeight: "0",
    width: "100%",
    border: "0",
    background: "#111318",
  });
  $card.append($frame);
  $overlay.append($card).appendTo(hostDocument.body);
  applyResponsiveShell($overlay[0], $card[0]);
  activeFrame = $frame[0];

  const onResize = () => {
    if (!$overlay[0]?.isConnected) {
      host.removeEventListener("resize", onResize);
      return;
    }
    applyResponsiveShell($overlay[0], $card[0]);
  };
  host.addEventListener("resize", onResize);
  cleanupResize = () => host.removeEventListener("resize", onResize);

  const close = () => closeOverlay();
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
      if (activeFrame !== $frame[0]) return;
      if (version.bootstrap === true) {
        console.warn("[CreativeWorkshop] 当前渠道尚未发布客户端，已进入引导模式。");
      } else if (version.compatible === false) {
        $frame.remove();
        const $fallbackBar = host$("<div>").css({
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid rgba(255,255,255,.08)",
          color: "#efeee9",
          font: "600 14px system-ui",
        });
        const $fallbackClose = host$("<button type='button' aria-label='关闭'>关闭</button>").css({
          minHeight: "36px",
          padding: "6px 12px",
          border: "1px solid rgba(255,255,255,.16)",
          borderRadius: "8px",
          background: "transparent",
          color: "#e5e7eb",
          fontSize: "13px",
          cursor: "pointer",
        });
        $fallbackClose.on("click", close);
        $fallbackBar.append(host$("<span>命定创意工坊</span>"), $fallbackClose);
        $card.append(
          $fallbackBar,
          host$("<div>")
            .css({
              padding: "28px 24px",
              color: "#fbbf24",
              font: "14px/1.7 system-ui",
            })
            .text(
              `当前酒馆脚本版本（${CLIENT_VERSION}）需要升级至 ${version.required ?? "最新版本"}，请刷新页面或更新脚本后重试。`,
            ),
        );
        return;
      }
    } catch {
      // Offline compatibility checks must not prevent opening the workshop.
    }
    if (activeFrame !== $frame[0]) return;
    $frame.attr("src", target.toString());
  })();

  host.addEventListener("message", onMessage);
}

function onMessage(
  event: MessageEvent<{
    type?: string;
    intent: InstallIntent;
    previewId?: string;
    worldbooks?: unknown;
    requestId?: string;
  } | null>,
) {
  if (!activeFrame || event.source !== activeFrame.contentWindow) return;
  if (event.origin !== workshopOrigin()) return;
  const data = event.data;
  if (!data || typeof data !== "object" || typeof data.type !== "string") return;
  const frame = activeFrame;

  if (data.type === "cw:ready" || data.type === "cw:request-context") {
    void contextPayload()
      .then((payload) => send(frame, { type: "cw:context", ...payload }))
      .catch((error) => send(frame, { type: "cw:context", connected: false, error: String(error?.message ?? error) }));
    return;
  }
  if (data.type === "cw:close") {
    closeOverlay();
    return;
  }
  const handlers: Record<string, () => unknown> = {
    "cw:scan": () => installations.scan(),
    "cw:convert-legacy": () => installations.convertLegacy(data.worldbooks),
    "cw:preview-install": () => installations.preview(data.intent),
    "cw:confirm-install": () => installations.confirm(String(data.previewId ?? "")),
    "cw:cancel-install": () => installations.cancel(String(data.previewId ?? "")),
  };
  const handler = handlers[data.type];
  if (handler) {
    Promise.resolve()
      .then(() => {
        if (activeFrame !== frame) throw new Error("会话已关闭");
        return handler();
      })
      .then((result) => send(frame, { type: `${data.type}-result`, requestId: data.requestId, ok: true, result }))
      .catch((error) =>
        send(frame, {
          type: `${data.type}-result`,
          requestId: data.requestId,
          ok: false,
          message: String(error?.message ?? error),
        }),
      );
  }
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
        void showOriginSettings(DEFAULT_ORIGIN).catch((error) =>
          console.error("[CreativeWorkshop] settings failed", error),
        );
      });
      $("body").append($button, $settings);
    };
    bind();
    const observer = new MutationObserver(bind);
    observer.observe(document.body, { childList: true });
  });
}

installButton();

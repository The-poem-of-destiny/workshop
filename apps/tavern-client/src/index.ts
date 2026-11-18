/* SillyTavern script: Creative Workshop host, installer and bridge. */
import type { InstallIntent } from "../../../packages/contracts/src/install.js";
import { createInstallManager } from "./install.js";
import type { RecordSet } from "./install-model.js";
import { saveScriptVariables, scriptVariables, workshopOrigin } from "./install-registry.js";
import { normalizeWorkshopOrigin } from "./lib.js";
import { characterRegexHost } from "./regex-host.js";

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
  hostJQuery()(`#${OVERLAY_ID}`).remove();
}

function send(frame: HTMLIFrameElement, payload: Record<string, unknown>) {
  if (activeFrame === frame) frame.contentWindow?.postMessage(payload, workshopOrigin());
}

function showOverlay() {
  const hostWindow = window.parent !== window ? window.parent : window;
  const hostDocument = hostWindow.document;
  const host$ = hostWindow.$;
  if (typeof host$ !== "function") throw new Error("SillyTavern jQuery 未就绪");

  closeOverlay();
  const applyResponsiveShell = (overlayEl: HTMLElement | undefined, cardEl: HTMLElement | undefined) => {
    if (!overlayEl || !cardEl) return;
    const narrow = hostWindow.innerWidth <= 768;
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
    if (!hostDocument.getElementById(OVERLAY_ID)) {
      hostWindow.removeEventListener("resize", onResize);
      return;
    }
    applyResponsiveShell($overlay[0], $card[0]);
  };
  hostWindow.addEventListener("resize", onResize);

  const close = () => {
    hostWindow.removeEventListener("resize", onResize);
    closeOverlay();
  };
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

  window.addEventListener("message", onMessage);
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
        "从创意工坊安装模组时，会向你选择的目标世界书或当前角色追加该模组的条目；更新所选实例会整体替换该模组的条目（不会保留你对该模组条目的本地修改），卸载则移除该模组的条目。执行安装、更新、转换或卸载前，请务必先备份角色卡与相关世界书。",
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

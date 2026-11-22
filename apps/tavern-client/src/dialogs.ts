import { saveScriptVariables, workshopOrigin } from "./install-registry.js";
import { normalizeWorkshopOrigin } from "./lib.js";

const ORIGIN_VARIABLE = "cw_worker_origin";

const MODAL_OVERLAY_STYLE = {
  position: "fixed",
  inset: "0",
  zIndex: 2147483601,
  background: "rgba(0,0,0,.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px",
  boxSizing: "border-box",
} as const;

const CANCEL_BUTTON_STYLE = {
  padding: "8px 14px",
  borderRadius: "8px",
  border: "1px solid #4b5563",
  background: "transparent",
  color: "#d1d5db",
  cursor: "pointer",
} as const;

const PRIMARY_BUTTON_STYLE = {
  padding: "8px 14px",
  borderRadius: "8px",
  border: "0",
  background: "#d8b46a",
  color: "#1a1a1a",
  fontWeight: "600",
  cursor: "pointer",
} as const;

export function hostWindow(): Window {
  return window.parent !== window ? window.parent : window;
}

export function hostJQuery(): WorkshopJQuery {
  const host$ = hostWindow().$;
  if (typeof host$ !== "function") throw new Error("SillyTavern jQuery 未就绪");
  return host$;
}

function modalCardStyle(maxWidth: string, lineHeight: string) {
  return {
    width: `min(${maxWidth}, 100%)`,
    background: "#17191f",
    color: "#e8dfcf",
    border: "1px solid #3a3428",
    borderRadius: "14px",
    padding: "22px",
    font: `14px/${lineHeight} system-ui`,
    boxShadow: "0 24px 80px rgba(0,0,0,.5)",
  };
}

export function showAgreement(): Promise<boolean> {
  return new Promise((resolve) => {
    const host$ = hostJQuery();
    host$("#cw-agreement").remove();
    const $overlay = host$(`<div id="cw-agreement">`).css({ ...MODAL_OVERLAY_STYLE });
    const $card = host$("<div>").css(modalCardStyle("560px", "1.75"));
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
    const $cancel = host$("<button type='button'>取消</button>").css({ ...CANCEL_BUTTON_STYLE });
    const $accept = host$("<button type='button'>同意并继续</button>").css({ ...PRIMARY_BUTTON_STYLE });
    $actions.append($cancel, $accept);
    $card.append($actions);
    $overlay.append($card).appendTo(hostWindow().document.body);
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

export function showOriginSettings(defaultOrigin: string): Promise<void> {
  return new Promise((resolve) => {
    const host$ = hostJQuery();
    host$("#cw-origin-settings").remove();
    const $overlay = host$(`<div id="cw-origin-settings">`).css({ ...MODAL_OVERLAY_STYLE });
    const $card = host$("<div>").css(modalCardStyle("520px", "1.7"));
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
      .text("留空恢复默认：" + defaultOrigin);
    $card.append($hint);
    const $actions = host$("<div>").css({
      display: "flex",
      gap: "10px",
      justifyContent: "flex-end",
      marginTop: "14px",
    });
    const $cancel = host$("<button type='button'>取消</button>").css({ ...CANCEL_BUTTON_STYLE });
    const $save = host$("<button type='button'>保存</button>").css({ ...PRIMARY_BUTTON_STYLE });
    $actions.append($cancel, $save);
    $card.append($actions);
    $overlay.append($card).appendTo(hostWindow().document.body);
    const finish = () => {
      $overlay.remove();
      resolve();
    };
    $cancel.on("click", finish);
    $save.on("click", () => {
      const next = normalizeWorkshopOrigin($input.val(), defaultOrigin);
      void saveScriptVariables((variables) => {
        if (next === defaultOrigin) delete variables[ORIGIN_VARIABLE];
        else variables[ORIGIN_VARIABLE] = next;
      }).finally(finish);
    });
    $overlay.on("click", (event: Event) => {
      if (event.target === $overlay[0]) finish();
    });
  });
}

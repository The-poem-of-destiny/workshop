import { setSessionToken } from "../api";

export async function mountDebugBar(): Promise<void> {
  const response = await fetch("/__preview/accounts");
  if (!response.ok) throw new Error("Local preview accounts are unavailable");
  const accounts: { role: string; token: string }[] = await response.json();
  const params = new URLSearchParams(location.search);
  const role = params.get("debug-role") ?? "anonymous";
  const account = accounts.find((item) => item.role === role);
  setSessionToken(account?.token ?? null);
  const bar = document.createElement("nav");
  bar.setAttribute("aria-label", "本地 Debug");
  bar.style.cssText =
    "display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid #60636b;background:#202226;color:#fff;font:13px sans-serif";
  const title = document.createElement("strong");
  title.textContent = "本地 Debug";
  bar.append(title);
  const scenes = [
    ["anonymous", "browse", "匿名浏览"],
    ["member", "browse", "用户浏览"],
    ["member", "projects", "我的项目 / 编辑"],
    ["member", "create", "创建项目"],
    ["member", "subs", "订阅"],
    ["reviewer", "admin", "审核工作台"],
    ["owner", "tools", "站长工具"],
  ] as const;
  const select = document.createElement("select");
  select.setAttribute("aria-label", "预览界面");
  for (const [sceneRole, view, label] of scenes) {
    const option = document.createElement("option");
    option.value = `${sceneRole}:${view}`;
    option.textContent = label;
    option.selected = sceneRole === role && view === (params.get("debug-view") ?? "browse");
    select.append(option);
  }
  select.addEventListener("change", () => {
    const [nextRole, view] = select.value.split(":");
    if (!nextRole || !view) return;
    const url = new URL(location.href);
    url.searchParams.set("debug-role", nextRole);
    url.searchParams.set("debug-view", view);
    location.assign(url);
  });
  bar.append(select);
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "重置布局";
  reset.addEventListener("click", () => {
    localStorage.removeItem("cw_catalogue_layout");
    localStorage.removeItem("cw_sidebar_collapsed");
    location.reload();
  });
  bar.append(reset);
  document.body.prepend(bar);
}

import { type SetStateAction, useCallback, useEffect, useRef, useState } from "react";

export type WorkshopView = "browse" | "projects" | "create" | "subs" | "admin" | "tools" | "installed";

const SIDEBAR_STORAGE_KEY = "cw_sidebar_collapsed";
const SIDEBAR_MOBILE_QUERY = "(max-width: 1023px)";
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(SIDEBAR_MOBILE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(SIDEBAR_MOBILE_QUERY);
    const update = (): void => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isMobile;
}
export function useWorkshopNavigation() {
  const [view, updateView] = useState<WorkshopView>(() => {
    const requested = import.meta.env.DEV ? new URLSearchParams(location.search).get("debug-view") : null;
    return requested === "projects" ||
      requested === "create" ||
      requested === "subs" ||
      requested === "admin" ||
      requested === "tools" ||
      requested === "installed"
      ? requested
      : "browse";
  });
  const dirty = useRef(false);
  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  function confirmLeave(): boolean {
    if (dirty.current && !window.confirm("有未保存的修改，确定放弃并离开？")) return false;
    dirty.current = false;
    return true;
  }
  function setView(next: SetStateAction<WorkshopView>): boolean {
    const target = typeof next === "function" ? next(view) : next;
    if (target !== view && !confirmLeave()) return false;
    updateView(target);
    return true;
  }
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const observer = new ResizeObserver(() => {
      header.parentElement?.style.setProperty("--header-height", `${header.getBoundingClientRect().height}px`);
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const drawerToggle = useRef<HTMLButtonElement>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);
  const previousDrawerContext = useRef({ view, isMobile });
  useEffect(() => {
    if (previousDrawerContext.current.view !== view || previousDrawerContext.current.isMobile !== isMobile) {
      previousDrawerContext.current = { view, isMobile };
      setSidebarOpen(false);
    }
  }, [view, isMobile]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* storage may be unavailable */
    }
  }, [sidebarCollapsed]);
  useEffect(() => {
    if (!isMobile || !sidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => drawerClose.current?.focus());
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      } else if (event.key === "Tab") {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            "#workshop-sidebar button:not(:disabled), #workshop-sidebar input, #workshop-sidebar a[href]",
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!document.getElementById("workshop-sidebar")?.contains(document.activeElement)) {
          event.preventDefault();
          first?.focus();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", dismiss);
      queueMicrotask(() => {
        const toggle = drawerToggle.current;
        if (toggle && toggle.getClientRects().length > 0) toggle.focus();
        else document.querySelector<HTMLButtonElement>(".sidebar-toggle")?.focus();
      });
    };
  }, [isMobile, sidebarOpen]);
  return {
    onDirtyChange,
    confirmLeave,
    view,
    setView,
    setSidebarOpen,
    headerRef,
    isMobile,
    sidebarOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    drawerToggle,
    drawerClose,
  };
}

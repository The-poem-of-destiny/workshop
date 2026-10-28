import { useRef, useState } from "react";
import { type AdminAuditEvent, api } from "./api";

type AdminAuditOptions = { onError: (message: string) => void };
export function useAdminAudit({ onError }: AdminAuditOptions) {
  const [audit, setAudit] = useState<AdminAuditEvent[]>([]);
  const [auditAction, setAuditAction] = useState("");
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  /** Bumped by every audit load so a slower, older request cannot overwrite newer results or the cursor. */
  const auditGeneration = useRef(0);
  async function loadAudit(action: string, cursor?: string): Promise<void> {
    setAuditError(null);
    const generation = ++auditGeneration.current;
    if (cursor) {
      setAuditLoadingMore(true);
    } else {
      setAuditBusy(true);
      // A fresh first page invalidates pagination from the previous filter result set.
      setAuditCursor(null);
      setAudit([]);
    }
    try {
      const result = await api.auditEvents({ action: action || undefined, cursor });
      if (generation !== auditGeneration.current) return;
      setAudit((previous) => (cursor ? [...previous, ...result.items] : result.items));
      setAuditCursor(result.nextCursor);
    } catch (value) {
      if (generation !== auditGeneration.current) return;
      onError(`审计日志加载失败：${String(value)}`);
      setAuditError(`审计日志加载失败：${String(value)}`);
    } finally {
      if (generation === auditGeneration.current) {
        setAuditBusy(false);
        setAuditLoadingMore(false);
      }
    }
  }

  function changeAuditAction(action: string): void {
    setAuditAction(action);
    void loadAudit(action);
  }
  return { auditBusy, loadAudit, auditAction, changeAuditAction, audit, auditCursor, auditLoadingMore, auditError };
}

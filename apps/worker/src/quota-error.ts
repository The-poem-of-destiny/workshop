export function quotaExceededMessage(nowMs = Date.now()): string {
  const now = new Date(nowMs);
  const resetMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const mins = Math.max(1, Math.ceil((resetMs - nowMs) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const eta = h > 0 ? `${h} 小时 ${m} 分钟` : `${m} 分钟`;
  return `今日工坊访问量较大，云端数据库额度已用完，预计 ${eta} 后（北京时间 08:00）自动刷新，请稍后再来。`;
}

export function quotaErrorDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return raw.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]").slice(0, 240);
}

export function isStorageQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    /SQLITE_TOOBIG|near\s+"?LIMIT"?|(?:row|statement|string|blob|expression|variable)\s+(?:too\s+(?:big|long|large)|size\s+limit)/i.test(
      message,
    )
  ) {
    return false;
  }
  return /(?:daily\s+row\s+(?:read|write)\s+limit|free\s+tier\b.*\blimit\b|(?:account|storage|database|d1|r2)\s+quota\b|\bquota\s+exceeded\b)/i.test(
    message,
  );
}

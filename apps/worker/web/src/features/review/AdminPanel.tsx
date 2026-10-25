import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AdminSubmissionDetail,
  AdminSubmissionListItem,
  AdminSubmissionListResponse,
  SubmissionDiff,
} from "../../api";
import { ApiError, api } from "../../api";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { CheckReportSection } from "./CheckReportView";
import { bookLabel, gateLabels, isBlockingFinding, parseCheckReport } from "./check-report";
import { buildReviewMarkdown, reviewMarkdownFileName, saveReviewMarkdown } from "./export-markdown";
import { clearSubmissionSource, loadSubmissionSource } from "./source-files";
import "./review.css";

type EvidenceKind = "worldbook" | "regex" | "cover";

const checkStatusLabels: Record<string, string> = {
  queued: "排队中",
  running: "检查中",
  done: "已完成",
  needs_human: "需人工确认",
  failed: "失败",
};

type QueueCheckStatus = AdminSubmissionListItem["checkStatus"];

const knownCheckStatuses: readonly QueueCheckStatus[] = ["queued", "running", "done", "needs_human", "failed"];

/** The detail DTO widens the check status to a string; map it back onto the queue contract. */
function toQueueCheckStatus(value: string): QueueCheckStatus | null {
  return knownCheckStatuses.find((status) => status === value) ?? null;
}

const kindLabels: Record<EvidenceKind, string> = {
  worldbook: "世界书",
  regex: "正则",
  cover: "封面",
};

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

function diffEntries(kind: SubmissionDiff["worldbook"]): Array<{
  key: string;
  entryKey: string;
  name: string;
  change: "added" | "modified" | "deleted";
  changedFields?: string[];
}> {
  return [
    ...kind.added.map((item) => ({
      key: `added-${item.entryKey}`,
      entryKey: item.entryKey,
      name: item.name,
      change: "added" as const,
    })),
    ...kind.modified.map((item) => ({
      key: `modified-${item.entryKey}`,
      entryKey: item.entryKey,
      name: item.name,
      changedFields: item.changedFields,
      change: "modified" as const,
    })),
    ...kind.deleted.map((item) => ({
      key: `deleted-${item.entryKey}`,
      entryKey: item.entryKey,
      name: item.name,
      change: "deleted" as const,
    })),
  ];
}

export function AdminPanel({
  onError,
  onNotice,
}: {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [items, setItems] = useState<AdminSubmissionListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminSubmissionDetail | null>(null);
  const [diff, setDiff] = useState<SubmissionDiff | null>(null);
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [counts, setCounts] = useState<AdminSubmissionListResponse["counts"] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [downloadKind, setDownloadKind] = useState<EvidenceKind | null>(null);
  const selectedRef = useRef<string | null>(null);
  const cache = useRef(new Map<string, { detail: AdminSubmissionDetail; diff: SubmissionDiff }>());
  const inflight = useRef(new Map<string, Promise<{ detail: AdminSubmissionDetail; diff: SubmissionDiff }>>());

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      [item.projectTitle, item.author.name, item.id, item.status, item.gate ?? "", item.checkStatus]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [items, query]);

  const report = useMemo(() => {
    if (!detail) return null;
    return parseCheckReport(detail.submission.checkReport) ?? parseCheckReport(detail.checkRuns[0]?.report);
  }, [detail]);

  const latestRun = detail?.checkRuns[0] ?? null;
  const routeGate = latestRun?.routeGate ?? report?.routeGate ?? null;
  const checkFailed = detail?.submission.checkStatus === "failed";
  const checking = detail
    ? detail.submission.checkStatus === "queued" || detail.submission.checkStatus === "running"
    : false;
  /** No usable server gate: the decision has to be recorded as a manual approval. */
  const manualApproval =
    Boolean(detail) &&
    (routeGate === "block" ||
      routeGate === null ||
      checkFailed ||
      detail?.submission.clientGate === "missing" ||
      detail?.submission.clientGate === "block");
  const blockingFindings = (report?.findings ?? []).filter(isBlockingFinding);
  const position = selectedId ? visibleItems.findIndex((item) => item.id === selectedId) + 1 : 0;
  const trimmedReason = reason.trim();
  const confirmDisabled =
    decision === "reject"
      ? trimmedReason.length === 0
      : decision === "approve" && manualApproval
        ? trimmedReason.length < 8
        : false;

  async function loadDetail(id: string): Promise<{ detail: AdminSubmissionDetail; diff: SubmissionDiff }> {
    const cached = cache.current.get(id);
    if (cached) return cached;
    const pending = inflight.current.get(id);
    if (pending) return pending;
    const request = Promise.all([api.adminSubmission(id), api.adminDiff(id)])
      .then(([nextDetail, nextDiff]) => {
        const value = { detail: nextDetail, diff: nextDiff };
        cache.current.set(id, value);
        return value;
      })
      .finally(() => inflight.current.delete(id));
    inflight.current.set(id, request);
    return request;
  }

  function nextId(id: string): string | null {
    const index = items.findIndex((item) => item.id === id);
    return index >= 0 ? (items[index + 1]?.id ?? null) : null;
  }

  function prefetch(id: string | null): void {
    if (!id || cache.current.has(id) || inflight.current.has(id)) return;
    void loadDetail(id).catch(() => undefined);
  }

  function clearSelection(): void {
    selectedRef.current = null;
    setSelectedId(null);
    setDetail(null);
    setDiff(null);
    setDetailError(null);
    setLoadingDetail(false);
    setPolling(false);
    setDecision(null);
    setReason("");
  }

  async function refresh(): Promise<void> {
    setLoadingQueue(true);
    setQueueError(null);
    try {
      const result = await api.adminSubmissions("pending");
      setItems(result.items);
      setCounts(result.counts);
      setNextCursor(result.nextCursor);
      if (selectedRef.current && !result.items.some((item) => item.id === selectedRef.current)) clearSelection();
    } catch (value) {
      const message = String(value);
      setQueueError(message);
      onError(message);
    } finally {
      setLoadingQueue(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api.adminSubmissions("pending", nextCursor);
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...result.items.filter((item) => !seen.has(item.id))];
      });
      setCounts(result.counts);
      setNextCursor(result.nextCursor);
    } catch (value) {
      onError(String(value));
    } finally {
      setLoadingMore(false);
    }
  }

  function advance(currentId: string): void {
    const index = visibleItems.findIndex((item) => item.id === currentId);
    const remainingVisible = visibleItems.filter((item) => item.id !== currentId);
    const next =
      remainingVisible.length > 0 ? remainingVisible[Math.min(Math.max(index, 0), remainingVisible.length - 1)] : null;
    const remaining = items.filter((item) => item.id !== currentId);
    setItems(remaining);
    if (next) void select(next.id);
    else clearSelection();
    if (remaining.length < 5 && nextCursor) void loadMore();
  }

  async function select(id: string): Promise<void> {
    if (selectedRef.current !== id) setPolling(false);
    selectedRef.current = id;
    setSelectedId(id);
    setDetailError(null);
    setReason("");
    setDecision(null);
    const cached = cache.current.get(id);
    if (cached) {
      setDetail(cached.detail);
      setDiff(cached.diff);
      setLoadingDetail(false);
      setPolling(
        cached.detail.submission.checkStatus === "queued" || cached.detail.submission.checkStatus === "running",
      );
      prefetch(nextId(id));
      return;
    }
    setLoadingDetail(true);
    setDetail(null);
    setDiff(null);
    try {
      const value = await loadDetail(id);
      if (selectedRef.current !== id) return;
      setDetail(value.detail);
      setDiff(value.diff);
      setPolling(value.detail.submission.checkStatus === "queued" || value.detail.submission.checkStatus === "running");
      prefetch(nextId(id));
    } catch (value) {
      const message = String(value);
      setDetailError(message);
      onError(message);
    } finally {
      if (selectedRef.current === id) setLoadingDetail(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Polls the open submission while its check is queued/running; never advances the queue.
  useEffect(() => {
    if (!polling || !selectedId) return;
    const id = selectedId;
    let cancelled = false;
    let timer: number | undefined;
    const startedAt = Date.now();
    const settle = (message: string, nextStatus?: QueueCheckStatus) => {
      if (cancelled) return;
      setPolling(false);
      if (nextStatus) {
        const status = nextStatus;
        setItems((previous) => previous.map((item) => (item.id === id ? { ...item, checkStatus: status } : item)));
        setCounts((previous) =>
          previous
            ? { ...previous, checking: Math.max(0, previous.checking - 1), pending: previous.pending + 1 }
            : previous,
        );
      }
      onNotice(message);
    };
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > 120_000) {
        settle("检查仍未结束，请稍后手动刷新。");
        return;
      }
      try {
        const next = await api.adminSubmission(id);
        if (cancelled || selectedRef.current !== id) return;
        setDetail(next);
        cache.current.delete(id);
        setItems((previous) =>
          previous.map((item) =>
            item.id === id
              ? { ...item, checkStatus: toQueueCheckStatus(next.submission.checkStatus) ?? item.checkStatus }
              : item,
          ),
        );
        if (next.submission.checkStatus !== "queued" && next.submission.checkStatus !== "running") {
          try {
            const nextDiff = await api.adminDiff(id);
            if (cancelled || selectedRef.current !== id) return;
            setDiff(nextDiff);
          } catch {
            // The diff refresh is best-effort; the report is the primary evidence.
          }
          if (next.submission.status !== "pending") {
            setPolling(false);
            onNotice("这条提交已不在待审队列，报告已刷新。");
            void refresh();
            return;
          }
          settle("检查已完成，报告已刷新。", toQueueCheckStatus(next.submission.checkStatus) ?? undefined);
          return;
        }
        timer = window.setTimeout(() => void tick(), 4000);
      } catch (value) {
        if (cancelled) return;
        setPolling(false);
        onError(String(value));
      }
    };
    timer = window.setTimeout(() => void tick(), 4000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [polling, selectedId]);

  function openDecision(kind: "approve" | "reject"): void {
    setReason("");
    setDecision(kind);
  }

  function snooze(): void {
    if (!selectedId) return;
    const current = items.find((item) => item.id === selectedId);
    if (!current) return;
    setItems((previous) => [...previous.filter((item) => item.id !== selectedId), current]);
    onNotice("已把当前提交移到队列末尾，稍后再处理。");
  }

  async function reloadSelection(id: string): Promise<AdminSubmissionDetail | null> {
    cache.current.delete(id);
    inflight.current.delete(id);
    try {
      const value = await loadDetail(id);
      if (selectedRef.current !== id) return value.detail;
      setDetail(value.detail);
      setDiff(value.diff);
      return value.detail;
    } catch (value) {
      onError(String(value));
      return null;
    }
  }

  async function submitDecision(): Promise<void> {
    if (!decision || !detail || !selectedId) return;
    const currentDecision = decision;
    const currentId = selectedId;
    if (currentDecision === "reject" && !trimmedReason) {
      onError("拒绝审核必须填写理由。");
      return;
    }
    if (currentDecision === "approve" && manualApproval && trimmedReason.length < 8) {
      onError("人工批准需要至少 8 个字符的说明。");
      return;
    }
    setBusy(true);
    try {
      await api.adminReview(currentId, {
        decision: currentDecision,
        reason: trimmedReason || undefined,
        revisionId: detail.revision.id,
        manifestHash: detail.revision.manifestHash ?? undefined,
        reportHash: detail.submission.checkReportHash ?? undefined,
      });
      setDecision(null);
      setReason("");
      onNotice(currentDecision === "approve" ? "已通过审核。" : "已拒绝审核。");
      clearSubmissionSource(currentId);
      cache.current.delete(currentId);
      inflight.current.delete(currentId);
      setCounts((previous) => {
        if (!previous) return previous;
        const decremented = Math.max(0, previous.pending - 1);
        return currentDecision === "approve"
          ? { ...previous, pending: decremented, approved: previous.approved + 1 }
          : { ...previous, pending: decremented, rejected: previous.rejected + 1 };
      });
      advance(currentId);
    } catch (value) {
      if (value instanceof ApiError && value.status === 409) {
        setDecision(null);
        setReason("");
        onError("提交状态或版本已变化（409），已重新加载这条提交，请核对后再次决定。");
        const next = await reloadSelection(currentId);
        if (next && next.submission.status !== "pending") {
          setItems((previous) => previous.filter((item) => item.id !== currentId));
          if (selectedRef.current === currentId) clearSelection();
          void refresh();
        }
      } else {
        onError(String(value));
      }
    } finally {
      setBusy(false);
    }
  }

  async function recheck(): Promise<void> {
    if (!selectedId) return;
    const currentId = selectedId;
    setBusy(true);
    try {
      const result = await api.adminRecheck(currentId);
      setCounts((previous) =>
        previous
          ? { ...previous, pending: Math.max(0, previous.pending - 1), checking: previous.checking + 1 }
          : previous,
      );
      cache.current.delete(currentId);
      const nextStatus: QueueCheckStatus = toQueueCheckStatus(result.status) ?? "queued";
      setDetail((previous) =>
        previous ? { ...previous, submission: { ...previous.submission, checkStatus: nextStatus } } : previous,
      );
      setItems((previous) =>
        previous.map((item) => (item.id === currentId ? { ...item, checkStatus: nextStatus } : item)),
      );
      setPolling(true);
      onNotice("已重新排队检查，完成后会自动刷新当前提交。");
    } catch (value) {
      onError(String(value));
    } finally {
      setBusy(false);
    }
  }

  async function exportMarkdown(): Promise<void> {
    if (!detail || !selectedId) return;
    setExporting(true);
    try {
      const sources = await Promise.all([
        loadSubmissionSource(selectedId, "worldbook"),
        loadSubmissionSource(selectedId, "regex"),
      ]);
      const markdown = buildReviewMarkdown({ detail, report, diff, sources, reason: trimmedReason });
      const copied = await saveReviewMarkdown(markdown, reviewMarkdownFileName(detail));
      onNotice(
        copied
          ? "已下载复核 Markdown，并复制到剪贴板。"
          : "已下载复核 Markdown；浏览器拒绝剪贴板写入，请使用下载的文件。",
      );
    } catch (value) {
      onError(String(value));
    } finally {
      setExporting(false);
    }
  }

  async function download(kind: EvidenceKind): Promise<void> {
    if (!selectedId) return;
    setDownloadKind(kind);
    try {
      const blob = await api.adminFile(selectedId, kind);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selectedId}-${kind}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (value) {
      onError(String(value));
    } finally {
      setDownloadKind(null);
    }
  }

  function moveSelection(direction: -1 | 1): void {
    if (!visibleItems.length) return;
    const index = selectedId ? visibleItems.findIndex((item) => item.id === selectedId) : -1;
    const next = visibleItems[Math.min(Math.max(index + direction, 0), visibleItems.length - 1)];
    if (next) void select(next.id);
  }

  return (
    <div className="review-workbench" data-testid="review-workbench">
      <header className="review-header">
        <div>
          <p className="review-eyebrow">CONTENT REVIEW</p>
          <h2>审核台</h2>
          <p className="review-subtitle">只显示待审核提交。先确认检查证据，再决定是否发布。</p>
        </div>
        <button
          className="review-button review-button-secondary"
          type="button"
          onClick={() => void refresh()}
          disabled={loadingQueue}
        >
          {loadingQueue ? "刷新中..." : "刷新队列"}
        </button>
      </header>

      <section className="review-counts" aria-label="提交状态计数">
        {counts ? (
          <>
            <span>
              <b>{counts.pending}</b> 待审核
            </span>
            <span>
              <b>{counts.checking}</b> 检查中
            </span>
            <span>
              <b>{counts.approved}</b> 已通过
            </span>
            <span>
              <b>{counts.rejected}</b> 已拒绝
            </span>
          </>
        ) : (
          <span className="review-muted">状态计数加载中...</span>
        )}
      </section>

      <div className="review-search">
        <label htmlFor="review-queue-search">搜索当前队列</label>
        <input
          id="review-queue-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="项目、作者、提交 ID 或 gate"
          autoComplete="off"
        />
        <span className="review-search-count">
          {visibleItems.length}/{items.length}
        </span>
      </div>

      <div className="review-columns">
        <aside className={`review-queue${selectedId ? " review-queue-has-selection" : ""}`} aria-label="待审核队列">
          <div className="review-section-heading">
            <div>
              <h3>待审核队列</h3>
              <p>{items.length ? "选择一项查看完整证据" : "当前页没有待处理提交"}</p>
            </div>
            <span className="review-queue-total" data-testid="review-queue-count">
              已加载 {items.length} / 待审 {counts?.pending ?? "…"}
            </span>
          </div>
          {loadingQueue && items.length === 0 ? (
            <p className="review-state" role="status">
              正在加载队列...
            </p>
          ) : queueError && items.length === 0 ? (
            <div className="review-state review-state-error" role="alert">
              <strong>队列加载失败</strong>
              <span>{queueError}</span>
              <button className="review-button review-button-secondary" type="button" onClick={() => void refresh()}>
                重试
              </button>
            </div>
          ) : items.length === 0 ? (
            <p className="review-state">暂无待处理提交。</p>
          ) : visibleItems.length === 0 ? (
            <p className="review-state">当前搜索没有匹配项。</p>
          ) : (
            <div className="review-queue-list">
              {visibleItems.map((item) => (
                <button
                  className={`review-queue-item${item.id === selectedId ? " is-selected" : ""}`}
                  type="button"
                  aria-current={item.id === selectedId ? "true" : undefined}
                  key={item.id}
                  onClick={() => void select(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      moveSelection(1);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      moveSelection(-1);
                    }
                  }}
                  onMouseEnter={() => prefetch(item.id)}
                  onFocus={() => prefetch(item.id)}
                  data-testid="review-queue-item"
                >
                  <span className="review-queue-item-main">
                    <strong>{item.projectTitle}</strong>
                    <span>{item.author.name}</span>
                    <small>
                      {formatDate(item.submittedAt)} · {checkStatusLabels[item.checkStatus] ?? item.checkStatus}
                    </small>
                  </span>
                  <span className={`review-gate review-gate-${item.gate ?? "missing"}`}>{item.gate ?? "missing"}</span>
                </button>
              ))}
            </div>
          )}
          {nextCursor ? (
            <button className="review-load-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "加载中..." : "加载更多提交"}
            </button>
          ) : null}
        </aside>

        <main className={`review-evidence${selectedId ? " review-evidence-visible" : ""}`} aria-live="polite">
          {selectedId ? (
            <button className="review-mobile-back" type="button" onClick={clearSelection}>
              返回队列
            </button>
          ) : null}
          {loadingDetail ? (
            <div className="review-state review-detail-state" role="status">
              正在加载提交证据...
            </div>
          ) : detailError ? (
            <div className="review-state review-state-error review-detail-state" role="alert">
              <strong>证据加载失败</strong>
              <span>{detailError}</span>
              {selectedId ? (
                <button
                  className="review-button review-button-secondary"
                  type="button"
                  onClick={() => void select(selectedId)}
                >
                  重试
                </button>
              ) : null}
            </div>
          ) : detail ? (
            <>
              {checking ? (
                <p className="review-polling" role="status">
                  排队检查中，报告完成后会自动刷新当前提交（不会跳转到下一条）。
                </p>
              ) : null}

              <section className="review-evidence-intro">
                <div>
                  <p className="review-eyebrow">SUBMISSION #{detail.revision.revisionNo}</p>
                  <h2>{detail.project.title}</h2>
                  <p className="review-description">
                    {detail.revision.description || detail.project.description || "未提供项目描述。"}
                  </p>
                  {detail.revision.authorNote ? (
                    <div className="review-author-note">
                      <strong>作者备注</strong>
                      <p>{detail.revision.authorNote}</p>
                      <small>提交者提供，仅作参考。</small>
                    </div>
                  ) : null}
                </div>
                <div className="review-submission-id">
                  <span>提交 ID</span>
                  <code>{detail.submission.id}</code>
                </div>
              </section>

              <div className="review-toolbar">
                <button
                  className="review-button review-button-secondary"
                  type="button"
                  disabled={!selectedId}
                  onClick={snooze}
                >
                  稍后处理
                </button>
                <button
                  className="review-button review-button-secondary"
                  type="button"
                  disabled={busy || checking}
                  onClick={() => void recheck()}
                >
                  重新检查
                </button>
                <button
                  className="review-button review-button-secondary"
                  type="button"
                  disabled={exporting}
                  onClick={() => void exportMarkdown()}
                >
                  {exporting ? "导出中..." : "导出复核 Markdown"}
                </button>
              </div>

              <dl className="review-facts">
                <div>
                  <dt>作者</dt>
                  <dd>{detail.project.author.name}</dd>
                </div>
                <div>
                  <dt>提交时间</dt>
                  <dd>{formatDate(detail.submission.submittedAt)}</dd>
                </div>
                <div>
                  <dt>revision</dt>
                  <dd>#{detail.revision.revisionNo}</dd>
                </div>
                <div>
                  <dt>客户端 gate</dt>
                  <dd>{detail.submission.clientGate ?? "missing"}</dd>
                </div>
                <div>
                  <dt>检查状态</dt>
                  <dd>{checkStatusLabels[detail.submission.checkStatus] ?? detail.submission.checkStatus}</dd>
                </div>
                <div>
                  <dt>服务端门禁</dt>
                  <dd className={`review-gate review-gate-${routeGate ?? "missing"}`}>
                    {gateLabels[routeGate ?? "missing"] ?? routeGate ?? "missing"}
                  </dd>
                </div>
                <div>
                  <dt>检查次数</dt>
                  <dd>{detail.submission.checkAttempts}</dd>
                </div>
                <div>
                  <dt>manifest hash</dt>
                  <dd>
                    <code>{detail.revision.manifestHash ?? "未记录"}</code>
                  </dd>
                </div>
                <div>
                  <dt>报告 hash</dt>
                  <dd>
                    <code>{detail.submission.checkReportHash ?? "未记录"}</code>
                  </dd>
                </div>
              </dl>

              <CheckReportSection
                key={detail.submission.id}
                submissionId={detail.submission.id}
                report={report}
                raw={detail.submission.checkReport ?? latestRun?.report ?? null}
                checkStatus={detail.submission.checkStatus}
                routeGate={routeGate}
                checkError={detail.submission.checkError}
                checkedAt={latestRun ? formatDate(latestRun.createdAt) : null}
                checkerRevision={latestRun?.reviewCheckerRevision ?? detail.submission.reviewCheckerRevision ?? null}
              />

              <section className="review-section">
                <div className="review-section-heading">
                  <div>
                    <h3>变更证据</h3>
                    <p>当前 revision 与上一版本的完整差异。</p>
                  </div>
                  {diff ? (
                    <span className="review-diff-total">
                      {diff.findings.added.length + diff.findings.changed.length + diff.findings.removed.length}{" "}
                      条检查差异
                    </span>
                  ) : null}
                </div>
                {diff ? (
                  <>
                    <div className="review-finding-summary">
                      <span>
                        保留 <b>{diff.findings.accepted.length}</b>
                      </span>
                      <span>
                        变更 <b>{diff.findings.changed.length}</b>
                      </span>
                      <span>
                        新增 <b>{diff.findings.added.length}</b>
                      </span>
                      <span>
                        移除 <b>{diff.findings.removed.length}</b>
                      </span>
                    </div>
                    <div className="review-diff-grid">
                      {(["worldbook", "regex"] as const).map((kind) => {
                        const entries = diffEntries(diff[kind]);
                        return (
                          <div className="review-diff-group" key={kind}>
                            <h4>{kindLabels[kind]}</h4>
                            <p>
                              新增 {diff[kind].added.length} · 修改 {diff[kind].modified.length} · 删除{" "}
                              {diff[kind].deleted.length} · 未变 {diff[kind].unchanged}
                            </p>
                            {entries.length ? (
                              <ul>
                                {entries.map((entry) => (
                                  <li key={entry.key}>
                                    <span className={`review-change review-change-${entry.change}`}>
                                      {entry.change === "added" ? "+" : entry.change === "modified" ? "~" : "-"}
                                    </span>
                                    <span>
                                      {entry.name}{" "}
                                      <small>
                                        ({entry.entryKey})
                                        {entry.changedFields?.length ? ` · ${entry.changedFields.join(", ")}` : ""}
                                      </small>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="review-muted">没有条目差异</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="review-cover-diff">
                      <strong>封面</strong>
                      <span>{diff.cover.changed ? "已变更" : "未变更"}</span>
                      <small>
                        上一版本 {diff.cover.beforeSha256 ?? "无"} · 当前版本 {diff.cover.afterSha256 ?? "无"}
                      </small>
                    </div>
                    <div className="review-findings">
                      {(["accepted", "changed", "added", "removed"] as const).map((group) => (
                        <details key={group}>
                          <summary>
                            {group === "accepted"
                              ? "已接受规则"
                              : group === "changed"
                                ? "规则有变化"
                                : group === "added"
                                  ? "新增规则"
                                  : "移除规则"}{" "}
                            ({diff.findings[group].length})
                          </summary>
                          {diff.findings[group].length ? (
                            <ul>
                              {diff.findings[group].map((finding, index) => (
                                <li key={`${finding.ruleId}-${finding.file ?? "unknown"}-${index}`}>
                                  <strong>{finding.severity}</strong>
                                  <span>{finding.message}</span>
                                  <small>
                                    {finding.file ?? "未标记文件"}
                                    {finding.line === null ? "" : `:${finding.line}`}
                                  </small>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="review-muted">没有记录。</p>
                          )}
                        </details>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="review-muted">差异加载中或暂无差异。</p>
                )}
              </section>

              <section className="review-section">
                <div className="review-section-heading">
                  <div>
                    <h3>文件证据</h3>
                    <p>审核员可下载原始提交文件进行核对。</p>
                  </div>
                </div>
                <div className="review-assets">
                  {(["worldbook", "regex", "cover"] as const).map((kind) => {
                    const asset = detail.assets.find((item) => item.kind === kind);
                    return (
                      <div className="review-asset" key={kind}>
                        <div>
                          <strong>{kindLabels[kind]}</strong>
                          <span>
                            {asset
                              ? `${asset.mime} · ${asset.bytes.toLocaleString()} bytes · sha256 ${asset.sha256}`
                              : "未提交"}
                          </span>
                        </div>
                        <button
                          className="review-button review-button-secondary"
                          type="button"
                          disabled={!asset || downloadKind !== null}
                          onClick={() => void download(kind)}
                        >
                          {downloadKind === kind ? "准备中..." : "下载证据"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              <div className="review-action-bar" data-testid="review-action-bar">
                <button
                  className="review-button review-button-secondary"
                  type="button"
                  disabled={position <= 1}
                  onClick={() => moveSelection(-1)}
                >
                  上一个
                </button>
                <span className="review-action-position">
                  {position > 0 ? position : "–"}/{visibleItems.length}
                </span>
                <button
                  className="review-button review-button-secondary"
                  type="button"
                  disabled={position <= 0 || position >= visibleItems.length}
                  onClick={() => moveSelection(1)}
                >
                  下一个
                </button>
                <span className="review-action-spacer" />
                <button
                  className="review-button review-button-primary"
                  type="button"
                  disabled={busy || checking}
                  title={checking ? "检查完成前不能批准" : undefined}
                  onClick={() => openDecision("approve")}
                  data-testid="review-approve"
                >
                  {manualApproval ? "人工批准" : "批准"}
                </button>
                <button
                  className="review-button review-button-danger"
                  type="button"
                  disabled={busy}
                  onClick={() => openDecision("reject")}
                  data-testid="review-reject"
                >
                  拒绝
                </button>
              </div>
            </>
          ) : (
            <div className="review-empty-detail">
              <span className="review-empty-mark">+</span>
              <h2>选择一项提交</h2>
              <p>从左侧队列打开审核证据。审核完成后，下一条会自动接续。</p>
            </div>
          )}
        </main>
      </div>

      <ConfirmDialog
        open={decision !== null}
        title={decision === "reject" ? "确认拒绝这条提交？" : manualApproval ? "确认人工批准？" : "确认批准这条提交？"}
        description={
          decision === "reject"
            ? "拒绝后提交退回作者，理由会展示给作者。"
            : manualApproval
              ? "服务端门禁为阻断或缺失，或检查未通过。这次批准会记录为人工批准，说明会随审核记录保存。"
              : "批准后提交进入发布流程，决定会记录在案。"
        }
        confirmLabel={decision === "reject" ? "确认拒绝" : manualApproval ? "确认人工批准" : "确认批准"}
        danger={decision === "reject"}
        busy={busy}
        confirmDisabled={confirmDisabled}
        onConfirm={() => void submitDecision()}
        onCancel={() => {
          if (busy) return;
          setDecision(null);
          setReason("");
        }}
      >
        {decision === "approve" && manualApproval ? (
          <div className="review-manual-gate">
            <strong>人工批准依据</strong>
            <p>
              服务端门禁：{gateLabels[routeGate ?? "missing"] ?? routeGate ?? "missing"}
              {checkFailed ? " · 检查失败" : ""}
            </p>
            {blockingFindings.length ? (
              <ul>
                {blockingFindings.map((finding, index) => (
                  <li key={`${finding.ruleId}-${index}`}>
                    <code>{finding.ruleId}</code>
                    <span>{finding.title || "阻断项"}</span>
                    <small>
                      {bookLabel(finding.book) || "未标记文件"}
                      {finding.line === null ? "" : `:${finding.line}`}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="review-muted">报告没有列出具体阻断规则，请结合检查报告确认。</p>
            )}
          </div>
        ) : null}
        <label className="review-reason">
          <span>
            {decision === "reject"
              ? "拒绝理由（必填）"
              : manualApproval
                ? "人工批准说明（至少 8 个字符）"
                : "审核说明（可选）"}
          </span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              decision === "reject"
                ? "说明拒绝原因，方便作者修改"
                : manualApproval
                  ? "说明为什么在阻断/缺少检查情况下仍然批准"
                  : "补充审核依据（可选）"
            }
            maxLength={4000}
            rows={4}
          />
          <small>{trimmedReason.length}/4000</small>
        </label>
      </ConfirmDialog>
    </div>
  );
}

import { useMemo } from "react";
import { ApiError, api, getSessionGeneration } from "../../api";
import { isBlockingFinding, parseCheckReport } from "./check-report";
import { clearSubmissionSource } from "./source-files";
import type { useReviewQueue } from "./useReviewQueue";
import { useReviewRecheck } from "./useReviewRecheck";

type ReviewDecisionOptions = Pick<
  ReturnType<typeof useReviewQueue>,
  | "detail"
  | "reason"
  | "decision"
  | "setReason"
  | "setDecision"
  | "selectedId"
  | "setBusy"
  | "invalidateDetail"
  | "setDiff"
  | "setCounts"
  | "advance"
  | "reloadSelection"
  | "setItems"
  | "selectedRef"
  | "clearSelection"
  | "refresh"
  | "setDetail"
  | "setPolling"
> & { onError: (message: string) => void; onNotice: (message: string) => void };
export function useReviewDecision({
  detail,
  reason,
  decision,
  setReason,
  setDecision,
  selectedId,
  setBusy,
  invalidateDetail,
  setDiff,
  setCounts,
  advance,
  reloadSelection,
  setItems,
  selectedRef,
  clearSelection,
  refresh,
  setDetail,
  setPolling,
  onError,
  onNotice,
}: ReviewDecisionOptions) {
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
  const trimmedReason = reason.trim();
  const confirmDisabled =
    decision === "reject"
      ? trimmedReason.length === 0
      : decision === "approve" && manualApproval
        ? trimmedReason.length < 8
        : false;
  function openDecision(kind: "approve" | "reject"): void {
    setReason("");
    setDecision(kind);
  }
  async function submitDecision(): Promise<void> {
    if (!decision || !detail || !selectedId) return;
    const currentDecision = decision;
    const currentId = selectedId;
    const sessionGeneration = getSessionGeneration();
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
      if (sessionGeneration !== getSessionGeneration()) return;
      setDecision(null);
      setReason("");
      onNotice(currentDecision === "approve" ? "已通过审核。" : "已拒绝审核。");
      clearSubmissionSource(currentId);
      invalidateDetail(currentId);
      setCounts((previous) => {
        if (!previous) return previous;
        const decremented = Math.max(0, previous.pending - 1);
        return currentDecision === "approve"
          ? { ...previous, pending: decremented, approved: previous.approved + 1 }
          : { ...previous, pending: decremented, rejected: previous.rejected + 1 };
      });
      advance(currentId);
    } catch (value) {
      if (sessionGeneration !== getSessionGeneration()) return;
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

  const recheck = useReviewRecheck({
    selectedId,
    setBusy,
    setCounts,
    invalidateDetail,
    setDiff,
    setDetail,
    setItems,
    setPolling,
    onError,
    onNotice,
  });
  return {
    checking,
    recheck,
    routeGate,
    report,
    latestRun,
    openDecision,
    manualApproval,
    confirmDisabled,
    submitDecision,
    checkFailed,
    blockingFindings,
    trimmedReason,
  };
}

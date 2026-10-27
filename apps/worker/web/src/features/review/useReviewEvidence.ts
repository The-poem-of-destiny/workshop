import { useState } from "react";

import { api } from "../../api";

import { buildReviewMarkdown, reviewMarkdownFileName, saveReviewMarkdown } from "./export-markdown";
import { loadSubmissionSource } from "./source-files";
import type { useReviewDecision } from "./useReviewDecision";
import type { useReviewQueue } from "./useReviewQueue";

type EvidenceKind = "worldbook" | "regex" | "cover";

type ReviewEvidenceOptions = Pick<
  ReturnType<typeof useReviewQueue> & ReturnType<typeof useReviewDecision>,
  "detail" | "selectedId" | "report" | "diff" | "trimmedReason"
> & { onError: (message: string) => void; onNotice: (message: string) => void };
export function useReviewEvidence({
  detail,
  selectedId,
  report,
  diff,
  trimmedReason,
  onError,
  onNotice,
}: ReviewEvidenceOptions) {
  const [exporting, setExporting] = useState(false);
  const [downloadKind, setDownloadKind] = useState<EvidenceKind | null>(null);
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
  return { exporting, exportMarkdown, downloadKind, download };
}

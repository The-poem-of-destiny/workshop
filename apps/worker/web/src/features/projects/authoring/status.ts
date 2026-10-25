import type { AuthorSubmission } from "../../../api";

export const SUBMISSION_STATUS_LABELS: Record<AuthorSubmission["status"], string> = {
  pending: "待审核",
  checking: "检查中",
  approved: "已通过",
  rejected: "已退回",
  superseded: "已被新版本取代",
};

export const CHECK_STATUS_LABELS: Record<AuthorSubmission["checkStatus"], string> = {
  queued: "排队检查",
  running: "检查中",
  done: "已完成",
  needs_human: "需人工审核",
  failed: "检查失败",
};

export const GATE_TEXT: Record<string, string> = {
  pass: "通过",
  warn: "有提示",
  block: "未通过",
  missing: "未检查",
};

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

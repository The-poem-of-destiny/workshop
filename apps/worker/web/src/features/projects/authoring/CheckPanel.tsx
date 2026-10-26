import { keyedItems } from "../../../lib/keyedItems";
import {
  buildFixPrompt,
  buildReportMarkdown,
  copyToClipboard,
  downloadTextFile,
  type LocalCheck,
  SEVERITY_LABELS,
} from "./checker";
import type { RegexAsset, WorldbookAsset } from "./preview";

/** Client-side checker results: severity summary, per-entry groups and AI/report hand-off actions. */
export function CheckPanel({
  check,
  worldbook,
  regexAssets,
  onNotice,
  onError,
}: {
  check: LocalCheck;
  worldbook: WorldbookAsset | null;
  regexAssets: readonly RegexAsset[];
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const statusText =
    check.gate === "block"
      ? `发现 ${check.counts.high} 个阻断问题，需要修复后才能提交。`
      : check.gate === "warn"
        ? "有需要注意的提示，提交前需要确认。"
        : "已通过客户端自检。";
  const fileNames = check.files.map((file) => file.fileName).join("、");

  async function copy(text: string, label: string): Promise<void> {
    if (await copyToClipboard(text)) onNotice(`${label}已复制，可以直接贴给 AI。`);
    else onError("浏览器禁止自动复制，请改用「下载检查报告」。");
  }

  function download(): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadTextFile(`workshop-check-${stamp}.md`, buildReportMarkdown(check, worldbook, regexAssets));
    onNotice("检查报告已下载为 Markdown。");
  }

  return (
    <section className={`check-panel is-${check.gate}`}>
      <div className="check-heading">
        <div>
          <h3>客户端自检</h3>
          <p className={`check-status is-${check.gate}`}>{statusText}</p>
          <p className="field-hint">
            检查文件：{fileNames} · 引擎 {check.report.engine}
          </p>
        </div>
        <div className="check-actions">
          <button
            type="button"
            onClick={() => void copy(buildFixPrompt(check.warnings, worldbook, regexAssets), "全部修复提示")}
            disabled={check.warnings.length === 0}
          >
            复制给 AI 修复
          </button>
          <button type="button" onClick={download}>
            下载检查报告
          </button>
        </div>
      </div>
      <div className="check-counts">
        {(["high", "warn", "hint", "info"] as const).map((severity) => (
          <span className={`check-count is-${severity}`} key={severity}>
            {SEVERITY_LABELS[severity]} {check.counts[severity]}
          </span>
        ))}
      </div>
      {check.groups.length === 0 ? (
        <p className="asset-uploaded">没有发现问题。</p>
      ) : (
        <div className="check-groups">
          {check.groups.map((group) => {
            const blockingCount = group.findings.filter((finding) => finding.severity === "high").length;
            return (
              <details
                className={`check-group${group.blocking ? " is-blocking" : ""}`}
                key={group.key}
                open={group.blocking}
              >
                <summary>
                  <span className="check-group-label">{group.label}</span>
                  {group.book ? <span className="check-group-book">{group.book}</span> : null}
                  <span className="check-group-count">
                    {blockingCount > 0 ? `阻断 ${blockingCount}` : `${group.findings.length} 条`}
                  </span>
                </summary>
                <div className="check-group-body">
                  {keyedItems(group.findings).map(({ item: finding, key }) => (
                    <div className={`check-finding is-${finding.severity}`} key={key}>
                      <div className="check-finding-title">
                        <strong>
                          [{finding.ruleId}] {finding.title}
                        </strong>
                        <span>{SEVERITY_LABELS[finding.severity]}</span>
                      </div>
                      <p className="check-finding-meta">
                        {finding.book ? `${finding.book} · ` : ""}第 {finding.line} 行，第 {finding.column} 列
                      </p>
                      {finding.detail ? <p className="check-finding-detail">{finding.detail}</p> : null}
                      {finding.suggestion ? (
                        <p className="check-finding-fix">
                          <strong>建议：</strong>
                          {finding.suggestion}
                        </p>
                      ) : null}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="check-copy-entry"
                    onClick={() =>
                      void copy(buildFixPrompt(group.findings, worldbook, regexAssets), `「${group.label}」的修复提示`)
                    }
                  >
                    复制此条目给 AI 修复
                  </button>
                </div>
              </details>
            );
          })}
        </div>
      )}
      <p className="field-hint">
        检查策略 {check.report.policyVersion} · 语法检查依据 {check.report.parserCompatibility}
      </p>
    </section>
  );
}

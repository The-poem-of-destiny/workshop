import { useState } from "react";
import { keyedItems } from "../../lib/keyedItems";
import {
  bookLabel,
  type CheckFinding,
  type CheckReport,
  countSeverities,
  type FindingGroup,
  formatLine,
  gateLabels,
  groupFindings,
  groupLabel,
  isBlockingFinding,
  readableEvidence,
  severityLabels,
  summarizeExternalLinks,
} from "./check-report";
import { SourcePanel } from "./SourceView";
import { findingSourceKind, type SourceTarget } from "./source-files";

interface OpenSource {
  groupKey: string;
  kind: "worldbook" | "regex";
  target: SourceTarget;
}

function targetFor(finding: CheckFinding): SourceTarget {
  return {
    entryId: finding.entryId,
    entry: finding.entry,
    uid: finding.uid,
    line: finding.line,
  };
}

function ReadableRisk({ finding }: { finding: CheckFinding }) {
  const evidence = readableEvidence(finding);
  if (!evidence) return null;
  return (
    <div className="review-risk">
      <div className="review-risk-focus">
        <strong>审核重点</strong>
        <p>{evidence.focus}</p>
      </div>
      {evidence.staticUrl ? (
        <div className="review-risk-row">
          <span>{evidence.targetLabel}</span>
          <code className="review-risk-url">{evidence.staticUrl}</code>
        </div>
      ) : evidence.dynamic ? (
        <div className="review-risk-row">
          <span>{evidence.targetLabel}</span>
          <strong className="review-risk-dynamic">运行时动态生成，自动检查无法确定最终 URL</strong>
        </div>
      ) : evidence.rawTarget ? (
        <div className="review-risk-row">
          <span>{evidence.targetLabel}</span>
          <code>{evidence.rawTarget}</code>
        </div>
      ) : null}
      {evidence.urls.length ? (
        <div className="review-risk-row">
          <span>
            条目中可见 URL
            <small>仅供定位，不代表最终会加载</small>
          </span>
          <div className="review-risk-urls">
            {evidence.urls.map((url) => (
              <code key={url}>{url}</code>
            ))}
          </div>
        </div>
      ) : null}
      {evidence.code ? (
        <div className="review-risk-row">
          <span>相关代码</span>
          <code className="review-risk-code">{evidence.code}</code>
        </div>
      ) : null}
    </div>
  );
}

function FindingCard({ finding, onOpenSource }: { finding: CheckFinding; onOpenSource?: () => void }) {
  return (
    <article className={`review-finding review-finding-${finding.severity}`}>
      <header className="review-finding-head">
        <span className={`review-severity review-severity-${finding.severity}`}>
          {severityLabels[finding.severity]}
        </span>
        <code className="review-rule">{finding.ruleId}</code>
        <strong>{finding.title || "需要检查"}</strong>
        <span className="review-finding-location">{formatLine(finding)}</span>
      </header>
      {finding.detail ? <p className="review-finding-detail">{finding.detail}</p> : null}
      {finding.suggestion ? <p className="review-finding-suggestion">建议：{finding.suggestion}</p> : null}
      <ReadableRisk finding={finding} />
      {onOpenSource ? (
        <div className="review-finding-actions">
          <button className="review-button review-button-secondary" type="button" onClick={onOpenSource}>
            查看源码
          </button>
        </div>
      ) : null}
    </article>
  );
}

function FindingGroupBlock({
  group,
  submissionId,
  source,
  onOpenSource,
}: {
  group: FindingGroup;
  submissionId: string;
  source: OpenSource | null;
  onOpenSource: (open: OpenSource | null) => void;
}) {
  const [open, setOpen] = useState(group.blocking);
  const blocking = group.findings.filter(isBlockingFinding).length;
  const entryKey = `${group.key}:entry`;
  const entryOpen = source?.groupKey === entryKey;
  const first = group.findings[0] ?? null;
  const firstLine = group.findings.reduce<number | null>(
    (current, item) => (item.line !== null && (current === null || item.line < current) ? item.line : current),
    null,
  );
  return (
    <div className={`review-report-group${group.blocking ? " is-blocking" : ""}${open ? " is-open" : ""}`}>
      <button className="review-report-group-summary" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="review-report-group-title">
          {groupLabel(group)}
          {group.book ? <small> · {bookLabel(group.book)}</small> : null}
        </span>
        <span className="review-report-group-meta">
          {group.findings.length} 项{blocking ? ` · ${blocking} 项阻断` : ""}
          <i aria-hidden="true">{open ? "−" : "+"}</i>
        </span>
      </button>
      {open ? (
        <div className="review-report-group-body">
          {group.findings.map((finding, index) => {
            const key = `${group.key}:${index}`;
            const active = source?.groupKey === key;
            const targetable = Boolean(finding.entryId || finding.entry);
            return (
              <div className="review-finding-slot" key={key}>
                <FindingCard
                  finding={finding}
                  onOpenSource={
                    targetable
                      ? () =>
                          onOpenSource(
                            active
                              ? null
                              : { groupKey: key, kind: findingSourceKind(finding), target: targetFor(finding) },
                          )
                      : undefined
                  }
                />
                {active && source ? (
                  <SourcePanel submissionId={submissionId} kind={source.kind} target={source.target} />
                ) : null}
              </div>
            );
          })}
          {first && (first.entryId || first.entry) ? (
            <div className="review-report-group-actions">
              <button
                className="review-button review-button-secondary"
                type="button"
                onClick={() =>
                  onOpenSource(
                    entryOpen
                      ? null
                      : {
                          groupKey: entryKey,
                          kind: findingSourceKind(first),
                          target: { ...targetFor(first), line: firstLine },
                        },
                  )
                }
              >
                {entryOpen ? "收起源码" : "查看条目源码"}
              </button>
            </div>
          ) : null}
          {entryOpen && source ? (
            <SourcePanel submissionId={submissionId} kind={source.kind} target={source.target} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function CheckReportSection({
  submissionId,
  report,
  raw,
  checkStatus,
  routeGate,
  checkError,
  checkedAt,
  checkerRevision,
}: {
  submissionId: string;
  report: CheckReport | null;
  raw: unknown;
  checkStatus: string;
  routeGate: string | null;
  checkError: string | null;
  checkedAt: string | null;
  checkerRevision: string | null;
}) {
  const [source, setSource] = useState<OpenSource | null>(null);
  const severity = countSeverities(report?.findings ?? []);
  const groups = report ? groupFindings(report.findings) : [];
  const links = report ? summarizeExternalLinks(report) : [];
  const gate = routeGate ?? report?.routeGate ?? null;
  const blocking = (report?.findings ?? []).filter(isBlockingFinding).length;

  return (
    <section className="review-section" aria-label="检查报告">
      <div className="review-section-heading">
        <div>
          <h3>检查报告</h3>
          <p>
            {checkerRevision ? `checker ${checkerRevision}` : "暂无 checker 运行记录"}
            {checkedAt ? ` · ${checkedAt}` : ""}
          </p>
        </div>
        <span className={`review-gate review-gate-${gate ?? "missing"}`}>
          {gateLabels[gate ?? "missing"] ?? gate ?? "missing"}
        </span>
      </div>
      {checkError ? <p className="review-error-note">{checkError}</p> : null}

      {!report ? (
        <p className="review-state">
          {checkStatus === "queued" || checkStatus === "running"
            ? "检查尚在排队或运行，报告完成后会自动刷新。"
            : "暂无结构化检查报告。"}
        </p>
      ) : (
        <>
          <div className="review-report-overview">
            <div className="review-report-gate-summary">
              <span>服务端门禁</span>
              <strong className={`review-gate review-gate-${gate ?? "missing"}`}>
                {gateLabels[gate ?? "missing"] ?? gate ?? "missing"}
              </strong>
              {blocking ? <small>{blocking} 条规则阻断自动发布</small> : null}
            </div>
            <div className="review-severity-chips">
              {(["high", "warn", "hint", "info"] as const).map((level) => (
                <span className={`review-severity review-severity-${level}`} key={level}>
                  {severityLabels[level]} <b>{severity[level]}</b>
                </span>
              ))}
            </div>
          </div>

          <dl className="review-report-meta">
            <div>
              <dt>报告 gate</dt>
              <dd>{report.gate ?? "未记录"}</dd>
            </div>
            <div>
              <dt>审计状态</dt>
              <dd>{report.audit ?? "未记录"}</dd>
            </div>
            <div>
              <dt>认证状态</dt>
              <dd>{report.certification ?? "未记录"}</dd>
            </div>
            <div>
              <dt>检查引擎</dt>
              <dd>{report.engine ?? "未记录"}</dd>
            </div>
            <div>
              <dt>解析兼容</dt>
              <dd>{report.parserCompatibility ?? "未记录"}</dd>
            </div>
            <div>
              <dt>生成时间</dt>
              <dd>{report.generatedAt ?? "未记录"}</dd>
            </div>
          </dl>

          {report.files.length ? (
            <ul className="review-report-files">
              {report.files.map((file) => (
                <li key={file.fileName}>
                  <code>{file.fileName}</code>
                  <span>
                    {file.type ?? "文件"} · {file.items ?? 0} 条
                    {file.ejsEntries ? ` · ${file.ejsEntries} 条含 EJS` : ""}
                    {file.size === null ? "" : ` · ${file.size.toLocaleString()} bytes`}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {links.length ? (
            <div className="review-external-links">
              <h4>
                报告中的外部链接 <span>{links.length}</span>
              </h4>
              <ul>
                {links.map((link) => (
                  <li key={`${link.dynamic ? "dynamic" : "static"}:${link.url}`}>
                    <span className={link.dynamic ? "review-link-kind is-dynamic" : "review-link-kind"}>
                      {link.dynamic ? "动态候选" : "静态 URL"}
                    </span>
                    <code>{link.url}</code>
                    <small>
                      {link.rules.join(" / ")}
                      {link.count > 1 ? ` · ${link.count} 处` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="review-report-groups">
            {groups.length ? (
              groups.map((group) => (
                <FindingGroupBlock
                  key={group.key}
                  group={group}
                  submissionId={submissionId}
                  source={source}
                  onOpenSource={setSource}
                />
              ))
            ) : (
              <p className="review-muted">当前没有自动检查项。</p>
            )}
          </div>

          {report.removedFindings.length ? (
            <details className="review-report-group">
              <summary>
                <span className="review-report-group-title">已移除的检查项</span>
                <span className="review-report-group-meta">{report.removedFindings.length} 项</span>
              </summary>
              <div className="review-report-group-body">
                <p className="review-muted">上次存在、本次已移除，仅作历史记录。</p>
                {keyedItems(report.removedFindings).map(({ item: finding, key }) => (
                  <FindingCard key={key} finding={finding} />
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}

      <details className="review-report-raw">
        <summary>原始数据</summary>
        <pre>{raw === null || raw === undefined ? "暂无报告数据" : JSON.stringify(raw, null, 2)}</pre>
      </details>
    </section>
  );
}

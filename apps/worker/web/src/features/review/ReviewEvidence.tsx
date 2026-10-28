import { CheckReportSection } from "./CheckReportView";
import { ContentComparison } from "./ContentComparison";
import { gateLabels } from "./check-report";
import { ReviewDiff } from "./ReviewDiff";
import type { useReviewDecision } from "./useReviewDecision";
import type { useReviewEvidence } from "./useReviewEvidence";
import type { useReviewQueue } from "./useReviewQueue";

type EvidenceKind = "worldbook" | "regex" | "cover";

const checkStatusLabels: Record<string, string> = {
  queued: "排队中",
  running: "检查中",
  done: "已完成",
  needs_human: "需人工确认",
  failed: "失败",
};

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

export function ReviewEvidence({
  selectedId,
  loadingDetail,
  detailError,
  select,
  detail,
  checking,
  snooze,
  busy,
  recheck,
  exporting,
  exportMarkdown,
  routeGate,
  report,
  latestRun,
  diff,
  downloadKind,
  download,
}: {
  selectedId: ReturnType<typeof useReviewQueue>["selectedId"];
  loadingDetail: ReturnType<typeof useReviewQueue>["loadingDetail"];
  detailError: ReturnType<typeof useReviewQueue>["detailError"];
  select: ReturnType<typeof useReviewQueue>["select"];
  detail: ReturnType<typeof useReviewQueue>["detail"];
  checking: ReturnType<typeof useReviewDecision>["checking"];
  snooze: ReturnType<typeof useReviewQueue>["snooze"];
  busy: ReturnType<typeof useReviewQueue>["busy"];
  recheck: ReturnType<typeof useReviewDecision>["recheck"];
  exporting: ReturnType<typeof useReviewEvidence>["exporting"];
  exportMarkdown: ReturnType<typeof useReviewEvidence>["exportMarkdown"];
  routeGate: ReturnType<typeof useReviewDecision>["routeGate"];
  report: ReturnType<typeof useReviewDecision>["report"];
  latestRun: ReturnType<typeof useReviewDecision>["latestRun"];
  diff: ReturnType<typeof useReviewQueue>["diff"];
  downloadKind: ReturnType<typeof useReviewEvidence>["downloadKind"];
  download: ReturnType<typeof useReviewEvidence>["download"];
}) {
  return (
    <main className="review-evidence review-evidence-visible" aria-live="polite">
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
              <h2>{detail.revision.title}</h2>
              <p className="review-description">{detail.revision.description || "未提供项目描述。"}</p>
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
            <span className="review-muted">主动重检可选；未主动运行也可依据冻结内容作人工决定。</span>
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

          {diff ? <ContentComparison diff={diff} /> : null}
          <ReviewDiff diff={diff} />

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
        </>
      ) : (
        <div className="review-empty-detail">
          <span className="review-empty-mark">+</span>
          <h2>选择一项提交</h2>
          <p>从左侧队列打开审核证据。审核完成后，下一条会自动接续。</p>
        </div>
      )}
    </main>
  );
}

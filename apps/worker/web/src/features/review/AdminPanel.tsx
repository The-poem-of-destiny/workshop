import { useEffect, useRef, useState } from "react";
import {
  type AdminSubmissionDetail,
  type AdminSubmissionListItem,
  type AdminSubmissionListResponse,
  api,
  type SubmissionDiff,
} from "../../api";

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
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<AdminSubmissionListResponse["counts"] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const selectedRef = useRef<string | null>(null);
  const cache = useRef(new Map<string, { detail: AdminSubmissionDetail; diff: SubmissionDiff }>());
  const inflight = useRef(new Map<string, Promise<{ detail: AdminSubmissionDetail; diff: SubmissionDiff }>>());

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
  }

  async function refresh(): Promise<void> {
    try {
      const result = await api.adminSubmissions("pending");
      setItems(result.items);
      setCounts(result.counts);
      setNextCursor(result.nextCursor);
      if (selectedId && !result.items.some((item) => item.id === selectedId)) clearSelection();
    } catch (value) {
      onError(String(value));
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
    const index = items.findIndex((item) => item.id === currentId);
    const remaining = items.filter((item) => item.id !== currentId);
    const next = remaining.length > 0 ? remaining[Math.min(Math.max(index, 0), remaining.length - 1)] : null;
    setItems(remaining);
    if (next) void select(next.id);
    else clearSelection();
    if (remaining.length < 5 && nextCursor) void loadMore();
  }

  async function select(id: string): Promise<void> {
    selectedRef.current = id;
    setSelectedId(id);
    const cached = cache.current.get(id);
    if (cached) {
      setDetail(cached.detail);
      setDiff(cached.diff);
      prefetch(nextId(id));
      return;
    }
    setDetail(null);
    setDiff(null);
    try {
      const value = await loadDetail(id);
      if (selectedRef.current !== id) return;
      setDetail(value.detail);
      setDiff(value.diff);
      prefetch(nextId(id));
    } catch (value) {
      onError(String(value));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);
  async function review(decision: "approve" | "reject"): Promise<void> {
    if (decision === "reject" && !reason.trim()) {
      onError("拒绝审核必须填写理由。");
      return;
    }
    if (
      (detail?.submission.clientGate === "block" ||
        detail?.submission.clientGate === "missing" ||
        detail?.checkRuns[0]?.routeGate === "block") &&
      !reason.trim()
    ) {
      onError("阻断或缺少 checker 的提交必须填写审核说明。");
      return;
    }
    if (!selectedId) return;
    const currentId = selectedId;
    setBusy(true);
    try {
      await api.adminReview(currentId, decision, reason.trim() || undefined);
      setReason("");
      onNotice(decision === "approve" ? "已通过审核。" : "已拒绝审核。");
      cache.current.delete(currentId);
      inflight.current.delete(currentId);
      const nextStatus = decision === "approve" ? "approved" : "rejected";
      setCounts((previous) =>
        previous
          ? { ...previous, pending: Math.max(0, previous.pending - 1), [nextStatus]: previous[nextStatus] + 1 }
          : previous,
      );
      advance(currentId);
    } catch (value) {
      onError(String(value));
    } finally {
      setBusy(false);
    }
  }
  async function recheck(): Promise<void> {
    if (!selectedId) return;
    setBusy(true);
    try {
      await api.adminRecheck(selectedId);
      setCounts((previous) =>
        previous
          ? { ...previous, pending: Math.max(0, previous.pending - 1), checking: previous.checking + 1 }
          : previous,
      );
      cache.current.delete(selectedId);
      advance(selectedId);
      onNotice("已重新排队检查。");
    } catch (value) {
      onError(String(value));
    } finally {
      setBusy(false);
    }
  }
  async function download(kind: "worldbook" | "regex" | "cover"): Promise<void> {
    if (!selectedId) return;
    try {
      const blob = await api.adminFile(selectedId, kind);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selectedId}-${kind}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (value) {
      onError(String(value));
    }
  }
  return (
    <div className="admin-layout">
      <section className="panel">
        <div className="panel-heading">
          <h2>审核台</h2>
          <button type="button" onClick={() => void refresh()}>
            刷新
          </button>
        </div>
        {counts ? (
          <p className="hint">
            待审 {counts.pending} · 检查中 {counts.checking} · 已通过 {counts.approved} · 已拒绝 {counts.rejected}
          </p>
        ) : null}
        {items.length === 0 ? (
          <p className="hint">暂无待处理提交。</p>
        ) : (
          <div className="project-list">
            {items.map((item) => (
              <button
                className={`project-row${item.id === selectedId ? " selected" : ""}`}
                type="button"
                key={item.id}
                onClick={() => void select(item.id)}
                onMouseEnter={() => prefetch(item.id)}
                onFocus={() => prefetch(item.id)}
              >
                <span>
                  <strong>{item.projectTitle}</strong>
                  <small>
                    {item.author.name} · {item.status} · {item.checkStatus}
                  </small>
                </span>
                <span className="status">{item.gate ?? "missing"}</span>
              </button>
            ))}
          </div>
        )}
        {nextCursor ? (
          <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "加载中…" : "加载更多"}
          </button>
        ) : null}
      </section>
      {detail ? (
        <section className="panel review-detail">
          <h2>{detail.project.title}</h2>
          <p className="hint">
            作者：{detail.project.author.name} · revision #{detail.revision.revisionNo}
          </p>
          <dl>
            <div>
              <dt>客户端 gate</dt>
              <dd>{detail.submission.clientGate ?? "missing"}</dd>
            </div>
            <div>
              <dt>检查状态</dt>
              <dd>{detail.submission.checkStatus}</dd>
            </div>
            <div>
              <dt>检查报告 gate</dt>
              <dd>{detail.checkRuns[0]?.routeGate ?? "暂无"}</dd>
            </div>
            <div>
              <dt>提交时间</dt>
              <dd>{detail.submission.submittedAt}</dd>
            </div>
          </dl>
          <h3>检查报告</h3>
          <details className="report-fold">
            <summary>查看原始报告 JSON</summary>
            <pre className="report">{JSON.stringify(detail.submission.checkReport, null, 2) ?? "暂无报告"}</pre>
          </details>
          <h3>差异</h3>
          {diff ? (
            <>
              <p className="meta">
                检查结论：保留 {diff.findings.accepted.length} · 变更 {diff.findings.changed.length} · 新增{" "}
                {diff.findings.added.length} · 移除 {diff.findings.removed.length}
              </p>
              <div className="diff-grid">
                {(["worldbook", "regex"] as const).map((kind) => (
                  <div key={kind}>
                    <strong>{kind === "worldbook" ? "世界书" : "正则"}</strong>
                    <p>
                      新增 {diff[kind].added.length} · 修改 {diff[kind].modified.length} · 删除{" "}
                      {diff[kind].deleted.length}
                    </p>
                    <ul>
                      {[
                        ...diff[kind].added.map((item) => `+ ${item.name}`),
                        ...diff[kind].modified.map((item) => `~ ${item.name}`),
                        ...diff[kind].deleted.map((item) => `- ${item.name}`),
                      ]
                        .slice(0, 12)
                        .map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="hint">暂无差异。</p>
          )}
          <h3>文件</h3>
          <div className="actions">
            {(["worldbook", "regex", "cover"] as const).map((kind) => (
              <button type="button" key={kind} onClick={() => void download(kind)}>
                {kind} 下载
              </button>
            ))}
          </div>
          <label>
            审核说明
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="拒绝、阻断或人工放行时填写理由"
            />
          </label>
          <div className="actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void review("approve")}>
              通过
            </button>
            <button type="button" disabled={busy} onClick={() => void review("reject")}>
              拒绝
            </button>
            <button type="button" disabled={busy} onClick={() => void recheck()}>
              重新检查
            </button>
          </div>
        </section>
      ) : (
        <section className="panel empty-panel">
          <p className="hint">选择左侧提交查看详情。</p>
        </section>
      )}
    </div>
  );
}

import { extractProjectEntries } from "@workshop/domain";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api, formatUserError } from "../../../api";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";

type Entry = { kind: "worldbook" | "regex"; key: string; name: string };

/** Saved assets are independent of the local upload selection. Never execute their source. */
export function CurrentVersionEntries({
  projectId,
  versionId,
  rowVersion,
  busy,
  frozen,
  dirty,
  onDelete,
}: {
  projectId: string;
  versionId: string | null;
  rowVersion: number;
  busy: boolean;
  frozen: boolean;
  dirty: boolean;
  onDelete: (kind: Entry["kind"], key: string) => Promise<void>;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  // Asset content can change without changing the revision ID (upload/delete/retry).
  const request = useMemo(
    () => ({ projectId, versionId, rowVersion, generation: reload }),
    [projectId, versionId, rowVersion, reload],
  );

  useEffect(() => {
    const { projectId: requestedProjectId, versionId: requestedVersionId } = request;
    let active = true;
    setEntries([]);
    setSelected(null);
    setError(null);
    if (!requestedVersionId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all(
      (["worldbook", "regex"] as const).map(async (kind) => {
        let raw: unknown;
        try {
          raw = await api.authorAsset(requestedProjectId, requestedVersionId, kind);
        } catch (reason) {
          if (reason instanceof ApiError && reason.status === 404) return [];
          throw reason;
        }
        return extractProjectEntries(raw, kind).map(({ entry, entryKey }) => ({
          kind,
          key: entryKey,
          name:
            [entry.comment, entry.name, entry.scriptName].find(
              (value): value is string => typeof value === "string" && value.trim().length > 0,
            ) ?? entryKey,
        }));
      }),
    )
      .then((assets) => {
        if (active) setEntries(assets.flat());
      })
      .catch((reason: unknown) => {
        if (active) setError(formatUserError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request]);

  async function remove(): Promise<void> {
    if (!selected || busy || pending || dirty || frozen || loading) return;
    setPending(true);
    setError(null);
    try {
      await onDelete(selected.kind, selected.key);
      setSelected(null);
      setReload((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof ApiError && (reason.status === 409 || reason.status === 412)
          ? "删除未生效：版本可能已变化、已冻结，或删除后不满足必需内容。请刷新当前内容后重试；必要时先上传替代内容或新建版本。"
          : `删除未完成：${formatUserError(reason)}`,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="asset-picker saved-entries-panel" aria-label="当前版本已保存条目">
      <div className="saved-entries-head">
        <div>
          <h4>已保存条目（{entries.length}）</h4>
          <p className="field-hint">当前草稿版本内已包含的条目；删除条目不会影响线上公开版本。</p>
        </div>
        <button
          type="button"
          disabled={busy || pending || loading || !versionId}
          onClick={() => setReload((value) => value + 1)}
        >
          刷新条目
        </button>
      </div>
      {dirty ? <p className="field-hint">请先保存资料或完成文件上传后再移除单个条目。</p> : null}
      {loading ? <p role="status">正在读取已保存条目…</p> : null}
      {!loading && entries.length === 0 && !error ? (
        <p className="asset-empty">暂无已保存条目，请在上方选择并上传世界书或正则文件。</p>
      ) : null}
      {error ? (
        <p className="asset-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="asset-entry-list">
        {entries.map((entry) => (
          <li className="asset-entry" key={`${entry.kind}:${entry.key}`}>
            <div className="asset-entry-title">
              <strong>{entry.name}</strong>
              <span className="asset-badge">{entry.kind === "worldbook" ? "世界书" : "正则"}</span>
              <button
                type="button"
                disabled={busy || pending || loading || dirty || frozen || Boolean(error)}
                onClick={() => setSelected(entry)}
                aria-label={`删除已保存条目 ${entry.name}`}
              >
                删除条目
              </button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={selected !== null}
        title="删除已保存条目？"
        description={`确定删除「${selected?.name ?? ""}」？此操作生成新的工作版本，公开内容保持不变，需统一送审后才可能发布。若删除最后一条后不满足内容要求，服务器会拒绝。`}
        confirmLabel={pending ? "正在删除…" : "确认删除条目"}
        danger
        busy={pending || busy}
        confirmDisabled={dirty || frozen || loading || Boolean(error)}
        onConfirm={() => void remove()}
        onCancel={() => {
          if (!pending) setSelected(null);
        }}
      >
        {error ? (
          <p className="asset-error" role="alert">
            {error}
          </p>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}

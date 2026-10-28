import { extractProjectEntries } from "@workshop/domain";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../../../api";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";

type Entry = { kind: "worldbook" | "regex"; key: string; name: string };

/** Saved assets are independent of the local upload selection. Never execute their source. */
export function CurrentRevisionEntries({
  projectId,
  revisionId,
  rowVersion,
  busy,
  frozen,
  dirty,
  onDelete,
}: {
  projectId: string;
  revisionId: string | null;
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
    () => ({ projectId, revisionId, rowVersion, generation: reload }),
    [projectId, revisionId, rowVersion, reload],
  );

  useEffect(() => {
    const { projectId: requestedProjectId, revisionId: requestedRevisionId } = request;
    let active = true;
    setEntries([]);
    setSelected(null);
    setError(null);
    if (!requestedRevisionId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all(
      (["worldbook", "regex"] as const).map(async (kind) => {
        let raw: unknown;
        try {
          raw = await api.authorAsset(requestedProjectId, requestedRevisionId, kind);
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
        if (active) setError(String(reason));
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
          : `删除未完成：${String(reason)}`,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="asset-picker" aria-label="当前版本已保存条目">
      <h4>当前版本已保存条目</h4>
      <p className="field-hint">
        这里读取服务器已保存内容，与下方本地文件选择独立。删除会生成新的工作版本，不修改公开快照；仍需通过统一送审。
      </p>
      {dirty ? (
        <p className="field-hint">有未保存资料或未上传文件，请先保存、上传或移除本地选择，再删除已保存条目。</p>
      ) : null}
      {frozen ? <p className="field-hint">当前版本已冻结，请先新建版本再删除条目。</p> : null}
      {loading ? <p role="status">正在读取当前版本条目…</p> : null}
      {!loading && entries.length === 0 && !error ? (
        <p className="asset-empty">当前版本没有已保存的内容条目。</p>
      ) : null}
      {error ? (
        <p className="asset-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy || pending || loading || !revisionId}
        onClick={() => setReload((value) => value + 1)}
      >
        刷新当前内容
      </button>
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

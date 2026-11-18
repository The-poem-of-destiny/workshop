import type { InstallDiff, InstallIntent, InstallPreview, InstallScan } from "@workshop/contracts";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import type { InstallBridge, InstallCompletion } from "../../lib/install-bridge";

export interface InstallDialogProps {
  open: boolean;
  projectTitle: string;
  intent: InstallIntent;
  scan: InstallScan | null;
  bridge: InstallBridge;
  primary?: string | null;
  onCompleted: (result: InstallCompletion) => void;
  onClose: () => void;
}
const actionLabels: Record<InstallIntent["action"], string> = {
  install: "安装",
  update: "更新",
  uninstall: "卸载",
  migrate: "迁移",
};

export function InstallDialog(props: InstallDialogProps) {
  return props.open ? (
    <InstallSession
      key={`${props.intent.action}:${props.intent.instanceId ?? "new"}:${props.intent.project?.version ?? ""}`}
      {...props}
    />
  ) : null;
}

function InstallSession({ projectTitle, intent, scan, bridge, primary, onCompleted, onClose }: InstallDialogProps) {
  const instance = scan?.instances.find((item) => item.instanceId === intent.instanceId);
  const worldbookTarget =
    (Boolean(intent.files?.worldbook) &&
      (intent.action === "install" || (intent.action === "update" && !instance?.location.worldbook))) ||
    intent.action === "migrate";
  const [target, setTarget] = useState(
    intent.targetWorldbook ?? instance?.location.worldbook ?? primary ?? scan?.scope.worldbooks[0] ?? "",
  );
  const [create, setCreate] = useState(intent.createWorldbook ?? false);
  const [bind, setBind] = useState(intent.bindWorldbook ?? false);
  const [preview, setPreview] = useState<InstallPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const active = useRef(true);
  const lock = useRef(false);
  const previewId = useRef<string | null>(null);
  const label = actionLabels[intent.action];
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (previewId.current) void bridge.cancel(previewId.current).catch(() => undefined);
    };
  }, [bridge]);

  async function prepare() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      if (previewId.current) {
        await bridge.cancel(previewId.current);
        previewId.current = null;
      }
      setPreview(null);
      const next = await bridge.preview(
        worldbookTarget
          ? {
              ...intent,
              targetWorldbook: target.trim(),
              createWorldbook: create,
              bindWorldbook: bind,
            }
          : intent,
      );
      if (!active.current) {
        await bridge.cancel(next.previewId);
        return;
      }
      previewId.current = next.previewId;
      setPreview(next);
      setStale(false);
      setAcknowledged(false);
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function close() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      if (previewId.current) await bridge.cancel(previewId.current);
      previewId.current = null;
      onClose();
    } catch (reason) {
      if (active.current)
        setError(`取消预览失败，尚未确认写入：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function confirm() {
    if (!preview || !acknowledged || stale || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const id = preview.previewId;
    // The host consumes a preview on every confirm attempt, including stale failures.
    previewId.current = null;
    try {
      const result = await bridge.confirm(id);
      if (active.current) onCompleted(result);
    } catch (reason) {
      if (active.current) {
        setStale(true);
        setAcknowledged(false);
        setError(
          `${reason instanceof Error ? reason.message : String(reason)}。此预览不可再次确认；请重新预览并核对当前状态。`,
        );
      }
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function revise() {
    if (stale) {
      await prepare();
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (previewId.current) await bridge.cancel(previewId.current);
      previewId.current = null;
      setPreview(null);
      setError(null);
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContent
        className="install-dialog mobile-sheet"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {label}「{projectTitle}」
          </DialogTitle>
          <DialogDescription>选择目标位置并预览变更明细，确认无误后才会执行写入。</DialogDescription>
        </DialogHeader>
        {intent.instanceId ? (
          <p className="installed-meta">
            实例：<code>{intent.instanceId}</code> · 版本：<code>{instance?.version ?? "请以预览为准"}</code>
          </p>
        ) : null}
        {!preview ? (
          <>
            {worldbookTarget ? (
              <fieldset className="install-targets" disabled={busy}>
                <legend>目标世界书</legend>
                <label className="install-option">
                  <input type="checkbox" checked={create} onChange={(event) => setCreate(event.target.checked)} />
                  新建世界书（名称不能与现有世界书重复）
                </label>
                {create ? (
                  <Input
                    aria-label="新世界书名称"
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    placeholder="输入新世界书名称"
                  />
                ) : (
                  <select aria-label="目标世界书" value={target} onChange={(event) => setTarget(event.target.value)}>
                    <option value="">请选择世界书</option>
                    {(scan?.scope.worldbooks ?? []).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
                <label className="install-option">
                  <input
                    type="checkbox"
                    checked={bind}
                    disabled={!scan?.scope.character}
                    onChange={(event) => setBind(event.target.checked)}
                  />
                  将目标世界书绑定到当前角色
                  {scan?.scope.character ? `「${scan.scope.character}」` : "（未选择角色，不可绑定）"}
                </label>
                <p className="hint">
                  世界书目标按名称区分；角色正则只写入当前角色。迁移将从原位置移除该实例内容，并写入新位置。
                </p>
              </fieldset>
            ) : (
              <p>
                位置：世界书「{instance?.location.worldbook ?? "无"}」 / 角色「
                {instance?.location.character ?? (intent.files?.regex ? scan?.scope.character : null) ?? "无"}
                」。角色正则仅作用于当前角色，不能跨角色迁移。
              </p>
            )}
            <p className="install-warning">
              更新将整体替换本模组所属条目（不保留本地手改）；操作前建议先备份角色卡与世界书。
            </p>
          </>
        ) : (
          <section className="install-preview" aria-label="完整修改预览">
            <h3>
              {label}预览{stale ? "（已失效，请重新预览）" : ""}
            </h3>
            {preview.instance ? (
              <p>
                原位置：世界书「{preview.instance.location.worldbook ?? "无"}」 / 角色「
                {preview.instance.location.character ?? "无"}」 · 原版本：<code>{preview.instance.version}</code>
              </p>
            ) : null}
            <p>
              目标世界书：{preview.target.worldbook ?? "无"} · 角色正则：{preview.target.character ?? "无"}
            </p>
            {worldbookTarget ? (
              <p>
                {create ? "新建目标世界书" : "写入现有世界书"} · {bind ? "绑定到当前角色" : "不新增角色绑定"}
              </p>
            ) : null}
            {intent.project ? (
              <p>
                目标版本：<code>{intent.project.version}</code>
              </p>
            ) : null}
            <h4>本地差异项（{preview.playerChanges.length} 项）</h4>
            <DiffList changes={preview.playerChanges} empty="未发现本地修改。" />
            <h4>本次将写入变更（{preview.changes.length} 项）</h4>
            <DiffList changes={preview.changes} empty="条目无变化，仅核对绑定设置。" />
            <p className="install-warning">确认后将按下方明细整体替换或移除条目，本地手改不会自动合并。</p>
            <label className="install-option">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={busy || stale}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              我已核对完整差异、目标及版本，接受上述替换和删除。
            </label>
          </section>
        )}
        {error ? (
          <p className="install-warning" role="alert">
            {error}
          </p>
        ) : null}
        {busy ? <p role="status">正在等待宿主处理，请勿关闭酒馆或切换角色…</p> : null}
        <div className="install-dialog-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void close()}>
            取消
          </Button>
          {preview ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void revise()}>
              {stale ? "重新预览当前状态" : worldbookTarget ? "返回修改目标" : "重新核对"}
            </Button>
          ) : (
            <Button type="button" disabled={busy || (worldbookTarget && !target.trim())} onClick={() => void prepare()}>
              生成完整差异
            </Button>
          )}
          {preview ? (
            <Button type="button" disabled={busy || stale || !acknowledged} onClick={() => void confirm()}>
              确认{label}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DiffList({ changes, empty }: { changes: InstallDiff[]; empty: string }) {
  if (!changes.length) return <p className="hint">{empty}</p>;
  const occurrences = new Map<string, number>();
  const keyedChanges = changes.map((change) => {
    const identity = JSON.stringify([change.kind, change.key, change.before, change.after]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return { change, key: `${identity}:${occurrence}` };
  });
  return (
    <ul className="install-diffs">
      {keyedChanges.map(({ change, key }) => (
        <li key={key}>
          <h5>
            {change.kind === "worldbook" ? "世界书条目" : "角色正则"} · {change.key} ·{" "}
            {change.before === null ? "新增" : change.after === null ? "删除" : "替换"}
          </h5>
          <div className="install-diff-columns">
            <div>
              <strong>修改前</strong>
              <pre>{change.before ?? "（无）"}</pre>
            </div>
            <div>
              <strong>修改后</strong>
              <pre>{change.after ?? "（移除）"}</pre>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

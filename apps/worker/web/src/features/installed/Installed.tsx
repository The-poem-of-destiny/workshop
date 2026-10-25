import { BookOpen, RefreshCcw } from "lucide-react";
import type { ProjectSummary } from "../../api";
import { Button } from "../../components/ui/button";

export type InstalledScanState = "clean" | "localChanged" | "scanIncomplete";

export interface InstalledRecord {
  version: string;
  worldbookName: string;
  entries: Record<string, { hash: string; name: string }>;
  regexIds: string[];
  regexHashes?: Record<string, string>;
  updatedAt: string;
}

export interface InstalledItem {
  id: string;
  record: InstalledRecord;
  /** Resolved from the workshop API; null when the project was removed. */
  project: ProjectSummary | null | undefined;
  /** True when the project lookup failed for a transient reason (network, 5xx); not a deletion signal. */
  failed: boolean;
}

/** Short revision display that stays readable for UUIDs and git-style hashes. */
function shortVersion(value: string | null | undefined): string {
  if (!value) return "未知";
  return value.length > 10 ? value.slice(0, 8) : value;
}

export function Installed({
  items,
  states,
  loading,
  scanning,
  updatingId,
  mutating,
  onScan,
  onRetry,
  onOpen,
  onUpdate,
  onUninstall,
}: {
  items: InstalledItem[];
  states: Record<string, InstalledScanState> | undefined;
  loading: boolean;
  scanning: boolean;
  updatingId: string | null;
  mutating: boolean;
  onScan: () => void;
  onRetry: () => void;
  onOpen: (item: InstalledItem) => void;
  onUpdate: (item: InstalledItem) => void;
  onUninstall: (item: InstalledItem) => void;
}) {
  return (
    <section className="installed" aria-labelledby="installed-title">
      <header className="installed-head">
        <div>
          <h1 id="installed-title">已安装</h1>
          <p className="installed-sub">这些项目已经写入你的 SillyTavern 世界书。</p>
        </div>
        <Button type="button" size="sm" onClick={onScan} disabled={scanning || mutating}>
          <RefreshCcw aria-hidden="true" className={scanning ? "spin" : undefined} />
          {scanning ? "扫描中…" : "重新扫描"}
        </Button>
      </header>
      {loading ? (
        <p className="installed-empty">正在读取已安装项目…</p>
      ) : items.length === 0 ? (
        <div className="installed-empty">
          <BookOpen aria-hidden="true" />
          <p>还没有安装任何工坊项目。</p>
          <p className="hint">浏览工坊，打开项目详情并安装后，会在这里看到安装记录。</p>
        </div>
      ) : (
        <ul className="installed-list">
          {items.map((item) => {
            const failed = item.failed;
            const removed = !failed && item.project === null;
            const updateAvailable =
              !failed &&
              Boolean(item.project?.publishedRevisionId && item.record.version !== item.project.publishedRevisionId);
            const scan = states?.[item.id];
            const localChanged = !failed && scan === "localChanged";
            const scanIncomplete = !failed && (scan === "scanIncomplete" || (!scan && !removed));
            const busy = updatingId === item.id;
            return (
              <li key={item.id} className="installed-item">
                <div className="installed-main">
                  <h2 className="installed-title">
                    {failed
                      ? "无法加载项目信息"
                      : (item.project?.title ?? (removed ? "项目已从工坊下架" : `项目 ${item.id}`))}
                  </h2>
                  <p className="installed-meta">
                    <span>世界书：{item.record.worldbookName}</span>
                    <span>已安装：{shortVersion(item.record.version)}</span>
                    {failed ? (
                      <span>工坊发布：加载失败</span>
                    ) : (
                      <span>工坊发布：{shortVersion(item.project?.publishedRevisionId)}</span>
                    )}
                  </p>
                  <div className="installed-badges">
                    {failed ? <span className="installed-badge warn">加载失败</span> : null}
                    {updateAvailable ? <span className="installed-badge update">有可用更新</span> : null}
                    {localChanged ? <span className="installed-badge local">本地已修改</span> : null}
                    {scanIncomplete ? <span className="installed-badge warn">扫描不完整</span> : null}
                    {!failed && !updateAvailable && !localChanged && !scanIncomplete && !removed ? (
                      <span className="installed-badge clean">已是最新</span>
                    ) : null}
                    {removed ? <span className="installed-badge warn">已下架</span> : null}
                  </div>
                  {failed ? (
                    <p className="hint">无法从工坊获取项目信息，请检查网络后重试；已安装的条目不受影响。</p>
                  ) : null}
                  {removed ? <p className="hint">该项目已从工坊移除，无法再获取更新；仍可卸载已写入的条目。</p> : null}
                </div>
                <div className="installed-actions">
                  {failed ? (
                    <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
                      重试
                    </Button>
                  ) : null}
                  {updateAvailable ? (
                    <Button type="button" size="sm" onClick={() => onUpdate(item)} disabled={mutating || !item.project}>
                      {busy ? "更新中…" : "更新"}
                    </Button>
                  ) : null}
                  {!failed ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => onOpen(item)}
                      disabled={!item.project}
                    >
                      打开详情
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="ghost" onClick={() => onUninstall(item)} disabled={mutating}>
                    卸载
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

import type { InstallInstance, InstallScan } from "@workshop/contracts";
import { BookOpen, RefreshCcw } from "lucide-react";
import type { ProjectSummary } from "../../api";
import { Button } from "../../components/ui/button";

export interface InstalledItem {
  instance: InstallInstance;
  project: ProjectSummary | null | undefined;
  failed: boolean;
}

function scanEntryKeys<T extends { location: string; reason: string; guidance?: string }>(entries: T[]) {
  const occurrences = new Map<string, number>();
  return entries.map((entry) => {
    const identity = JSON.stringify([entry.location, entry.reason, entry.guidance]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return { entry, key: `${identity}:${occurrence}` };
  });
}

type InstalledRowProps = {
  item: InstalledItem;
  mutating: boolean;
  onRetry: () => void;
  onOpen: (item: InstalledItem) => void;
  onUpdate: (item: InstalledItem) => void;
  onUninstall: (item: InstalledItem) => void;
  onMigrate: (item: InstalledItem) => void;
};

function InstalledRow({ item, mutating, onRetry, onOpen, onUpdate, onUninstall, onMigrate }: InstalledRowProps) {
  const instance = item.instance;
  const removed = !item.failed && item.project === null;
  const update = Boolean(item.project?.publishedRevisionId && item.project.publishedRevisionId !== instance.version);
  return (
    <li className="installed-item">
      <div className="installed-main">
        <h2 className="installed-title">
          {item.project?.title ?? (removed ? "项目已下架" : `项目 ${instance.projectId}`)}
        </h2>
        <p className="installed-meta">
          <span>世界书：{instance.location.worldbook ?? "无"}</span>
          <span>角色正则：{instance.location.character ?? "无"}</span>
        </p>
        <p className="installed-meta">
          <span>
            安装版本：<code>{instance.version}</code>
          </span>
          {item.project?.publishedRevisionId ? (
            <span>
              发布版本：<code>{item.project.publishedRevisionId}</code>
            </span>
          ) : null}
        </p>
        <p className="installed-meta">
          实例：<code>{instance.instanceId}</code> · {instance.entryCount} 个条目 / {instance.regexCount} 个正则
        </p>
        <div className="installed-badges">
          <span className="installed-badge">{instance.source === "legacy" ? "旧版实例" : "新版实例"}</span>
          <span className={`installed-badge ${instance.state === "clean" ? "clean" : "local"}`}>
            {instance.state === "clean"
              ? "与安装基线一致"
              : instance.state === "localChanged"
                ? "玩家已修改"
                : "基线未知，必须核对完整内容"}
          </span>
          {update ? <span className="installed-badge update">有更新</span> : null}
          {item.failed ? <span className="installed-badge warn">项目信息加载失败</span> : null}
        </div>
        {removed ? <p className="hint">无法获取更新，仍可预览迁移或卸载。</p> : null}
        {item.failed ? <p className="hint">网络失败不代表下架；本地实例不受影响。</p> : null}
      </div>
      <div className="installed-actions">
        {item.failed ? (
          <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
            重试项目信息
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="secondary" disabled={!item.project} onClick={() => onOpen(item)}>
          项目详情
        </Button>
        {update ? (
          <Button type="button" size="sm" disabled={mutating || !item.project} onClick={() => onUpdate(item)}>
            预览更新
          </Button>
        ) : null}
        {instance.location.worldbook ? (
          <Button type="button" size="sm" variant="secondary" disabled={mutating} onClick={() => onMigrate(item)}>
            迁移世界书位置
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" disabled={mutating} onClick={() => onUninstall(item)}>
          预览卸载
        </Button>
      </div>
    </li>
  );
}

export function Installed({
  scan,
  items,
  loading,
  scanning,
  mutating,
  error,
  onScan,
  onRetry,
  onOpen,
  onUpdate,
  onUninstall,
  onMigrate,
  onReinstall,
}: {
  scan: InstallScan | null;
  items: InstalledItem[];
  loading: boolean;
  scanning: boolean;
  mutating: boolean;
  error?: string | null;
  onScan: () => void;
  onRetry: () => void;
  onOpen: (item: InstalledItem) => void;
  onUpdate: (item: InstalledItem) => void;
  onUninstall: (item: InstalledItem) => void;
  onMigrate: (item: InstalledItem) => void;
  onReinstall?: () => void;
}) {
  return (
    <section className="installed" aria-labelledby="installed-title">
      <header className="installed-head">
        <div>
          <h1 id="installed-title">已安装实例</h1>
          <p className="installed-sub">同一项目可以安装多份；更新、迁移和卸载只针对你选择的实例。</p>
        </div>
        <Button type="button" size="sm" onClick={onScan} disabled={scanning || mutating}>
          <RefreshCcw aria-hidden="true" className={scanning ? "spin" : undefined} />
          {scanning ? "扫描中…" : "重新扫描"}
        </Button>
      </header>
      {error ? (
        <p role="alert" className="install-warning">
          {error}
        </p>
      ) : null}
      {scan ? (
        <section className="installed-scope" aria-label="扫描范围">
          <h2>本次扫描范围</h2>
          <p>世界书：{scan.scope.worldbooks.join("、") || "无"}</p>
          <p>当前角色：{scan.scope.character ?? "未选择角色"}；正则仅扫描当前角色，其他角色未扫描，不代表没有安装。</p>
          {scan.failures.length ? (
            <>
              <h3>扫描失败（不能据此判断未安装）</h3>
              <ul>
                {scanEntryKeys(scan.failures).map(({ entry: failure, key }) => (
                  <li key={key}>
                    {failure.location}：{failure.reason}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {scan.ambiguous.length ? (
            <>
              <h3>疑似内容（未认定为安装实例）</h3>
              <ul>
                {scanEntryKeys(scan.ambiguous).map(({ entry: item, key }) => (
                  <li key={key}>
                    <strong>{item.location}</strong>：{item.reason}
                    <p>{item.guidance}</p>
                  </li>
                ))}
              </ul>
              <p>不支持手工认领。请先备份并检查疑似内容，再从项目详情重新安装到明确目标，避免重复条目。</p>
              {onReinstall ? (
                <Button type="button" variant="secondary" onClick={onReinstall} disabled={mutating}>
                  浏览项目并重新安装
                </Button>
              ) : null}
            </>
          ) : null}
        </section>
      ) : !loading ? (
        <p className="installed-empty">尚无扫描结果，请重新扫描；不能据此判断未安装。</p>
      ) : null}
      {loading ? (
        <p role="status">正在读取实例及项目信息…</p>
      ) : scan && items.length === 0 ? (
        <div className="installed-empty">
          <BookOpen aria-hidden="true" />
          <p>扫描范围内没有确定的安装实例。</p>
          <p className="hint">检查上方扫描范围、失败和疑似内容；可从项目详情新建安装。</p>
        </div>
      ) : (
        <ul className="installed-list">
          {items.map((item) => (
            <InstalledRow
              key={item.instance.instanceId}
              item={item}
              mutating={mutating}
              onRetry={onRetry}
              onOpen={onOpen}
              onUpdate={onUpdate}
              onUninstall={onUninstall}
              onMigrate={onMigrate}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";

/** First-install target picker: choose which SillyTavern worldbook receives the project entries. */
export function InstallDialog({
  open,
  projectTitle,
  primary,
  additional,
  available,
  busy,
  onSelect,
  onClose,
}: {
  open: boolean;
  projectTitle: string;
  primary: string | null;
  additional: string[];
  available: string[];
  busy: boolean;
  onSelect: (worldbook: string) => void;
  onClose: () => void;
}) {
  const candidates = [
    ...new Set([primary, ...additional, ...available].filter((name): name is string => Boolean(name))),
  ];
  return (
    <Dialog open={open} onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="install-dialog">
        <DialogHeader>
          <DialogTitle>选择安装目标</DialogTitle>
          <DialogDescription>
            将「{projectTitle}」的条目导入到下面的世界书。只会在你确认后安装，之后更新会沿用同一本世界书。
          </DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <>
            <div className="install-dialog-empty">
              <p>没有找到可用的世界书。</p>
              <p className="hint">请先在 SillyTavern 中创建或导入一本世界书，然后重新打开工坊。</p>
            </div>
            <div className="install-dialog-actions">
              <Button type="button" variant="ghost" onClick={onClose}>
                关闭
              </Button>
            </div>
          </>
        ) : (
          <InstallTargetPicker
            candidates={candidates}
            primary={primary}
            additional={additional}
            busy={busy}
            onSelect={onSelect}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog content is open, so the selection resets to the primary worldbook each time. */
function InstallTargetPicker({
  candidates,
  primary,
  additional,
  busy,
  onSelect,
  onClose,
}: {
  candidates: string[];
  primary: string | null;
  additional: string[];
  busy: boolean;
  onSelect: (worldbook: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(primary ?? candidates[0] ?? "");
  const [query, setQuery] = useState("");
  const searchable = candidates.length > 6;
  const visible = searchable
    ? candidates.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()))
    : candidates;
  return (
    <>
      {searchable ? (
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索世界书"
          aria-label="搜索世界书"
          autoComplete="off"
        />
      ) : null}
      <fieldset className="install-targets" aria-label="安装目标世界书">
        {visible.map((name) => (
          <label key={name} className={`install-target${selected === name ? " selected" : ""}`}>
            <input
              type="radio"
              name="install-target"
              value={name}
              checked={selected === name}
              onChange={() => setSelected(name)}
              disabled={busy}
            />
            <span className="install-target-name">{name}</span>
            {name === primary ? (
              <span className="install-target-tag">角色主世界书</span>
            ) : additional.includes(name) ? (
              <span className="install-target-tag">附加世界书</span>
            ) : (
              <span className="install-target-tag muted">其他世界书</span>
            )}
          </label>
        ))}
        {visible.length === 0 ? <p className="hint">没有匹配的世界书名称。</p> : null}
      </fieldset>
      <div className="install-dialog-actions">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button type="button" onClick={() => onSelect(selected)} disabled={busy || !selected}>
          {busy ? "准备安装…" : "安装到此世界书"}
        </Button>
      </div>
    </>
  );
}

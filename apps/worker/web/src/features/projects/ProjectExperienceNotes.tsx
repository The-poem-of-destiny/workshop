import type { ExperienceNotesResponse, ExperienceNoteVersion } from "@workshop/contracts";
import { RefreshCcw, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, formatUserError } from "../../api";

function versionName(version: ExperienceNoteVersion): string {
  return `${version.versionLabel ? `${version.versionLabel} · ` : ""}第 ${version.versionNo} 版${version.isCurrent ? "（当前发布）" : "（已记备忘）"}`;
}

export function ProjectExperienceNotes({
  projectId,
  loggedIn,
  onLogin,
  onError,
}: {
  projectId: string;
  loggedIn: boolean;
  onLogin: () => void;
  onError: (message: string) => void;
}) {
  const [data, setData] = useState<ExperienceNotesResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [completedReload, setCompletedReload] = useState(-1);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const deletePending = useRef(false);
  useEffect(() => {
    if (!loggedIn) return;
    let active = true;
    setData(null);
    setFailed(false);
    api
      .experienceNotes(projectId)
      .then(
        (result) => {
          if (active) setData(result);
        },
        () => {
          if (active) setFailed(true);
        },
      )
      .finally(() => {
        if (active) setCompletedReload(reload);
      });
    return () => {
      active = false;
    };
  }, [loggedIn, projectId, reload]);
  const selected =
    data?.versions.find((version) => version.projectVersionId === selectedVersionId) ??
    data?.versions.find((version) => version.isCurrent);
  return (
    <section className="rail-section rating-block" aria-label="我的版本体验备忘">
      <h4>我的版本体验备忘</h4>
      <p className="hint">仅自己可见的游玩笔记，按版本独立保存。</p>
      {!loggedIn ? (
        <button type="button" className="rail-subtle-btn" onClick={onLogin}>
          登录后记录备忘
        </button>
      ) : failed ? (
        <div className="detail-state detail-state-error" role="alert">
          <p>备忘加载失败。</p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            <RefreshCcw aria-hidden="true" />
            重试
          </button>
        </div>
      ) : !data || completedReload !== reload ? (
        <p className="hint" role="status">
          正在加载备忘…
        </p>
      ) : (
        <>
          <label className="rating-comment">
            <span>查看版本备忘</span>
            <select
              aria-label="查看版本备忘"
              value={selected?.projectVersionId ?? ""}
              disabled={saving}
              onChange={(event) => setSelectedVersionId(event.target.value)}
            >
              {data.versions.map((version) => (
                <option key={version.projectVersionId} value={version.projectVersionId}>
                  {versionName(version)}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <VersionNoteEditor
              key={`${selected.projectVersionId}:${selected.note?.updatedAt ?? "new"}`}
              projectId={projectId}
              version={selected}
              onSaving={setSaving}
              onSaved={() => setReload((value) => value + 1)}
              onError={onError}
            />
          ) : null}
          {data.unversionedNote ? (
            <section className="rating-block" aria-label="未标版本的旧备忘">
              <h4>未标版本的旧备忘</h4>
              <p className="rating-summary">早期评分 {data.unversionedNote.rating} 星</p>
              <p className="hint" style={{ whiteSpace: "pre-wrap" }}>
                {data.unversionedNote.comment ?? "无文字备注"}
              </p>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  if (deletePending.current) return;
                  deletePending.current = true;
                  setSaving(true);
                  void api
                    .deleteUnversionedNote(projectId)
                    .then(() => setReload((value) => value + 1))
                    .catch((reason) => onError(formatUserError(reason)))
                    .finally(() => {
                      deletePending.current = false;
                      setSaving(false);
                    });
                }}
              >
                删除这条旧备忘
              </button>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}

function VersionNoteEditor({
  projectId,
  version,
  onSaving,
  onSaved,
  onError,
}: {
  projectId: string;
  version: ExperienceNoteVersion;
  onSaving: (value: boolean) => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [rating, setRating] = useState<number | null>(version.note?.rating ?? null);
  const [comment, setComment] = useState(version.note?.comment ?? "");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const save = (remove: boolean): void => {
    if (pending.current || (!remove && rating === null)) return;
    const request = remove
      ? api.deleteExperienceNote(projectId, version.projectVersionId)
      : rating !== null
        ? api.setExperienceNote(projectId, version.projectVersionId, rating, comment.trim())
        : null;
    if (!request) return;
    pending.current = true;
    setSaving(true);
    onSaving(true);
    void request
      .then(onSaved)
      .catch((reason) => onError(formatUserError(reason)))
      .finally(() => {
        pending.current = false;
        setSaving(false);
        onSaving(false);
      });
  };
  return (
    <>
      <fieldset className="rating-stars" disabled={saving}>
        <legend className="sr-only">本版体验评分</legend>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            className={rating !== null && rating >= value ? "rating-star is-active" : "rating-star"}
            aria-label={`${value} 星`}
            aria-pressed={rating === value}
            onClick={() => setRating(value)}
          >
            <Star aria-hidden="true" fill={rating !== null && rating >= value ? "currentColor" : "none"} />
          </button>
        ))}
      </fieldset>
      <label className="rating-comment">
        <span className="sr-only">本版体验文字</span>
        <textarea
          aria-label="本版体验文字"
          rows={2}
          maxLength={2000}
          value={comment}
          disabled={saving}
          placeholder="记录本版游玩体验（仅自己可见）"
          onChange={(event) => setComment(event.target.value)}
        />
      </label>
      <div className="actions">
        <button type="button" className="primary" disabled={rating === null || saving} onClick={() => save(false)}>
          {saving ? "保存中…" : "保存本版备忘"}
        </button>
        {version.note ? (
          <button type="button" disabled={saving} onClick={() => save(true)}>
            删除本版备忘
          </button>
        ) : null}
      </div>
    </>
  );
}

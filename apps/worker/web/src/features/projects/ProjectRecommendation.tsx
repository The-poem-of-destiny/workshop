import { useState } from "react";
import { api } from "../../api";

export function ProjectRecommendation({
  projectId,
  projectVersionId,
  loggedIn,
  onLogin,
  onError,
}: {
  projectId: string;
  projectVersionId: string;
  loggedIn: boolean;
  onLogin: () => void;
  onError: (message: string) => void;
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function save(remove: boolean) {
    if (!loggedIn) {
      onLogin();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await api.playerRecommendation(projectId, { projectVersionId, comment }, remove);
      setNotice(remove ? "已撤回本版本推荐。" : "已保存本版本推荐；修改评语不会重复加分。");
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rail-section" aria-label="玩家推荐">
      <h3>推荐此版本</h3>
      <label>
        推荐评语（可选）
        <textarea maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} />
      </label>
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => void save(false)}>
          保存推荐
        </button>
        {loggedIn ? (
          <button type="button" disabled={busy} onClick={() => void save(true)}>
            撤回推荐
          </button>
        ) : null}
      </div>
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}

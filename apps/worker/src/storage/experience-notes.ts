import type { ExperienceNote, ExperienceNoteInput, ExperienceNotesResponse } from "@workshop/contracts";

interface NoteRow {
  rating: number | null;
  comment_text: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface VersionNoteRow extends NoteRow {
  id: string;
  version_no: number;
  version_label: string | null;
  is_current: number;
  unversioned_rating: number | null;
  unversioned_comment: string | null;
  unversioned_created_at: string | null;
  unversioned_updated_at: string | null;
}

function note(row: NoteRow): ExperienceNote | null {
  return row.rating === null || row.created_at === null || row.updated_at === null
    ? null
    : { rating: row.rating, comment: row.comment_text, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function getExperienceNotes(
  db: D1Database,
  userId: string,
  projectId: string,
): Promise<ExperienceNotesResponse | null> {
  const rows = await db
    .prepare(`SELECT v.id, v.version_no, v.version_label, v.id = p.published_version_id AS is_current,
      n.rating, n.comment_text, n.created_at, n.updated_at,
      u.rating AS unversioned_rating, u.comment_text AS unversioned_comment,
      u.created_at AS unversioned_created_at, u.updated_at AS unversioned_updated_at
    FROM projects p
    JOIN project_versions v ON v.project_id = p.id
    LEFT JOIN project_experience_notes n ON n.project_id = p.id AND n.project_version_id = v.id AND n.user_id = ?
    LEFT JOIN project_unversioned_notes u ON u.project_id = p.id AND u.user_id = ?
    WHERE p.id = ? AND p.deleted_at IS NULL AND p.visibility = 'public' AND p.published_version_id IS NOT NULL
      AND (v.id = p.published_version_id OR n.user_id IS NOT NULL)
    ORDER BY is_current DESC, v.version_no DESC`)
    .bind(userId, userId, projectId)
    .all<VersionNoteRow>();
  const first = rows.results[0];
  if (!first) return null;
  return {
    projectId,
    versions: rows.results.map((row) => ({
      projectVersionId: row.id,
      versionNo: row.version_no,
      versionLabel: row.version_label,
      isCurrent: Boolean(row.is_current),
      note: note(row),
    })),
    unversionedNote: note({
      rating: first.unversioned_rating,
      comment_text: first.unversioned_comment,
      created_at: first.unversioned_created_at,
      updated_at: first.unversioned_updated_at,
    }),
  };
}

export async function setExperienceNote(
  db: D1Database,
  userId: string,
  projectId: string,
  projectVersionId: string,
  input: ExperienceNoteInput,
): Promise<boolean> {
  const result = await db
    .prepare(`INSERT INTO project_experience_notes (project_id, user_id, project_version_id, rating, comment_text)
    SELECT p.id, ?, v.id, ?, ? FROM projects p JOIN project_versions v ON v.project_id = p.id
    WHERE p.id = ? AND v.id = ? AND p.deleted_at IS NULL AND p.visibility = 'public' AND p.published_version_id IS NOT NULL
      AND (p.published_version_id = v.id OR EXISTS (
        SELECT 1 FROM project_experience_notes n WHERE n.project_id = p.id AND n.project_version_id = v.id AND n.user_id = ?
      ))
    ON CONFLICT(user_id, project_version_id) DO UPDATE SET rating = excluded.rating,
      comment_text = CASE WHEN ? THEN excluded.comment_text ELSE project_experience_notes.comment_text END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
    .bind(
      userId,
      input.rating,
      input.comment ?? null,
      projectId,
      projectVersionId,
      userId,
      input.comment !== undefined ? 1 : 0,
    )
    .run();
  return result.meta.changes > 0;
}

export async function deleteExperienceNote(
  db: D1Database,
  userId: string,
  projectId: string,
  projectVersionId: string,
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM project_experience_notes
    WHERE project_id = ? AND project_version_id = ? AND user_id = ?
      AND EXISTS (SELECT 1 FROM projects p WHERE p.id = project_experience_notes.project_id
        AND p.deleted_at IS NULL AND p.visibility = 'public' AND p.published_version_id IS NOT NULL)`)
    .bind(projectId, projectVersionId, userId)
    .run();
  return result.meta.changes > 0;
}

export async function deleteUnversionedNote(db: D1Database, userId: string, projectId: string): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM project_unversioned_notes WHERE project_id = ? AND user_id = ?
      AND EXISTS (SELECT 1 FROM projects p WHERE p.id = project_unversioned_notes.project_id
        AND p.deleted_at IS NULL AND p.visibility = 'public' AND p.published_version_id IS NOT NULL)`)
    .bind(projectId, userId)
    .run();
  return result.meta.changes > 0;
}

import {
  type MeResponse,
  type PolicyAcceptanceInput,
  type PolicyAcceptanceResponse,
  type Role,
  serializeAuditDetail,
} from "@workshop/contracts";
import {
  CURRENT_POLICY_VERSION,
  discordAvatarUrl,
  evaluatePolicyQuiz,
  hasAcceptedCurrentPolicy,
} from "@workshop/domain";
import { hashSessionToken } from "./session-hash.js";

interface UserRow {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  role: Role;
  policy_accepted_version: string | null;
  policy_accepted_at: string | null;
}

const avatarUrl = discordAvatarUrl;

export async function getMe(db: D1Database, userId: string): Promise<MeResponse | null> {
  const row = await db
    .prepare(
      "SELECT id, username, global_name, avatar, role, policy_accepted_version, policy_accepted_at FROM users WHERE id = ?",
    )
    .bind(userId)
    .first<UserRow>();
  if (!row) return null;
  return {
    user: {
      id: row.id,
      username: row.username,
      globalName: row.global_name,
      avatarUrl: avatarUrl(row.id, row.avatar),
      role: row.role,
    },
    policy: {
      currentVersion: CURRENT_POLICY_VERSION,
      acceptedVersion: row.policy_accepted_version,
      acceptedAt: row.policy_accepted_at,
      accepted: hasAcceptedCurrentPolicy(row.policy_accepted_version),
    },
  };
}

export async function acceptUserPolicy(
  db: D1Database,
  userId: string,
  input: PolicyAcceptanceInput,
): Promise<
  | { ok: true; data: PolicyAcceptanceResponse }
  | { ok: false; error: "version_mismatch" }
  | { ok: false; error: "quiz_failed"; incorrectQuestionIds: string[] }
> {
  if (input.version !== CURRENT_POLICY_VERSION) {
    return { ok: false, error: "version_mismatch" };
  }
  const quiz = evaluatePolicyQuiz(input.answers);
  if (!quiz.ok) {
    return { ok: false, error: "quiz_failed", incorrectQuestionIds: quiz.incorrectQuestionIds };
  }
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(`
        UPDATE users
        SET policy_accepted_version = ?, policy_accepted_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .bind(CURRENT_POLICY_VERSION, now, now, userId),
    db
      .prepare(`
        INSERT INTO audit_events (id, action, target_type, target_id, actor_id, detail, created_at)
        VALUES (?, 'member.policy_accept', 'user', ?, ?, ?, ?)
      `)
      .bind(
        crypto.randomUUID(),
        userId,
        userId,
        serializeAuditDetail("member.policy_accept", { version: CURRENT_POLICY_VERSION }),
        now,
      ),
  ]);
  return {
    ok: true,
    data: {
      policy: {
        currentVersion: CURRENT_POLICY_VERSION,
        acceptedVersion: CURRENT_POLICY_VERSION,
        acceptedAt: now,
        accepted: true,
      },
    },
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function revokeSessionByToken(db: D1Database, token: string, secret?: string): Promise<void> {
  const tokenHash = await hashSessionToken(token, secret);
  await db
    .prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), tokenHash)
    .run();
}

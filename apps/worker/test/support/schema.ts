import initial from "../../migrations/0001_initial.sql?raw";
import downloadTokens from "../../migrations/0002_download_tokens.sql?raw";
import { splitSql } from "./sql";

export async function applySchema(db: D1Database): Promise<void> {
  for (const source of [initial, downloadTokens]) {
    const sql = source.replace(/^\s*--.*$/gm, "").replace(/^\s*PRAGMA\b.*$/gm, "");
    for (const statement of splitSql(sql)) await db.prepare(statement).run();
  }
}

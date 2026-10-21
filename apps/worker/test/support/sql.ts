/**
 * Split a migration file into single statements for D1Database.exec(), which
 * rejects multi-statement input. Semicolons inside quotes are ignored; a
 * CREATE TRIGGER body is merged until its standalone END.
 */
export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    if (quote) {
      current += char;
      if (char === quote) {
        if (sql[index + 1] === quote) {
          current += sql[++index]!;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    current += char;
    if (char === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
    }
  }
  if (current.trim()) statements.push(current.trim());

  const merged: string[] = [];
  let inTrigger = false;
  for (const statement of statements) {
    if (inTrigger) {
      merged[merged.length - 1] += `\n${statement}`;
      if (/^END\s*;?$/i.test(statement.trim())) inTrigger = false;
      continue;
    }
    merged.push(statement);
    if (/^CREATE\s+TRIGGER\b/i.test(statement)) inTrigger = true;
  }
  return merged;
}

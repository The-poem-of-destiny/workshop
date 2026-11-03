export async function readFrozenReviewReport(
  r2: R2Bucket,
  key: string | null,
  hash: string | null,
  cleanedAt: string | null,
): Promise<string | null> {
  if (key === null && hash === null && cleanedAt === null) return null;
  if (key === null && hash && cleanedAt && /^[a-f0-9]{64}$/.test(hash)) return null;
  if (!key || !hash || cleanedAt !== null || !/^[a-f0-9]{64}$/.test(hash) || !key.endsWith(`/${hash}.json`)) {
    throw new Error("Invalid frozen review report reference");
  }
  const object = await r2.get(key);
  if (!object) throw new Error(`Frozen review report unavailable: ${key}`);
  const bytes = await object.arrayBuffer();
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== hash) throw new Error(`Frozen review report hash mismatch: ${key}`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  JSON.parse(text);
  return text;
}

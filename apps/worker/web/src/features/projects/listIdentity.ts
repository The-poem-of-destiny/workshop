/** Content identity plus a per-content occurrence distinguishes otherwise identical read-only rows. */
export function identifyOccurrences<T>(items: readonly T[]): { key: string; item: T }[] {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const identity = JSON.stringify(item) ?? String(item);
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    return { key: JSON.stringify([identity, occurrence]), item };
  });
}

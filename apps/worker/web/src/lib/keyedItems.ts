/** Content identities with occurrence suffixes keep repeated, identical rows distinct. */
export function keyedItems<T>(items: readonly T[]): { item: T; key: string }[] {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const content = JSON.stringify(item) ?? String(item);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { item, key: `${content}:${occurrence}` };
  });
}

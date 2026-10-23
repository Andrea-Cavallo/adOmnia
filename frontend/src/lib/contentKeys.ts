/**
 * Stable React keys for lists with no natural identity: the key is derived from the item's content
 * plus how many identical keys came before it, so it never depends on the array index and stays
 * stable when equal items are appended.
 */
export function withContentKeys<T>(items: readonly T[], contentOf: (item: T) => string): { key: string; item: T }[] {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const content = contentOf(item)
    const occurrence = seen.get(content) ?? 0
    seen.set(content, occurrence + 1)
    return { key: occurrence === 0 ? content : `${content}#${occurrence}`, item }
  })
}

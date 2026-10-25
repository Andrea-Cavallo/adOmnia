/** A title + subtitle pair shown as rotating copy (Hub hero, empty response). */
export interface CopyPair {
  title: string
  subtitle: string
}

/** Random in-range index that never equals the previous one. */
export function nextCopyIndex(count: number, random: number, previous: number | null): number {
  if (count <= 1) return 0
  const base = Math.abs(Math.trunc(random * count)) % count
  return base === previous ? (base + 1) % count : base
}

/**
 * Pick a pair and remember its index under `key` so the next visit shows a
 * different one. Selection is local-only and never throws: a blocked storage
 * simply means the copy can repeat.
 */
export function loadRotatingCopy<T extends CopyPair>(key: string, list: readonly T[], random: number = Math.random()): T {
  if (list.length === 0) throw new Error('loadRotatingCopy needs at least one pair')
  let previous: number | null = null
  try {
    const stored = Number.parseInt(globalThis.localStorage?.getItem(key) ?? '', 10)
    previous = Number.isInteger(stored) ? stored : null
  } catch {
    previous = null
  }
  const index = nextCopyIndex(list.length, random, previous)
  try {
    globalThis.localStorage?.setItem(key, String(index))
  } catch {
    // Copy is cosmetic: a blocked storage only means the next pick may repeat.
  }
  return list[index]
}

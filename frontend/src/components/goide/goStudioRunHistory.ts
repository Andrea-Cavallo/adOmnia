/** Un'esecuzione conclusa di una configurazione Run, conservata in locale per progetto. */
export interface GoStudioRunHistoryEntry {
  configId: string
  configName: string
  status: string
  exitCode: number | null
  startedAt: string
  durationMillis: number
  command: string
}

const KEY = 'adomnia.goide.runHistory:'
const LIMIT = 100

export function readRunHistory(projectPath: string, configId?: string): GoStudioRunHistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY + projectPath) ?? '[]')
    const entries = Array.isArray(parsed) ? (parsed as GoStudioRunHistoryEntry[]).filter((entry) => entry && typeof entry.configId === 'string') : []
    return configId ? entries.filter((entry) => entry.configId === configId) : entries
  } catch {
    return []
  }
}

/** Aggiunge in testa l'esecuzione conclusa; oltre il limite si perdono le più vecchie. */
export function recordRunHistory(projectPath: string, entry: GoStudioRunHistoryEntry): GoStudioRunHistoryEntry[] {
  const next = [entry, ...readRunHistory(projectPath)].slice(0, LIMIT)
  try { localStorage.setItem(KEY + projectPath, JSON.stringify(next)) } catch { /* solo locale */ }
  return next
}

/** Le configurazioni appuntate vengono prima; per il resto vale l'ordine scelto dall'utente. */
export function pinnedFirst<T extends { pinned?: boolean }>(configs: readonly T[]): T[] {
  return [...configs.filter((config) => config.pinned), ...configs.filter((config) => !config.pinned)]
}

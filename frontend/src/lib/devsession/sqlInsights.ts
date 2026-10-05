import type { LiveQuery } from '@/lib/devsession-api'

/** Oltre questa durata un'istruzione è segnalata come lenta. */
export const SLOW_QUERY_MS = 100
/** Stessa istruzione ripetuta almeno tante volte nella stessa richiesta: possibile N+1. */
export const N_PLUS_ONE_MIN = 3

/** Forma normalizzata: valori, numeri e parametri diventano ?, spazi compressi, liste IN accorciate. */
export function normalizeSQL(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/\$\d+|:\w+|@\w+/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .replace(/\(\s*\?(?:\s*,\s*\?)*\s*\)/g, '(?)')
    .trim()
    .toLowerCase()
}

const TRANSACTION_CONTROL = /^(begin|start transaction|commit|rollback|savepoint|release)\b/i

export interface NPlusOne {
  sql: string
  count: number
  totalMs: number
}

/** Istruzioni uguali (a meno dei valori) ripetute nella richiesta: il classico N+1 di un ciclo. */
export function nPlusOneHints(queries: readonly LiveQuery[]): NPlusOne[] {
  const groups = new Map<string, NPlusOne>()
  for (const query of queries) {
    if (query.kind === 'transaction' || TRANSACTION_CONTROL.test(query.sql)) continue
    const key = normalizeSQL(query.sql)
    const group = groups.get(key) ?? { sql: query.sql, count: 0, totalMs: 0 }
    group.count++
    group.totalMs += query.durationMs ?? 0
    groups.set(key, group)
  }
  return [...groups.values()].filter((group) => group.count >= N_PLUS_ONE_MIN).sort((a, b) => b.count - a.count)
}

const LOCK_HINTS: Record<string, string> = {
  '40P01': 'Deadlock: two transactions waited for each other. Take locks in the same order everywhere.',
  '55P03': 'Lock not available (NOWAIT or lock_timeout): another transaction holds the row or table.',
  '57014': 'Statement cancelled, often by statement_timeout: look for locks held by other transactions or a slow plan.',
  '40001': 'Serialization failure: retry the transaction.',
  '1205': 'Lock wait timeout: another transaction held the lock too long.',
  '1213': 'Deadlock: two transactions waited for each other. Take locks in the same order everywhere.',
}

export function lockHint(code: string | undefined): string | null {
  return code ? LOCK_HINTS[code] ?? null : null
}

export interface QuerySummary {
  statements: number
  totalMs: number
  slow: number
  errors: number
  transactions: number
  slowestMs: number
}

export function summarizeQueries(queries: readonly LiveQuery[]): QuerySummary {
  const statements = queries.filter((query) => query.kind !== 'transaction')
  return {
    statements: statements.length,
    totalMs: statements.reduce((total, query) => total + (query.durationMs ?? 0), 0),
    slow: statements.filter((query) => (query.durationMs ?? 0) >= SLOW_QUERY_MS).length,
    errors: statements.filter((query) => !!query.error).length,
    transactions: queries.filter((query) => query.kind === 'transaction').length,
    slowestMs: Math.max(0, ...statements.map((query) => query.durationMs ?? 0)),
  }
}

export interface StaticQuerySite {
  sql?: string
  site: { relativePath: string; line: number }
}

/** Il punto del codice che esegue questa istruzione: stessa forma normalizzata, poi prefisso comune. */
export function sourceForStatement(sql: string, sites: readonly StaticQuerySite[]): StaticQuerySite['site'] | null {
  const wanted = normalizeSQL(sql)
  const candidates = sites.filter((item) => item.sql)
  const exact = candidates.find((item) => normalizeSQL(item.sql!) === wanted)
  if (exact) return exact.site
  const partial = candidates.find((item) => {
    const known = normalizeSQL(item.sql!)
    return known.length >= 20 && (wanted.startsWith(known) || known.startsWith(wanted))
  })
  return partial?.site ?? null
}

/** Frammento distintivo per cercare l'istruzione nel codice quando l'analisi non c'è. */
export function searchFragment(sql: string): string {
  const words = sql.replace(/\s+/g, ' ').trim().split(' ')
  return words.slice(0, Math.min(words.length, 4)).join(' ')
}

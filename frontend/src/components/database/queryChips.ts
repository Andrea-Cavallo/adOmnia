// Contextual one-click fixes under the editor (FIX.md DB-3.1.7). Pure: each chip is an id the
// UI shows and `applyChip` turns into the new query text. Chips only touch the text, never run it.

import { countRewrite, splitStatements, type DbKind, type QueryInterpretation } from './queryInterpreter'

export type ChipId = 'add-where' | 'add-limit' | 'count-rows' | 'count-first' | 'add-filter'

export interface QueryChip {
  id: ChipId
  label: string
}

const MAX_CHIPS = 4
const DEFAULT_LIMIT = 100
const TAIL_CLAUSE = /\b(GROUP\s+BY|ORDER\s+BY|LIMIT|OFFSET|HAVING|RETURNING|FETCH)\b/i

export function suggestChips(driver: DbKind, text: string, interpretation: QueryInterpretation | null): QueryChip[] {
  if (!interpretation || !text.trim()) return []
  const chips: QueryChip[] = []
  const missingFilter = interpretation.issues.includes('no filter')

  if (driver === 'mongodb') {
    if (missingFilter) chips.push({ id: 'add-filter', label: 'Add filter' })
    if (missingFilter && countRewrite(driver, text)) chips.push({ id: 'count-first', label: 'Count first' })
    return chips.slice(0, MAX_CHIPS)
  }
  if (driver === 'redis') return []

  if (splitStatements(text).length !== 1) return []
  if (interpretation.kind === 'select') {
    if (!interpretation.filterPresent) chips.push({ id: 'add-where', label: 'Add WHERE' })
    if (!/\bLIMIT\b/i.test(text)) chips.push({ id: 'add-limit', label: `Add LIMIT ${DEFAULT_LIMIT}` })
    if (selectToCount(text)) chips.push({ id: 'count-rows', label: 'Count rows' })
  } else if (missingFilter && (interpretation.kind === 'update' || interpretation.kind === 'delete')) {
    chips.push({ id: 'add-where', label: 'Add WHERE' })
    if (countRewrite(driver, text)) chips.push({ id: 'count-first', label: 'Count first' })
  }
  return chips.slice(0, MAX_CHIPS)
}

/** `SELECT … FROM rest [ORDER BY/LIMIT …]` → `SELECT COUNT(*) FROM rest`, or null when not a plain single select. */
function selectToCount(text: string): string | null {
  const stmt = text.trim().replace(/;\s*$/, '')
  if (/\b(GROUP\s+BY|HAVING|UNION|DISTINCT|WITH)\b/i.test(stmt) || /\bJOIN\b/i.test(stmt)) return null
  const match = /^\s*SELECT\s+[\s\S]+?\s+FROM\s+([\s\S]+?)\s*$/i.exec(stmt)
  if (!match) return null
  const tail = TAIL_CLAUSE.exec(match[1])
  const rest = (tail ? match[1].slice(0, tail.index) : match[1]).trim()
  return rest ? `SELECT COUNT(*) FROM ${rest}` : null
}

/** Inserts `WHERE ` before the first trailing clause, or at the end. */
function addWhere(text: string): string {
  const stmt = text.replace(/;\s*$/, '').replace(/\s+$/, '')
  const tail = TAIL_CLAUSE.exec(stmt)
  const at = tail ? tail.index : stmt.length
  const head = stmt.slice(0, at).replace(/\s+$/, '')
  const rest = stmt.slice(at)
  return `${head}\nWHERE ${rest ? `\n${rest}` : ''}`.trimEnd()
}

export function applyChip(driver: DbKind, text: string, id: ChipId): string {
  switch (id) {
    case 'add-where':
      return addWhere(text)
    case 'add-limit':
      return `${text.replace(/;\s*$/, '').trimEnd()}\nLIMIT ${DEFAULT_LIMIT}`
    case 'count-rows':
      return selectToCount(text) ?? text
    case 'count-first':
      return driver === 'mongodb'
        ? JSON.stringify(JSON.parse(countRewrite(driver, text) ?? '{}'), null, 2)
        : countRewrite(driver, text) ?? text
    case 'add-filter': {
      try {
        const doc = JSON.parse(text) as Record<string, unknown>
        return JSON.stringify({ ...doc, filter: { field: 'value' } }, null, 2)
      } catch {
        return text
      }
    }
  }
}

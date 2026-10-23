// Schema-aware SQL completion for the Database Studio query editor.
// Pure: given the query, the caret and the loaded schema, returns what to suggest.

export type SqlSchema = Record<string, string[]> // table → columns

export interface SqlCompletionItem {
  label: string
  kind: 'keyword' | 'table' | 'column'
  detail?: string
}

export interface SqlCompletion {
  /** Offset where the replaced word starts. */
  start: number
  prefix: string
  items: SqlCompletionItem[]
}

export const SQL_COMPLETION_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'GROUP BY', 'ORDER BY', 'LIMIT', 'OFFSET',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
  'AND', 'OR', 'NOT', 'NULL', 'IS NULL', 'IS NOT NULL', 'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'HAVING', 'RETURNING', 'ASC', 'DESC', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH', 'UNION', 'EXISTS', 'LIKE', 'IN', 'BETWEEN',
]

const TABLE_CONTEXT = /\b(FROM|JOIN|UPDATE|INTO|TABLE)\s+$/i
const MAX_ITEMS = 50

/** alias/table name (lower-case) → real table name, from FROM/JOIN/UPDATE/INTO clauses. */
export function sqlAliases(query: string, schema: SqlSchema): Map<string, string> {
  const known = new Map(Object.keys(schema).map((t) => [t.toLowerCase(), t]))
  const aliases = new Map<string, string>()
  const re = /\b(?:FROM|JOIN|UPDATE|INTO)\s+[`"]?([\w$]+)[`"]?(?:\s+(?:AS\s+)?([\w$]+))?/gi
  for (const m of query.matchAll(re)) {
    const table = known.get(m[1].toLowerCase())
    if (!table) continue
    aliases.set(table.toLowerCase(), table)
    const alias = m[2]
    if (alias && !/^(WHERE|ON|JOIN|LEFT|RIGHT|INNER|OUTER|GROUP|ORDER|LIMIT|SET|VALUES|USING)$/i.test(alias)) {
      aliases.set(alias.toLowerCase(), table)
    }
  }
  return aliases
}

function rank(items: SqlCompletionItem[], prefix: string): SqlCompletionItem[] {
  const p = prefix.toLowerCase()
  const seen = new Set<string>()
  const starts: SqlCompletionItem[] = []
  const contains: SqlCompletionItem[] = []
  for (const item of items) {
    const l = item.label.toLowerCase()
    const key = `${item.kind}:${l}`
    if (seen.has(key) || (p && l === p)) continue
    seen.add(key)
    if (l.startsWith(p)) starts.push(item)
    else if (p && l.includes(p)) contains.push(item)
  }
  return [...starts, ...contains].slice(0, MAX_ITEMS)
}

/** table → column → type, shown as detail next to a suggested column. */
export type SqlColumnTypes = Record<string, Record<string, string>>

function columnItems(table: string, schema: SqlSchema, types?: SqlColumnTypes, skip?: Set<string>): SqlCompletionItem[] {
  return (schema[table] ?? [])
    .filter((c) => !skip?.has(c.toLowerCase()))
    .map((c) => ({ label: c, kind: 'column' as const, detail: types?.[table]?.[c] ? `${table} · ${types[table][c]}` : table }))
}

/**
 * Statement-aware narrowing (FIX.md DB-3.1.6): after `UPDATE x SET` only x's columns,
 * inside `INSERT INTO t (` only t's columns, after WHERE/ON/HAVING only columns in scope.
 * Returns null when the caret is not in one of those positions.
 */
function contextualColumns(query: string, before: string, schema: SqlSchema, types?: SqlColumnTypes): { items: SqlCompletionItem[]; operators: boolean } | null {
  const known = new Map(Object.keys(schema).map((t) => [t.toLowerCase(), t]))
  const statement = before.slice(before.lastIndexOf(';') + 1)

  const insert = /\bINSERT\s+INTO\s+[`"]?([\w$]+)[`"]?\s*\(([^)]*)$/i.exec(statement)
  if (insert) {
    const table = known.get(insert[1].toLowerCase())
    if (!table) return null
    const used = new Set(insert[2].split(',').map((c) => c.trim().replace(/[`"]/g, '').toLowerCase()).filter(Boolean))
    return { items: columnItems(table, schema, types, used), operators: false }
  }

  const update = /\bUPDATE\s+[`"]?([\w$]+)[`"]?(?:\s+(?:AS\s+)?[\w$]+)?\s+SET\b([\s\S]*)$/i.exec(statement)
  if (update && !/\bWHERE\b/i.test(update[2]) && /(^|,)\s*[\w$]*$/.test(update[2])) {
    const table = known.get(update[1].toLowerCase())
    return table ? { items: columnItems(table, schema, types), operators: false } : null
  }

  if (/\b(?:WHERE|ON|HAVING|AND|OR)\s+(?:[^;]*?[\s(,=<>!+*/-])?[\w$]*$/i.test(statement) || /\b(?:GROUP|ORDER)\s+BY\s+(?:[^;]*,\s*)?[\w$]*$/i.test(statement)) {
    const scope = [...new Set(sqlAliases(query, schema).values())]
    if (!scope.length) return null
    return { items: scope.flatMap((t) => columnItems(t, schema, types)), operators: true }
  }
  return null
}

/** Trailing token at the caret: word characters, counted from its first letter or underscore. */
function trailingWord(text: string): string {
  let start = text.length
  while (start > 0 && /[\w$]/.test(text[start - 1])) start--
  while (start < text.length && !/[A-Za-z_]/.test(text[start])) start++
  return text.slice(start)
}

export function sqlCompletions(query: string, caret: number, schema: SqlSchema, explicit = false, types?: SqlColumnTypes): SqlCompletion | null {
  const before = query.slice(0, caret)
  // ponytail: no tokenizer, so completion is suppressed only inside an unterminated '…' string or -- comment on this line.
  const line = before.slice(before.lastIndexOf('\n') + 1)
  if ((line.match(/'/g)?.length ?? 0) % 2 === 1 || line.includes('--')) return null

  const qualified = /(^|[^\w$])([\w$]+)\.([\w$]*)$/.exec(before)
  if (qualified) {
    const table = sqlAliases(query, schema).get(qualified[2].toLowerCase())
      ?? Object.keys(schema).find((t) => t.toLowerCase() === qualified[2].toLowerCase())
    if (!table) return null
    const items = rank(columnItems(table, schema, types), qualified[3])
    return items.length ? { start: caret - qualified[3].length, prefix: qualified[3], items } : null
  }

  const word = trailingWord(before)
  if (!word && !explicit) return null
  const start = caret - word.length
  const tables = Object.keys(schema).map((t) => ({ label: t, kind: 'table' as const, detail: `${schema[t].length} columns` }))
  const keywords = SQL_COMPLETION_KEYWORDS.map((k) => ({ label: k, kind: 'keyword' as const }))

  let candidates: SqlCompletionItem[]
  const tableContext = TABLE_CONTEXT.test(before.slice(0, start))
  const narrowed = tableContext ? null : contextualColumns(query, before.slice(0, start), schema, types)
  if (tableContext) {
    candidates = tables
  } else if (narrowed) {
    candidates = narrowed.operators
      ? [...narrowed.items, ...keywords.filter((k) => /^(AND|OR|NOT|NULL|IS NULL|IS NOT NULL|LIKE|IN|BETWEEN|ASC|DESC)$/.test(k.label))]
      : narrowed.items
  } else {
    const inScope = [...new Set(sqlAliases(query, schema).values())]
    const columns = inScope.flatMap((t) => columnItems(t, schema, types))
    candidates = [...columns, ...tables, ...keywords]
  }
  const items = rank(candidates, word)
  return items.length ? { start, prefix: word, items } : null
}

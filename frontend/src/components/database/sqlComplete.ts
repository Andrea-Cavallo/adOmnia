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

export function sqlCompletions(query: string, caret: number, schema: SqlSchema, explicit = false): SqlCompletion | null {
  const before = query.slice(0, caret)
  // ponytail: no tokenizer, so completion is suppressed only inside an unterminated '…' string or -- comment on this line.
  const line = before.slice(before.lastIndexOf('\n') + 1)
  if ((line.match(/'/g)?.length ?? 0) % 2 === 1 || line.includes('--')) return null

  const qualified = /([\w$]+)\.([\w$]*)$/.exec(before)
  if (qualified) {
    const table = sqlAliases(query, schema).get(qualified[1].toLowerCase())
      ?? Object.keys(schema).find((t) => t.toLowerCase() === qualified[1].toLowerCase())
    if (!table) return null
    const items = rank((schema[table] ?? []).map((c) => ({ label: c, kind: 'column' as const, detail: table })), qualified[2])
    return items.length ? { start: caret - qualified[2].length, prefix: qualified[2], items } : null
  }

  const word = /[A-Za-z_][\w$]*$/.exec(before)?.[0] ?? ''
  if (!word && !explicit) return null
  const start = caret - word.length
  const tables = Object.keys(schema).map((t) => ({ label: t, kind: 'table' as const, detail: `${schema[t].length} columns` }))
  const keywords = SQL_COMPLETION_KEYWORDS.map((k) => ({ label: k, kind: 'keyword' as const }))

  let candidates: SqlCompletionItem[]
  if (TABLE_CONTEXT.test(before.slice(0, start))) {
    candidates = tables
  } else {
    const inScope = [...new Set(sqlAliases(query, schema).values())]
    const columns = inScope.flatMap((t) => schema[t].map((c) => ({ label: c, kind: 'column' as const, detail: t })))
    candidates = [...columns, ...tables, ...keywords]
  }
  const items = rank(candidates, word)
  return items.length ? { start, prefix: word, items } : null
}

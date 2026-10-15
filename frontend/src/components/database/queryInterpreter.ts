// Pure query interpretation and risk analysis for the Database Studio query console.
// Implements DB-3.2.1 (interpreter), DB-3.2.4 (statement splitting) and DB-3.2.5
// (risk classification aligned with the backend's confirm rules) of mds/FIX.md.
//
// No React and no component imports: this module is used by UI code and unit tests.
// Parsing is a minimal tokenizer + targeted regexes ("un tokenizer minimo con test
// mirati"): strings, comments and dollar-quoted bodies are masked before any keyword
// or identifier is matched, so `;` and `WHERE` inside them never confuse the analysis.

import { SQL_COMPLETION_KEYWORDS, sqlAliases, type SqlSchema } from './sqlComplete'
import { parseShellDoc } from './mongo/bson'

// ── public API ───────────────────────────────────────────────────────────────

export type DbKind = 'postgres' | 'mysql' | 'sqlite' | 'mongodb' | 'redis'
export type QueryRisk = 'read' | 'write' | 'destructive'

export interface QuerySchemaTable {
  name: string
  /** Column names (SQL) or sampled field names (Mongo). When absent, columns are not checked. */
  columns?: string[]
  /** Optional indexed-field hints; when present, filters on other fields raise a warning. */
  indexes?: string[]
}

export interface QuerySchema {
  tables?: QuerySchemaTable[]
  collections?: QuerySchemaTable[]
}

export interface QueryInterpretation {
  kind: string            // e.g. 'select', 'update', 'delete', 'find', 'updateMany', 'scan', 'unknown'
  targets: string[]       // tables / collections / keys touched
  filterPresent: boolean  // a WHERE (or a non-empty Mongo filter) limits what is touched
  writes: boolean
  risk: QueryRisk
  summary: string         // plain-English sentence, names in backticks
  issues: string[]        // e.g. 'no filter', 'multiple statements', 'full document replacement'
}

/** Splits a script into statements, honouring strings, `--` / `/* *\/` comments and `$$` bodies. */
export function splitStatements(text: string): string[] {
  const masked = maskNonCode(text)
  const parts: string[] = []
  let start = 0
  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i] === ';') {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  // Drop empty parts and comment-only parts.
  return parts.map((p) => p.trim()).filter((p) => maskNonCode(p).trim().length > 0)
}

/**
 * The statement the caret is in (DB-3.2.4). A caret on the `;` or in the blank
 * run after it belongs to the statement before; before the first statement it
 * belongs to that one. Returns null when the script has no statement at all.
 */
export function statementAt(text: string, caret: number): { text: string; start: number; end: number } | null {
  const masked = maskNonCode(text)
  const spans: { start: number; end: number }[] = []
  let start = 0
  for (let i = 0; i <= masked.length; i += 1) {
    if (i === masked.length || masked[i] === ';') {
      // Emptiness is judged on the masked text (comments blank out); extents on the original.
      if (masked.slice(start, i).trim()) {
        const slice = text.slice(start, i)
        const lead = slice.length - slice.trimStart().length
        spans.push({ start: start + lead, end: start + lead + slice.trim().length })
      }
      start = i + 1
    }
  }
  if (!spans.length) return null
  let chosen = spans[0]
  for (const span of spans) {
    if (span.start <= caret) chosen = span
  }
  return { ...chosen, text: text.slice(chosen.start, chosen.end) }
}

/** Explains a query in plain English and classifies its risk before it runs. */
export function interpret(driver: DbKind, text: string, schema?: QuerySchema): QueryInterpretation {
  if (!text.trim()) return emptyInterpretation()
  if (driver === 'mongodb') return interpretMongo(text, schema)
  if (driver === 'redis') return interpretRedis(text, schema)
  return interpretSql(text, schema)
}

/**
 * Dry-run rewrite: an equivalent read-only query counting the rows/documents the
 * write would touch, or null when no safe equivalent exists (multiple statements,
 * JOINs in UPDATE, LIMIT, CTEs, unsupported operations…).
 */
export function countRewrite(driver: DbKind, text: string): string | null {
  if (driver === 'mongodb') {
    const doc = parseQueryDocument(text)
    if (!doc) return null
    const op = MONGO_OPERATIONS[normalizeOp(doc.operation)]
    if (op !== 'updateMany' && op !== 'deleteMany') return null
    const collection = stringField(doc.collection)
    if (!collection) return null
    const filter = isPlainObject(doc.filter) ? doc.filter : {}
    const database = stringField(doc.database)
    return JSON.stringify({ operation: 'count', ...(database ? { database } : {}), collection, filter })
  }
  if (driver === 'redis') return null

  const stmts = splitStatements(text)
  if (stmts.length !== 1) return null
  const a = analyzeSqlStatement(stmts[0])
  if (a.kind !== 'update' && a.kind !== 'delete') return null
  if (a.tableTokens.length !== 1 || a.isCte || a.hasJoin || a.hasLimit || a.hasOrderBy) return null
  if (a.filterPresent && !a.whereClause) return null // `WHERE` with nothing after it: not equivalent
  return `SELECT COUNT(*) FROM ${a.tableTokens[0]}${a.whereClause ? ` WHERE ${a.whereClause}` : ''}`
}

// ── tokenizer ────────────────────────────────────────────────────────────────

/**
 * Returns a copy of `text` where every character inside string literals (`'…'`),
 * comments and dollar-quoted bodies is replaced with a space, so `;`, `WHERE` and
 * keywords inside them never confuse the analysis. Double-quoted and backtick
 * regions are SQL *identifiers*: their text stays visible (only the quotes are
 * skipped), so quoted table and column names remain analyzable. Length and line
 * structure are preserved, so indices map back to the original.
 */
function maskNonCode(text: string): string {
  const out = text.split('')
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text[i]
    const d = i + 1 < n ? text[i + 1] : ''
    if (c === '-' && d === '-') {
      while (i < n && text[i] !== '\n') {
        out[i] = ' '
        i += 1
      }
      continue
    }
    if (c === '/' && d === '*') {
      out[i] = ' '
      out[i + 1] = ' '
      i += 2
      while (i < n && !(text[i] === '*' && i + 1 < n && text[i + 1] === '/')) {
        if (text[i] !== '\n') out[i] = ' '
        i += 1
      }
      if (i < n) {
        out[i] = ' '
        out[i + 1] = ' '
        i += 2
      }
      continue
    }
    if (c === "'" ) {
      out[i] = ' '
      i += 1
      while (i < n) {
        if (text[i] === '\\') {
          out[i] = ' '
          if (i + 1 < n) out[i + 1] = ' '
          i += 2
          continue
        }
        if (text[i] === "'") {
          if (i + 1 < n && text[i + 1] === "'") {
            out[i] = ' '
            out[i + 1] = ' '
            i += 2
            continue
          }
          out[i] = ' '
          i += 1
          break
        }
        if (text[i] !== '\n') out[i] = ' '
        i += 1
      }
      continue
    }
    if (c === '"' || c === '`') {
      // Quoted identifier: leave the text alone, just skip past it so quotes
      // inside it (e.g. `` `it's` ``) cannot open a string literal.
      i += 1
      while (i < n) {
        if (text[i] === c) {
          if (i + 1 < n && text[i + 1] === c) {
            i += 2
            continue
          }
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    if (c === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(text.slice(i))
      if (m) {
        const end = text.indexOf(m[0], i + m[0].length)
        const stop = end === -1 ? n : end + m[0].length
        for (let j = i; j < stop; j += 1) {
          if (text[j] !== '\n') out[j] = ' '
        }
        i = stop
        continue
      }
    }
    i += 1
  }
  return out.join('')
}

/** Blanks everything inside parentheses (top level stays), keeping length. */
/** Blanks the text of "double-quoted" and `backtick` identifiers (already free of strings and comments), keeping length. */
function blankQuoted(masked: string): string {
  const out = masked.split('')
  let quote = ''
  for (let i = 0; i < out.length; i += 1) {
    const c = masked[i]
    if (quote) {
      if (c === quote) quote = ''
      else if (c !== '\n') out[i] = ' '
    } else if (c === '"' || c === '`') {
      quote = c
    }
  }
  return out.join('')
}

function blankParens(masked: string): string {
  const out = masked.split('')
  let depth = 0
  for (let i = 0; i < out.length; i += 1) {
    const c = masked[i]
    if (c === '(') {
      if (depth > 0) out[i] = ' '
      depth += 1
      continue
    }
    if (c === ')') {
      if (depth > 0) depth -= 1
      if (depth > 0) out[i] = ' '
      continue
    }
    if (depth > 0 && c !== '\n') out[i] = ' '
  }
  return out.join('')
}

// ── small helpers ────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOp(value: unknown): string {
  return stringField(value).toLowerCase()
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item)
      out.push(item)
    }
  }
  return out
}

function normalizeIdent(raw: string): string {
  const last = raw.split('.').pop() ?? raw
  return last.replace(/^[`"\[]|[`"\]]$/g, '')
}

function riskOf(writes: boolean, destructive: boolean): QueryRisk {
  if (destructive) return 'destructive'
  return writes ? 'write' : 'read'
}

const RISK_RANK: Record<QueryRisk, number> = { read: 0, write: 1, destructive: 2 }

function worseRisk(a: QueryRisk, b: QueryRisk): QueryRisk {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b
}

function emptyInterpretation(): QueryInterpretation {
  return {
    kind: 'unknown',
    targets: [],
    filterPresent: false,
    writes: false,
    risk: 'read',
    summary: 'There is no query to run.',
    issues: ['empty query'],
  }
}

// ── SQL ──────────────────────────────────────────────────────────────────────

interface SqlKindInfo {
  kind: string
  writes: boolean
  destructive: boolean
}

const SQL_KEYWORD_KIND: Record<string, SqlKindInfo> = {
  SELECT: { kind: 'select', writes: false, destructive: false },
  SHOW: { kind: 'select', writes: false, destructive: false },
  PRAGMA: { kind: 'select', writes: false, destructive: false },
  EXPLAIN: { kind: 'select', writes: false, destructive: false },
  DESC: { kind: 'select', writes: false, destructive: false },
  DESCRIBE: { kind: 'select', writes: false, destructive: false },
  VALUES: { kind: 'select', writes: false, destructive: false },
  INSERT: { kind: 'insert', writes: true, destructive: false },
  REPLACE: { kind: 'insert', writes: true, destructive: false },
  UPDATE: { kind: 'update', writes: true, destructive: false },
  DELETE: { kind: 'delete', writes: true, destructive: false },
  MERGE: { kind: 'merge', writes: true, destructive: false },
  CREATE: { kind: 'create', writes: true, destructive: false },
  ALTER: { kind: 'alter', writes: true, destructive: false },
  DROP: { kind: 'drop', writes: true, destructive: true },
  TRUNCATE: { kind: 'truncate', writes: true, destructive: true },
  GRANT: { kind: 'grant', writes: true, destructive: false },
  REVOKE: { kind: 'revoke', writes: true, destructive: false },
  CALL: { kind: 'call', writes: true, destructive: false },
  BEGIN: { kind: 'begin', writes: false, destructive: false },
  COMMIT: { kind: 'commit', writes: false, destructive: false },
  ROLLBACK: { kind: 'rollback', writes: false, destructive: false },
  SAVEPOINT: { kind: 'savepoint', writes: false, destructive: false },
  SET: { kind: 'set', writes: false, destructive: false },
  USE: { kind: 'use', writes: false, destructive: false },
  VACUUM: { kind: 'vacuum', writes: false, destructive: false },
  ANALYZE: { kind: 'analyze', writes: false, destructive: false },
  OPTIMIZE: { kind: 'optimize', writes: false, destructive: false },
  REINDEX: { kind: 'reindex', writes: false, destructive: false },
  CHECK: { kind: 'check', writes: false, destructive: false },
}

const SQL_ALIAS_STOP = new Set([
  'WHERE', 'ON', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL', 'NATURAL',
  'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'SET', 'VALUES', 'USING', 'SELECT', 'FROM', 'INTO',
  'UPDATE', 'DELETE', 'INSERT', 'RETURNING', 'HAVING', 'UNION', 'EXCEPT', 'INTERSECT',
  'FOR', 'AND', 'OR', 'IS', 'NOT', 'NULL', 'AS', 'ASC', 'DESC', 'FETCH', 'INTO',
])

// Words that can never be a column reference (keywords plus common clause words).
const SQL_NON_COLUMN_WORDS = new Set(
  SQL_COMPLETION_KEYWORDS
    .flatMap((k) => k.split(/\s+/))
    .concat([
      'IF', 'EXISTS', 'ONLY', 'ROW', 'ROWS', 'CASCADE', 'RESTRICT', 'ADD', 'COLUMN', 'KEY',
      'PRIMARY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'UNIQUE', 'DEFAULT', 'INDEX', 'TEMP',
      'TEMPORARY', 'RECURSIVE', 'TRUE', 'FALSE', 'CAST', 'ALL', 'ANY', 'SOME', 'BOTH',
      'LEADING', 'TRAILING', 'NULLS', 'FIRST', 'LAST', 'FILTER', 'OVER', 'PARTITION',
      'PRECEDING', 'FOLLOWING', 'CURRENT', 'UNBOUNDED', 'INTERVAL', 'BEGIN', 'COMMIT',
      'ROLLBACK', 'SAVEPOINT', 'VACUUM', 'ANALYZE', 'OPTIMIZE', 'REINDEX', 'PRAGMA',
      'EXPLAIN', 'SHOW', 'USE', 'CALL', 'GRANT', 'REVOKE', 'MERGE', 'REPLACE', 'TRUNCATE',
    ])
    .map((w) => w.toUpperCase()),
)

interface SqlTableRef {
  name: string
  raw: string
  alias: string | null
}

/**
 * Table references after FROM / JOIN / UPDATE / INTO / TABLE, including
 * comma-separated lists (`FROM a, b`) and `IF [NOT] EXISTS` / `ONLY` prefixes.
 * Extends `sqlAliases` (sqlComplete.ts), which only resolves tables already in
 * the schema and therefore cannot see unknown tables.
 */
function extractTableRefs(masked: string): SqlTableRef[] {
  const refs: SqlTableRef[] = []
  const kwRe = /\b(?:FROM|JOIN|UPDATE|INTO|TABLE|USING)\b/gi
  let m: RegExpExecArray | null
  while ((m = kwRe.exec(masked)) !== null) {
    // `INSERT … ON DUPLICATE KEY UPDATE a = 2` has no table after UPDATE.
    if (/^UPDATE$/i.test(m[0]) && /\bON\s+DUPLICATE\s+KEY\s+$/i.test(masked.slice(0, m.index))) continue
    let pos = m.index + m[0].length
    for (;;) {
      const lead = /^\s*(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:ONLY\s+)?/.exec(masked.slice(pos))
      pos += lead ? lead[0].length : 0
      const tm = /^((?:[`"]?[\w$]+[`"]?\s*\.\s*)?[`"]?[\w$]+[`"]?)/.exec(masked.slice(pos))
      if (!tm) break
      const raw = tm[1]
      const name = normalizeIdent(raw)
      // `DO UPDATE SET x = 1` and friends: the "table" is really a keyword.
      if (SQL_ALIAS_STOP.has(name.toUpperCase())) break
      pos += raw.length
      const am = /^\s+(?:AS\s+)?([\w$]+)/.exec(masked.slice(pos))
      let alias: string | null = null
      if (am && !SQL_ALIAS_STOP.has(am[1].toUpperCase())) {
        alias = am[1]
        pos += am[0].length
      }
      refs.push({ name, raw, alias })
      const cm = /^\s*,/.exec(masked.slice(pos))
      if (!cm) break
      pos += cm[0].length
    }
  }
  return refs
}

interface SqlAnalysis {
  keyword: string
  kind: string
  targets: string[]
  tableTokens: string[]
  filterPresent: boolean
  writes: boolean
  destructive: boolean
  isCte: boolean
  hasJoin: boolean
  hasLimit: boolean
  hasOrderBy: boolean
  whereClause: string
  issues: string[]
  summary: string
}

function sqlSummary(kind: string, targets: string[], filterPresent: boolean, writes: boolean, keyword: string): string {
  const names = targets.length ? targets.map((t) => `\`${t}\``).join(', ') : 'the database'
  switch (kind) {
    case 'select': return `Reads from ${names}${filterPresent ? ' where …' : ''}.`
    case 'insert': return `Inserts into ${names}.`
    case 'update': return filterPresent ? `Updates rows in ${names} where ….` : `Updates all rows in ${names}.`
    case 'delete': return filterPresent ? `Deletes rows from ${names} where ….` : `Deletes all rows from ${names}.`
    case 'create': return `Creates ${names}.`
    case 'alter': return `Alters ${names}.`
    case 'drop': return `Drops ${names}.`
    case 'truncate': return `Truncates ${names}.`
    case 'merge': return `Merges rows into ${names}.`
    case 'unknown': return 'Could not understand this query.'
    default: return writes ? `Runs \`${keyword.toLowerCase()}\` on ${names}.` : `Runs \`${keyword.toLowerCase()}\` (no data change).`
  }
}

function columnCandidates(masked: string, skip: Set<string>): string[] {
  const out: string[] = []
  const re = /[A-Za-z_][\w$]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(masked)) !== null) {
    const word = m[0]
    const before = masked.slice(0, m.index).replace(/\s+$/, '')
    const after = masked.slice(m.index + word.length).replace(/^\s+/, '')
    if (before.endsWith('.')) continue                  // qualified column, handled separately
    if (after.startsWith('.')) continue                  // table / alias qualifier
    if (after.startsWith('(')) continue                  // function call
    if (/\bAS$/i.test(before)) continue                  // alias definition
    if (skip.has(word.toUpperCase())) continue           // keywords, tables, aliases
    out.push(word)
  }
  return out
}

function sqlSchemaIssues(masked: string, targets: string[], aliasToTable: Map<string, string>, schema?: QuerySchema): string[] {
  const issues: string[] = []
  if (!schema?.tables?.length) return issues
  const byName = new Map(schema.tables.map((t) => [t.name.toLowerCase(), t]))
  for (const t of targets) {
    if (!byName.has(t.toLowerCase())) issues.push(`unknown table \`${t}\``)
  }
  const withCols = schema.tables.filter((t) => Array.isArray(t.columns))
  if (!withCols.length) return issues
  const colByTable = new Map(withCols.map((t) => [t.name.toLowerCase(), t.columns as string[]]))
  const resolveTable = (qualifier: string): string | undefined => {
    const q = qualifier.toLowerCase()
    return aliasToTable.get(q) ?? targets.find((t) => t.toLowerCase() === q)
  }
  const hasColumn = (cols: string[], col: string): boolean => cols.some((c) => c.toLowerCase() === col.toLowerCase())

  // Qualified references: `alias.column` / `table.column`.
  const qualRe = /([A-Za-z_][\w$]*)\s*\.\s*([A-Za-z_][\w$]*|\*)/g
  let qm: RegExpExecArray | null
  while ((qm = qualRe.exec(masked)) !== null) {
    const col = qm[2]
    if (col === '*') continue
    const table = resolveTable(qm[1])
    const cols = table ? colByTable.get(table.toLowerCase()) : undefined
    if (cols && !hasColumn(cols, col)) issues.push(`unknown column \`${col}\``)
  }

  // Unqualified references are only checked when every target table has a column
  // list, so an incomplete schema never produces false "unknown column" noise.
  const targetKnown = targets.length > 0 && targets.every((t) => colByTable.has(t.toLowerCase()))
  if (targetKnown) {
    const union = new Set<string>()
    for (const t of targets) for (const c of colByTable.get(t.toLowerCase()) ?? []) union.add(c.toLowerCase())
    const skip = new Set(SQL_NON_COLUMN_WORDS)
    for (const t of targets) {
      skip.add(t.toUpperCase())
      const alias = aliasToTable.get(t.toLowerCase())
      if (alias) skip.add(alias.toUpperCase())
    }
    for (const [alias, table] of aliasToTable) {
      if (targets.some((t) => t.toLowerCase() === table.toLowerCase())) skip.add(alias.toUpperCase())
    }
    for (const word of columnCandidates(masked, skip)) {
      if (!union.has(word.toLowerCase())) issues.push(`unknown column \`${word}\``)
    }
  }
  return dedupe(issues)
}

function analyzeSqlStatement(stmt: string, schema?: QuerySchema): SqlAnalysis {
  const masked = maskNonCode(stmt)
  // Keywords (WHERE, LIMIT, ORDER BY…) are looked up here: quoted identifiers such as "where" must not count as clauses.
  const top = blankParens(blankQuoted(masked))

  const kwMatch = /^\s*([A-Za-z_][\w$]*)/.exec(top)
  let keyword = kwMatch ? kwMatch[1].toUpperCase() : ''
  let info = SQL_KEYWORD_KIND[keyword]
  let isCte = false
  if (keyword === 'WITH') {
    isCte = true
    const main = /\b(SELECT|INSERT|UPDATE|DELETE|REPLACE|MERGE)\b/i.exec(top.slice((kwMatch?.index ?? 0) + keyword.length))
    if (main) {
      keyword = main[1].toUpperCase()
      info = SQL_KEYWORD_KIND[keyword]
    }
  }
  // `WITH d AS (DELETE … RETURNING *) SELECT …` writes even though its top level is a SELECT.
  let cteWrites = false
  if (isCte && info?.kind === 'select') {
    const inner = /\b(DELETE|UPDATE|INSERT)\b/i.exec(masked)
    if (inner) {
      keyword = inner[1].toUpperCase()
      info = SQL_KEYWORD_KIND[keyword]
      cteWrites = true
    }
  }
  if (!info) info = { kind: 'unknown', writes: true, destructive: false }

  const refs = extractTableRefs(masked)
  const targets = dedupe(refs.map((r) => r.name))
  const tableTokens = dedupe(refs.map((r) => r.raw))

  // Alias → table. `sqlAliases` resolves the schema-known tables; the raw refs
  // extend it to tables missing from the schema.
  const aliasToTable = new Map<string, string>()
  if (schema?.tables?.length) {
    const known: SqlSchema = {}
    for (const t of schema.tables) known[t.name] = t.columns ?? []
    for (const [alias, table] of sqlAliases(stmt, known)) aliasToTable.set(alias.toLowerCase(), table)
  }
  for (const r of refs) {
    aliasToTable.set(r.name.toLowerCase(), r.name)
    if (r.alias) aliasToTable.set(r.alias.toLowerCase(), r.name)
  }

  // A real WHERE match: start of line, after a newline or after a space all count.
  // The WHERE of a write hidden inside a CTE lives between parentheses, so look at the full masked text there.
  const whereMatch = /\bWHERE\b/i.exec(cteWrites ? masked : top)
  const filterPresent = !!whereMatch
  let whereClause = ''
  if (whereMatch && !cteWrites) {
    const start = whereMatch.index + whereMatch[0].length
    const cut = /\b(RETURNING|ORDER\s+BY|LIMIT|OFFSET|FETCH|FOR)\b/i.exec(top.slice(start))
    const end = cut ? start + cut.index : stmt.length
    whereClause = stmt.slice(start, end).trim()
  }

  const issues: string[] = []
  if (info.kind === 'select' && /\bSELECT\s+(?:[\w$]+\s*\.\s*)?\*/i.test(masked)) issues.push('select *')
  if (!filterPresent && (info.kind === 'update' || info.kind === 'delete')) issues.push('no filter')
  issues.push(...sqlSchemaIssues(masked, targets, aliasToTable, schema))

  const destructive = info.destructive || (!filterPresent && (info.kind === 'update' || info.kind === 'delete'))
  return {
    keyword,
    kind: info.kind,
    targets,
    tableTokens,
    filterPresent,
    writes: info.writes,
    destructive,
    isCte,
    hasJoin: /\bJOIN\b/i.test(masked),
    hasLimit: /\bLIMIT\b/i.test(top),
    hasOrderBy: /\bORDER\s+BY\b/i.test(top),
    whereClause,
    issues,
    summary: sqlSummary(info.kind, targets, filterPresent, info.writes, keyword),
  }
}

function interpretSql(text: string, schema?: QuerySchema): QueryInterpretation {
  const stmts = splitStatements(text)
  if (!stmts.length) return emptyInterpretation()
  const analyses = stmts.map((s) => analyzeSqlStatement(s, schema))
  const first = analyses[0]
  const issues = dedupe(analyses.flatMap((a) => a.issues))
  if (stmts.length > 1) issues.push('multiple statements')
  let risk: QueryRisk = 'read'
  for (const a of analyses) risk = worseRisk(risk, riskOf(a.writes, a.destructive))
  return {
    kind: first.kind,
    targets: dedupe(analyses.flatMap((a) => a.targets)),
    filterPresent: first.filterPresent,
    writes: analyses.some((a) => a.writes),
    risk,
    summary: first.summary,
    issues,
  }
}

// ── MongoDB ──────────────────────────────────────────────────────────────────

const MONGO_OPERATIONS: Record<string, string> = {
  find: 'find',
  aggregate: 'aggregate',
  insertone: 'insertOne',
  insertmany: 'insertMany',
  updateone: 'updateOne',
  updatemany: 'updateMany',
  replaceone: 'replaceOne',
  deleteone: 'deleteOne',
  deletemany: 'deleteMany',
  count: 'count',
  countdocuments: 'countDocuments',
  estimatedcount: 'estimatedCount',
  listcollections: 'listCollections',
  listdatabases: 'listDatabases',
  createcollection: 'createCollection',
  dropcollection: 'dropCollection',
  dropdatabase: 'dropDatabase',
  runcommand: 'runCommand',
}

const MONGO_NEEDS_COLLECTION = new Set([
  'find', 'aggregate', 'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne',
  'deleteOne', 'deleteMany', 'count', 'countDocuments', 'estimatedCount', 'createCollection', 'dropCollection',
])

function parseQueryDocument(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    try {
      return parseShellDoc(text, 'query', null)
    } catch {
      return null
    }
  }
}

function commandName(command: unknown): string {
  if (typeof command === 'string') return command.trim()
  const keys = isPlainObject(command) ? Object.keys(command) : []
  return keys.length ? keys[0] : ''
}

/** Top-level filter field names (first path segment), `$`-operators excluded. */
function mongoFilterFields(doc: Record<string, unknown>): string[] {
  const fields: string[] = []
  const collect = (value: unknown): void => {
    if (!isPlainObject(value)) return
    for (const key of Object.keys(value)) {
      if (key.startsWith('$')) {
        if (key === '$and' || key === '$or' || key === '$nor') {
          const list = value[key]
          if (Array.isArray(list)) for (const item of list) collect(item)
        }
        continue
      }
      fields.push(key.split('.')[0])
    }
  }
  collect(doc.filter)
  return dedupe(fields)
}

/** Field names referenced by filter/update/document (for schema and index checks). */
function mongoDocumentFields(doc: Record<string, unknown>): string[] {
  const fields = mongoFilterFields(doc)
  for (const key of ['update', 'document'] as const) {
    const value = doc[key]
    if (isPlainObject(value)) {
      for (const name of Object.keys(value)) {
        if (!name.startsWith('$')) fields.push(name.split('.')[0])
      }
    }
  }
  if (Array.isArray(doc.documents)) {
    for (const item of doc.documents) {
      if (isPlainObject(item)) for (const name of Object.keys(item)) fields.push(name.split('.')[0])
    }
  }
  return dedupe(fields)
}

function mongoSchemaIssues(doc: Record<string, unknown>, targets: string[], filterFields: string[], schema?: QuerySchema): string[] {
  const issues: string[] = []
  if (!schema?.collections?.length) return issues
  const byName = new Map(schema.collections.map((c) => [c.name.toLowerCase(), c]))
  for (const t of targets) {
    const entry = byName.get(t.toLowerCase())
    if (!entry) {
      issues.push(`unknown collection \`${t}\``)
      continue
    }
    if (entry.columns) {
      for (const field of mongoDocumentFields(doc)) {
        if (field === '_id') continue
        if (!entry.columns.some((c) => c === field || c.split('.')[0] === field)) issues.push(`unknown column \`${field}\``)
      }
    }
    if (entry.indexes) {
      const unindexed = filterFields.some((field) => field !== '_id' && !entry.indexes!.some(
        (idx) => idx === field || field.startsWith(`${idx}.`) || idx.startsWith(`${field}.`),
      ))
      if (unindexed) issues.push('unindexed field on a large collection')
    }
  }
  return dedupe(issues)
}

function interpretMongo(text: string, schema?: QuerySchema): QueryInterpretation {
  const doc = parseQueryDocument(text)
  if (!doc) {
    return {
      kind: 'unknown',
      targets: [],
      filterPresent: false,
      writes: true,
      risk: 'write',
      summary: 'Could not understand this query.',
      issues: ['invalid JSON'],
    }
  }

  const rawOp = stringField(doc.operation)
  const op = MONGO_OPERATIONS[rawOp.toLowerCase()]
  const collection = stringField(doc.collection)
  const database = stringField(doc.database)
  const filter = isPlainObject(doc.filter) ? doc.filter : {}
  const hasFilter = Object.keys(filter).length > 0
  const upsert = doc.upsert === true

  const issues: string[] = []
  let kind = 'unknown'
  let writes = true
  let destructive = false
  let filterPresent = hasFilter
  let summary = 'Could not understand this query.'

  if (!op) {
    issues.push(rawOp ? `unknown operation \`${rawOp}\`` : 'missing operation')
  } else {
    kind = op
    switch (op) {
      case 'find':
        writes = false
        summary = `Reads documents from \`${collection}\`${hasFilter ? ' where …' : ''}.`
        break
      case 'aggregate': {
        const stages: unknown[] = Array.isArray(doc.pipeline) ? doc.pipeline : []
        const stageKeys = (s: unknown): string[] => (isPlainObject(s) ? Object.keys(s) : [])
        const outStage = stages.some((s) => stageKeys(s).includes('$out'))
        const mergeStage = stages.some((s) => stageKeys(s).includes('$merge'))
        const matchFilter = stages.some((s) => {
          const m = isPlainObject(s) ? s['$match'] : undefined
          return isPlainObject(m) && Object.keys(m).length > 0
        })
        writes = outStage || mergeStage
        destructive = outStage
        filterPresent = hasFilter || matchFilter
        if (writes) issues.push('pipeline writes to a collection')
        summary = `Aggregates documents from \`${collection}\`.`
        break
      }
      case 'insertOne':
        if (!isPlainObject(doc.document)) issues.push('missing document')
        summary = `Inserts 1 document into \`${collection}\`.`
        break
      case 'insertMany': {
        const count = Array.isArray(doc.documents) ? doc.documents.length : 0
        if (!count) issues.push('missing documents')
        summary = `Inserts ${count} documents into \`${collection}\`.`
        break
      }
      case 'updateOne':
      case 'updateMany': {
        const updateDoc = isPlainObject(doc.update) ? doc.update : null
        const replacement = !!updateDoc && !Object.keys(updateDoc).some((k) => k.startsWith('$'))
        if (!updateDoc) issues.push('missing update')
        if (replacement) {
          issues.push('full document replacement')
          destructive = true
        }
        if (!hasFilter) issues.push('no filter')
        if (upsert) issues.push('upsert')
        // Many-operations without a filter touch the whole collection.
        if (op === 'updateMany' && !hasFilter) destructive = true
        summary = op === 'updateOne'
          ? `Updates 1 document in \`${collection}\`${hasFilter ? ' where …' : ''}.`
          : hasFilter ? `Updates documents in \`${collection}\` where ….` : `Updates all documents in \`${collection}\`.`
        break
      }
      case 'replaceOne':
        if (!isPlainObject(doc.document)) issues.push('missing document')
        // A replacement document wipes every field it does not list.
        issues.push('full document replacement')
        destructive = true
        if (!hasFilter) issues.push('no filter')
        if (upsert) issues.push('upsert')
        summary = `Replaces 1 document in \`${collection}\`${hasFilter ? ' where …' : ''}.`
        break
      case 'deleteOne':
        if (!hasFilter) issues.push('no filter')
        summary = `Deletes 1 document from \`${collection}\`${hasFilter ? ' where …' : ''}.`
        break
      case 'deleteMany':
        if (!hasFilter) issues.push('no filter')
        destructive = !hasFilter
        summary = hasFilter ? `Deletes documents from \`${collection}\` where ….` : `Deletes all documents from \`${collection}\`.`
        break
      case 'count':
      case 'countDocuments':
        writes = false
        summary = `Counts documents in \`${collection}\`${hasFilter ? ' where …' : ''}.`
        break
      case 'estimatedCount':
        writes = false
        summary = `Estimates the number of documents in \`${collection}\`.`
        break
      case 'listCollections':
        writes = false
        summary = 'Lists the collections.'
        break
      case 'listDatabases':
        writes = false
        summary = 'Lists the databases.'
        break
      case 'createCollection':
        summary = `Creates collection \`${collection}\`.`
        break
      case 'dropCollection':
        destructive = true
        summary = `Drops collection \`${collection}\`.`
        break
      case 'dropDatabase':
        destructive = true
        summary = `Drops database \`${database}\`.`
        break
      case 'runCommand': {
        const name = commandName(doc.command)
        const lower = name.toLowerCase()
        const read = /^(list|get|count|find|aggregate|explain|collstats|dbstats|buildinfo|ping|distinct|ismaster|hello)/.test(lower)
        writes = !read
        destructive = lower.startsWith('drop')
        summary = `Runs the \`${name}\` command${collection ? ` on \`${collection}\`` : ''}.`
        break
      }
    }
    if (MONGO_NEEDS_COLLECTION.has(op) && !collection) issues.push('missing collection')
  }

  const targets = collection ? [collection] : op === 'dropDatabase' && database ? [database] : []
  issues.push(...mongoSchemaIssues(doc, targets, mongoFilterFields(doc), schema))
  return {
    kind,
    targets,
    filterPresent,
    writes,
    risk: riskOf(writes, destructive),
    summary,
    issues: dedupe(issues),
  }
}

// ── Redis ────────────────────────────────────────────────────────────────────
// Mirrors redisReadCommands / redisWriteCommands in internal/database/redis.go.

const REDIS_READ_COMMANDS = new Set(
  'PING GET MGET EXISTS TYPE TTL PTTL STRLEN GETRANGE HGET HMGET HGETALL HLEN HEXISTS HKEYS HVALS HSCAN LRANGE LLEN LINDEX SMEMBERS SCARD SISMEMBER SSCAN ZRANGE ZREVRANGE ZCARD ZSCORE ZCOUNT ZSCAN XRANGE XREVRANGE XLEN DBSIZE INFO SCAN'.split(' '),
)
const REDIS_WRITE_COMMANDS = new Set(
  'SET MSET SETNX SETEX PSETEX DEL UNLINK EXPIRE PEXPIRE EXPIREAT PEXPIREAT PERSIST RENAME RENAMENX INCR INCRBY DECR DECRBY APPEND HSET HSETNX HDEL HINCRBY LPUSH RPUSH LPOP RPOP LSET LTRIM LREM SADD SREM SPOP ZADD ZREM ZINCRBY XADD XDEL XTRIM FLUSHDB FLUSHALL'.split(' '),
)
const REDIS_MULTI_KEY_COMMANDS = new Set(['DEL', 'UNLINK', 'MGET', 'EXISTS', 'TOUCH', 'SINTER', 'SUNION', 'SDIFF'])

function interpretRedis(text: string, _schema?: QuerySchema): QueryInterpretation {
  const doc = parseQueryDocument(text)
  if (!doc) {
    return {
      kind: 'unknown',
      targets: [],
      filterPresent: false,
      writes: true,
      risk: 'write',
      summary: 'Could not understand this query.',
      issues: ['invalid JSON'],
    }
  }

  const operation = normalizeOp(doc.operation)
  if (operation === 'scan' || operation === 'inspect') {
    const target = operation === 'scan' ? stringField(doc.pattern) || '*' : stringField(doc.key)
    const issues: string[] = []
    if (operation === 'inspect' && !target) issues.push('missing key')
    return {
      kind: operation,
      targets: target ? [target] : [],
      filterPresent: operation === 'scan' ? target !== '*' : !!target,
      writes: false,
      risk: 'read',
      summary: operation === 'scan' ? `Scans keys matching \`${target}\`.` : `Reads the value of \`${target}\`.`,
      issues,
    }
  }

  const command = stringField(doc.command).toUpperCase()
  const args = Array.isArray(doc.args) ? doc.args.map((a) => String(a)) : []
  const keys = REDIS_MULTI_KEY_COMMANDS.has(command) ? args : args.slice(0, 1)
  const keyList = keys.map((k) => `\`${k}\``).join(', ')

  if (!command) {
    return {
      kind: 'unknown',
      targets: [],
      filterPresent: false,
      writes: true,
      risk: 'write',
      summary: 'Could not understand this query.',
      issues: ['unknown command'],
    }
  }

  if (REDIS_READ_COMMANDS.has(command)) {
    const summary = command === 'GET' || command === 'MGET'
      ? `Reads ${keyList || 'a key'}.`
      : args.length ? `Reads ${keyList} with \`${command}\`.` : `Runs \`${command}\` (read-only).`
    return { kind: command.toLowerCase(), targets: keys, filterPresent: args.length > 0, writes: false, risk: 'read', summary, issues: [] }
  }

  if (REDIS_WRITE_COMMANDS.has(command)) {
    const destructive = command === 'FLUSHDB' || command === 'FLUSHALL'
    const issues = destructive ? ['no filter'] : []
    let summary = args.length ? `Writes ${keyList} with \`${command}\`.` : `Runs \`${command}\`.`
    if (command === 'DEL' || command === 'UNLINK') summary = `Deletes ${keyList}.`
    if (command === 'SET' || command === 'MSET' || command === 'SETEX' || command === 'SETNX' || command === 'PSETEX') summary = `Writes ${keyList}.`
    if (command === 'FLUSHDB') summary = 'Deletes every key in the current database.'
    if (command === 'FLUSHALL') summary = 'Deletes every key in every database.'
    return {
      kind: command.toLowerCase(),
      targets: keys,
      filterPresent: args.length > 0,
      writes: true,
      risk: riskOf(true, destructive),
      summary,
      issues,
    }
  }

  return {
    kind: 'unknown',
    targets: keys,
    filterPresent: args.length > 0,
    writes: true,
    risk: 'write',
    summary: `Runs \`${command}\`.`,
    issues: [`unknown command \`${command}\``],
  }
}

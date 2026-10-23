// "Ask AI" for the database console (FIX.md DB-3.3). Opt-in, one request per click, never executed.
// The prompt carries schema names and the current query only, never result rows; the redactor hides
// secret-looking values before the text leaves the machine and restores them in the answer.

import * as AIEngine from '../../../bindings/adomnia/aiengine'
import { createAIRedactor } from '@/lib/aiRedaction'
import { ensureAIConfigured } from '@/lib/aiEngine'
import { isAICompanionAvailable } from '@/lib/aiAvailability'
import { useSettingsStore } from '@/stores/settings'
import { redactQueryText, type QueryFamily } from './savedQueries'

const AI_QUERY_MAX_TOKENS = 1200
const MAX_TABLES = 40
const MAX_COLUMNS = 40
const MAX_INTENT_CHARS = 1000
const MAX_CURRENT_CHARS = 6000
const MAX_DIFF_LINES = 400

export interface AiSchemaTable {
  name: string
  columns: { name: string; type?: string }[]
}

export interface AiQueryRequest {
  /** postgres | mysql | sqlite | mongodb | redis */
  driver: string
  intent: string
  currentQuery: string
  /** Names only: tables/collections with their columns/fields. */
  schema: AiSchemaTable[]
}

/** True when Settings has an enabled, verified AI provider: only then does the console show "Ask AI". */
export function aiQueryAvailable(): boolean {
  return isAICompanionAvailable(useSettingsStore.getState().settings.ai)
}

const MONGO_FORMAT = [
  'Reply with ONE JSON object for the adOmnia MongoDB runner, with these keys:',
  'operation (find, aggregate, insertOne, insertMany, updateOne, updateMany, replaceOne, deleteOne, deleteMany, count, createCollection, dropCollection, runCommand),',
  'database (optional), collection, filter, projection, sort, pipeline (array), document, documents (array), update (with $set/$inc/... operators), limit, skip, upsert.',
  'Valid JSON only: double quotes, no comments, no trailing commas.',
].join(' ')
const REDIS_FORMAT = 'Reply with ONE JSON object: {"command":"GET","args":["key"]}, or {"operation":"scan","pattern":"user:*"}, or {"operation":"inspect","key":"user:1"}.'

function dialectName(driver: string): string {
  return ({ postgres: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite' } as Record<string, string>)[driver] ?? driver
}

function describeSchema(schema: readonly AiSchemaTable[]): string {
  if (!schema.length) return '(no schema loaded)'
  const lines = schema.slice(0, MAX_TABLES).map((table) => {
    const columns = table.columns.slice(0, MAX_COLUMNS).map((c) => (c.type ? `${c.name} ${c.type}` : c.name))
    return `- ${table.name}(${columns.join(', ')}${table.columns.length > MAX_COLUMNS ? ', …' : ''})`
  })
  if (schema.length > MAX_TABLES) lines.push(`… and ${schema.length - MAX_TABLES} more`)
  return lines.join('\n')
}

/** The system and user messages. Pure, so the exact request can be inspected in tests. */
export function buildQueryPrompt(request: AiQueryRequest): { system: string; user: string } {
  const family: QueryFamily = request.driver === 'mongodb' ? 'mongodb' : request.driver === 'redis' ? 'redis' : 'sql'
  const format = family === 'mongodb' ? MONGO_FORMAT : family === 'redis' ? REDIS_FORMAT : `Reply with ONE ${dialectName(request.driver)} statement, no trailing explanation.`
  const system = [
    `You write ${family === 'sql' ? dialectName(request.driver) : request.driver} queries for a developer tool.`,
    format,
    'Output only the query, optionally inside one code fence. Never invent tables or columns that are not in the schema.',
    'Prefer a read-only query unless the request clearly asks to change data. Always include a filter on writes.',
  ].join('\n')
  const current = request.currentQuery.trim().slice(0, MAX_CURRENT_CHARS)
  const user = [
    `Request: ${request.intent.trim().slice(0, MAX_INTENT_CHARS)}`,
    '',
    'Schema (names only):',
    describeSchema(request.schema),
    ...(current ? ['', 'Current query in the editor:', current] : []),
  ].join('\n')
  return { system, user }
}

/** Corpo del primo recinto markdown chiuso; scansione con indexOf, il contenuto non viene riletto dalla regex. */
function fencedQuery(response: string): string | null {
  for (let open = response.indexOf('```'); open !== -1; open = response.indexOf('```', open + 1)) {
    const lineEnd = response.indexOf('\n', open)
    if (lineEnd === -1) return null
    const close = response.indexOf('```', lineEnd)
    if (close !== -1) return response.slice(lineEnd + 1, close)
  }
  return null
}

/** Extracts the query from a model answer: first code fence if any, else the text; JSON drivers must parse. */
export function parseQueryResponse(driver: string, response: string): string {
  const text = (fencedQuery(response) ?? response).trim()
  if (!text) throw new Error('The AI did not return a query.')
  if (driver === 'mongodb' || driver === 'redis') {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      throw new Error('The AI answer is not valid JSON for this connection.')
    }
  }
  return text
}

export type DiffLine = { text: string; kind: 'same' | 'add' | 'del' }

/** Line diff for the suggestion card; falls back to "replace everything" on very large inputs. */
export function lineDiff(current: string, suggested: string): DiffLine[] {
  const a = current.replace(/\r\n/g, '\n').split('\n')
  const b = suggested.replace(/\r\n/g, '\n').split('\n')
  if (!current.trim()) return b.map((text) => ({ text, kind: 'add' as const }))
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [...a.map((text) => ({ text, kind: 'del' as const })), ...b.map((text) => ({ text, kind: 'add' as const }))]
  }
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ text: a[i], kind: 'same' }); i += 1; j += 1 }
    else if (table[i + 1][j] >= table[i][j + 1]) { out.push({ text: a[i], kind: 'del' }); i += 1 }
    else { out.push({ text: b[j], kind: 'add' }); j += 1 }
  }
  for (; i < a.length; i += 1) out.push({ text: a[i], kind: 'del' })
  for (; j < b.length; j += 1) out.push({ text: b[j], kind: 'add' })
  return out
}

/** One request to the configured provider; returns the proposed query text. Throws a readable error. */
export async function suggestQueryWithAI(request: AiQueryRequest): Promise<string> {
  if (!aiQueryAvailable()) throw new Error('Ask AI needs an AI provider: enable and test one in Settings → AI.')
  if (!request.intent.trim()) throw new Error('Describe what you want the query to do.')
  const redactor = createAIRedactor()
  // Two passes: the shared redactor (keys, tokens, connection strings; restorable) cannot see JSON keys such as
  // {"password":"pw"} or short SQL literals, so secret-looking assignments are blanked first (not restorable).
  const hide = (text: string) => redactor.redact(redactQueryText(text))
  const prompt = buildQueryPrompt({ ...request, intent: hide(request.intent), currentQuery: hide(request.currentQuery) })
  await ensureAIConfigured()
  const answer = redactor.restore(await AIEngine.Complete(prompt.system, prompt.user, AI_QUERY_MAX_TOKENS))
  return parseQueryResponse(request.driver, answer)
}

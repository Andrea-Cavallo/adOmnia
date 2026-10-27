import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../bindings/github.com/Andrea-Cavallo/adOmnia/aiengine', () => ({ Complete: vi.fn(), Configure: vi.fn() }))
vi.mock('@/lib/aiEngine', () => ({ ensureAIConfigured: vi.fn() }))
vi.mock('@/lib/aiAvailability', () => ({ isAICompanionAvailable: () => available.value }))
const available = vi.hoisted(() => ({ value: true }))

import * as AIEngine from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/aiengine'
import { buildQueryPrompt, lineDiff, parseQueryResponse, suggestQueryWithAI } from './aiQuerySuggest'

const schema = [
  { name: 'utenti', columns: [{ name: 'id', type: 'integer' }, { name: 'nome', type: 'text' }] },
  { name: 'ordini', columns: [{ name: 'id' }, { name: 'utente_id' }] },
]

describe('buildQueryPrompt', () => {
  it('carries schema names, the intent and the current query, and nothing else', () => {
    const { system, user } = buildQueryPrompt({ driver: 'postgres', intent: 'utenti senza ordini', currentQuery: 'SELECT * FROM utenti', schema })
    expect(system).toContain('PostgreSQL')
    expect(user).toContain('Request: utenti senza ordini')
    expect(user).toContain('- utenti(id integer, nome text)')
    expect(user).toContain('- ordini(id, utente_id)')
    expect(user).toContain('Current query in the editor:\nSELECT * FROM utenti')
  })

  it('describes the Mongo runner format and omits the empty current query', () => {
    const { system, user } = buildQueryPrompt({ driver: 'mongodb', intent: 'ultimi 5', currentQuery: '  ', schema: [] })
    expect(system).toContain('adOmnia MongoDB runner')
    expect(user).toContain('(no schema loaded)')
    expect(user).not.toContain('Current query')
  })

  it('bounds tables and columns', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `t${i}`, columns: Array.from({ length: 60 }, (__, j) => ({ name: `c${j}` })) }))
    const { user } = buildQueryPrompt({ driver: 'sqlite', intent: 'x', currentQuery: '', schema: many })
    expect(user).toContain('… and 20 more')
    expect(user.match(/c39/g)).toHaveLength(40)
    expect(user).not.toContain('c40,')
  })
})

describe('parseQueryResponse', () => {
  it('takes the fenced block and trims prose around it', () => {
    expect(parseQueryResponse('postgres', 'Here you go:\n```sql\nSELECT 1;\n```\nHope it helps')).toBe('SELECT 1;')
    expect(parseQueryResponse('sqlite', '  SELECT 2  ')).toBe('SELECT 2')
  })

  it('requires valid JSON for Mongo and Redis and pretty-prints it', () => {
    expect(parseQueryResponse('mongodb', '```json\n{"operation":"find","collection":"u"}\n```')).toBe('{\n  "operation": "find",\n  "collection": "u"\n}')
    expect(() => parseQueryResponse('redis', 'GET key')).toThrow('not valid JSON')
  })

  it('rejects an empty answer', () => {
    expect(() => parseQueryResponse('postgres', '   ')).toThrow('did not return')
  })
})

describe('lineDiff', () => {
  it('marks added and removed lines and keeps common ones', () => {
    expect(lineDiff('SELECT *\nFROM t', 'SELECT *\nFROM t\nWHERE id = 1')).toEqual([
      { text: 'SELECT *', kind: 'same' },
      { text: 'FROM t', kind: 'same' },
      { text: 'WHERE id = 1', kind: 'add' },
    ])
    expect(lineDiff('a\nb', 'a\nc').map((l) => l.kind)).toEqual(['same', 'del', 'add'])
  })

  it('treats an empty editor as all additions', () => {
    expect(lineDiff('', 'x\ny').map((l) => l.kind)).toEqual(['add', 'add'])
  })
})

describe('suggestQueryWithAI', () => {
  it('hides secrets on the way out and restores them in the answer', async () => {
    const token = 'sk-' + 'a'.repeat(30)
    // The real binding returns a CancellablePromise; a plain promise is enough for this call site.
    vi.mocked(AIEngine.Complete).mockImplementation(((_system: string, user: string) => {
      const placeholder = /ADOMNIA_REDACTED_\d+/.exec(user)?.[0] ?? 'missing'
      expect(user).not.toContain(token)
      return Promise.resolve(`SELECT '${placeholder}'`)
    }) as unknown as typeof AIEngine.Complete)
    const query = await suggestQueryWithAI({ driver: 'postgres', intent: 'find rows for key ' + token, currentQuery: '', schema })
    expect(query).toBe(`SELECT '${token}'`)
  })

  it('refuses without a verified provider and without an intent', async () => {
    available.value = false
    await expect(suggestQueryWithAI({ driver: 'sqlite', intent: 'x', currentQuery: '', schema })).rejects.toThrow('Settings')
    available.value = true
    await expect(suggestQueryWithAI({ driver: 'sqlite', intent: '  ', currentQuery: '', schema })).rejects.toThrow('Describe')
  })
})

describe('suggestQueryWithAI secret literals', () => {
  it('blanks JSON keys and short SQL literals that the shared redactor cannot see', async () => {
    let sent = ''
    vi.mocked(AIEngine.Complete).mockImplementation(((_system: string, user: string) => {
      sent = user
      return Promise.resolve('SELECT 1')
    }) as unknown as typeof AIEngine.Complete)
    await suggestQueryWithAI({
      driver: 'mongodb',
      intent: 'insert the user',
      currentQuery: '{"operation":"insertOne","document":{"password":"hunter2hunter2","apiKey":"abcd1234","note":"keep"}}',
      schema,
    }).catch(() => undefined)
    expect(sent).not.toContain('hunter2hunter2')
    expect(sent).not.toContain('abcd1234')
    expect(sent).toContain('"password":"<redacted>"')
    expect(sent).toContain('"note":"keep"')
    await suggestQueryWithAI({ driver: 'postgres', intent: 'x', currentQuery: "UPDATE u SET password='pw', db_password = \"p\"", schema })
    expect(sent).not.toContain("'pw'")
    expect(sent).toMatch(/password='(?:<redacted>|ADOMNIA_REDACTED_\d+)'/)
    expect(sent).toMatch(/db_password = "(?:<redacted>|ADOMNIA_REDACTED_\d+)"/)
  })
})

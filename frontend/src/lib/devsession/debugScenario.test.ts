import { describe, expect, it } from 'vitest'
import { buildEvidence, diffEvidence, jsonShape, normalizeSql, rowsDigest, scenarioBreakpoints, scenarioVars } from './debugScenario'
import type { ResponseData } from '@/lib/types'

const response = (status: number, body: string, ms = 10): ResponseData => ({ status, statusText: '', headers: {}, body, contentType: 'application/json', ms, size: body.length })

const evidence = (status: number, body: string, overrides: Partial<Parameters<typeof buildEvidence>[0]> = {}) => buildEvidence({
  service: 'users', response: response(status, body), assertions: [], hits: [], logs: [], sqlStatements: [], messages: [], queries: [], at: '2026-11-07T10:00:00Z', ...overrides,
})

describe('debug scenario', () => {
  it('describes a JSON body by its shape, not its values', () => {
    expect(jsonShape('{"id":"a1","items":[{"n":1}]}')).toEqual(['id:string', 'items:array', 'items[]:object', 'items[].n:number'])
    expect(jsonShape('{"id":"zz","items":[{"n":9}]}')).toEqual(jsonShape('{"id":"a1","items":[{"n":1}]}'))
    expect(jsonShape('not json')).toEqual([])
  })

  it('compares SQL without its literals', () => {
    expect(normalizeSql("SELECT * FROM users WHERE id = 42 AND name = 'it''s'")).toBe('SELECT * FROM users WHERE id = ? AND name = ?')
    expect(normalizeSql('select  *\n from t where a = $1')).toBe('select * from t where a = ?')
  })

  it('reports nothing for the same run and every change otherwise', () => {
    const base = evidence(200, '{"id":"1"}', {
      hits: [{ function: 'GetUser', relativePath: 'users.go', line: 10, at: '', confidence: 'likely' }],
      sqlStatements: [{ id: 'q', sessionId: 's', at: '', sql: 'SELECT 1 FROM users WHERE id = 1', source: 'log' }],
      assertions: [{ assertionId: 'a', label: 'Status equals 200', passed: true, actual: '200', expected: '200' }],
      queries: [{ sql: 'SELECT * FROM users', rows: 1, digest: rowsDigest([{ id: 1 }]) }],
    })
    expect(diffEvidence(base, { ...base, at: 'later' })).toEqual([])

    const next = evidence(500, '{"error":"boom"}', {
      assertions: [{ assertionId: 'a', label: 'Status equals 200', passed: false, actual: '500', expected: '200' }],
      queries: [{ sql: 'SELECT * FROM users', rows: 2, digest: rowsDigest([{ id: 1 }, { id: 2 }]) }],
    })
    const changes = diffEvidence(base, next)
    expect(changes).toContain('Status 200 → 500')
    expect(changes).toContain('Body field added: error:string')
    expect(changes).toContain('Body field gone: id:string')
    expect(changes).toContain('Assertion now fails: Status equals 200 (got 500)')
    expect(changes).toContain('Code path gone: GetUser users.go:10')
    expect(changes).toContain('SQL gone: SELECT ? FROM users WHERE id = ?')
    expect(changes).toContain('Data changed (1 → 2 rows): SELECT * FROM users')
  })

  it('ignores small timing noise', () => {
    const fast = evidence(200, '{}')
    expect(diffEvidence(fast, { ...fast, durationMs: 120 })).toEqual([])
    expect(diffEvidence(fast, { ...fast, durationMs: 900 })).toEqual(['Slower: 10 ms → 900 ms'])
  })

  it('keeps enabled breakpoints with their options and layers test data over the environment', () => {
    expect(scenarioBreakpoints({ 'a.go': [{ line: 3, condition: 'id == 2' }, { line: 9, disabled: true }] })).toEqual([{ relativePath: 'a.go', line: 3, condition: 'id == 2' }])
    expect(scenarioVars({ userId: '1', host: 'x' }, [{ id: 'r', key: 'userId', value: '42', enabled: true }, { id: 's', key: 'host', value: 'y', enabled: false }])).toEqual({ userId: '42', host: 'x' })
  })
})

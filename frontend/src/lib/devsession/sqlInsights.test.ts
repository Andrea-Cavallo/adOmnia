import { describe, expect, it } from 'vitest'
import { lockHint, nPlusOneHints, normalizeSQL, searchFragment, sourceForStatement, summarizeQueries } from './sqlInsights'

const q = (sql: string, extra: Record<string, unknown> = {}) => ({ id: sql, sessionId: 's', at: '', sql, source: 'proxy', ...extra }) as any

describe('SQL insights', () => {
  it('normalizes values, parameters and IN lists', () => {
    expect(normalizeSQL("SELECT * FROM users WHERE id = 42 AND name = 'O''Neil' AND x IN (1, 2, 3) AND y = $1")).toBe('select * from users where id = ? and name = ? and x in (?) and y = ?')
  })

  it('finds N+1 patterns, ignoring transaction control', () => {
    const queries = [q('BEGIN'), q('SELECT * FROM items WHERE order_id = 1', { durationMs: 2 }), q('SELECT * FROM items WHERE order_id = 2', { durationMs: 3 }), q('SELECT * FROM items WHERE order_id = 3', { durationMs: 4 }), q('COMMIT'), q('COMMIT'), q('COMMIT')]
    expect(nPlusOneHints(queries)).toEqual([{ sql: 'SELECT * FROM items WHERE order_id = 1', count: 3, totalMs: 9 }])
  })

  it('summarizes durations, slow statements, errors and transactions', () => {
    expect(summarizeQueries([q('a', { durationMs: 150 }), q('b', { durationMs: 5, error: 'x' }), q('transaction', { kind: 'transaction', durationMs: 400 })])).toEqual({ statements: 2, totalMs: 155, slow: 1, errors: 1, transactions: 1, slowestMs: 150 })
    expect(lockHint('40P01')).toContain('Deadlock')
    expect(lockHint('23505')).toBeNull()
  })

  it('maps a runtime statement back to the code that runs it', () => {
    const sites = [{ sql: 'UPDATE orders SET paid = true WHERE id = $1', site: { relativePath: 'store/sql.go', line: 22 } }, { site: { relativePath: 'x.go', line: 1 } }]
    expect(sourceForStatement('UPDATE orders  SET paid = true WHERE id = $1', sites)).toEqual({ relativePath: 'store/sql.go', line: 22 })
    expect(sourceForStatement('DELETE FROM x', sites)).toBeNull()
    expect(searchFragment('SELECT  id, name FROM users WHERE x')).toBe('SELECT id, name FROM')
  })
})

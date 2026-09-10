import { describe, expect, it } from 'vitest'
import { compileQuery, matchesQuery } from './query'
import { parseLogText } from './parse'

const events = parseLogText([
  JSON.stringify({ message: 'slow failure', duration_ms: 1500, status: 500, items: [{ code: 'A' }], optional: null }),
  JSON.stringify({ message: 'fast success', duration_ms: 100, status: 200, items: [{ code: 'B' }] }),
  JSON.stringify({ message: 'gateway failure', duration_ms: 1700, status: 502, items: [] }),
].join('\n')).events

describe('structured query expressions', () => {
  it('supports typed comparisons, precedence and parentheses', () => {
    const query = compileQuery('duration_ms > 1000 AND (status = 500 OR status = 502)')
    expect(query.error).toBe('')
    expect(events.filter((event) => matchesQuery(event, query)).map((event) => event.message)).toEqual(['slow failure', 'gateway failure'])
  })

  it('supports null, missing, ranges and array indexes without type coercion', () => {
    expect(events.filter((event) => matchesQuery(event, compileQuery('optional IS NULL')))).toHaveLength(1)
    expect(events.filter((event) => matchesQuery(event, compileQuery('unknown IS MISSING')))).toHaveLength(3)
    expect(events.filter((event) => matchesQuery(event, compileQuery('duration_ms BETWEEN 1000 AND 1800')))).toHaveLength(2)
    expect(events.filter((event) => matchesQuery(event, compileQuery('items[0].code = "A"')))).toHaveLength(1)
    expect(events.filter((event) => matchesQuery(event, compileQuery('status = "500"')))).toHaveLength(0)
  })

  it('reports exact syntax failures', () => {
    expect(compileQuery('status =').error).toContain('Expected a value')
    expect(compileQuery('(status = 500').error).toContain('closing parenthesis')
  })
})

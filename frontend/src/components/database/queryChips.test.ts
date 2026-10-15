import { describe, expect, it } from 'vitest'
import { applyChip, suggestChips } from './queryChips'
import { interpret, type DbKind } from './queryInterpreter'

const chips = (driver: DbKind, text: string) => suggestChips(driver, text, interpret(driver, text)).map((c) => c.id)

describe('suggestChips', () => {
  it('offers WHERE, LIMIT and count for a bare select', () => {
    expect(chips('postgres', 'SELECT * FROM utenti')).toEqual(['add-where', 'add-limit', 'count-rows'])
  })

  it('does not repeat what the query already has', () => {
    expect(chips('postgres', 'SELECT * FROM utenti WHERE id = 1 LIMIT 5')).toEqual(['count-rows'])
  })

  it('offers WHERE and count-first for an unfiltered update or delete', () => {
    expect(chips('mysql', 'DELETE FROM utenti')).toEqual(['add-where', 'count-first'])
    expect(chips('postgres', 'UPDATE utenti SET a = 1 WHERE id = 1')).toEqual([])
  })

  it('stays silent on scripts with several statements and on Redis', () => {
    expect(chips('postgres', 'SELECT 1; SELECT 2')).toEqual([])
    expect(chips('redis', JSON.stringify({ command: 'FLUSHALL' }))).toEqual([])
  })

  it('offers a filter and a count for an unfiltered updateMany', () => {
    const q = JSON.stringify({ operation: 'updateMany', collection: 'u', update: { $set: { a: 1 } } })
    expect(chips('mongodb', q)).toEqual(['add-filter', 'count-first'])
  })
})

describe('applyChip', () => {
  it('puts WHERE before ORDER BY / LIMIT', () => {
    expect(applyChip('postgres', 'SELECT * FROM t ORDER BY id LIMIT 5;', 'add-where')).toBe('SELECT * FROM t\nWHERE \nORDER BY id LIMIT 5')
    expect(applyChip('postgres', 'DELETE FROM t', 'add-where')).toBe('DELETE FROM t\nWHERE')
  })

  it('adds a LIMIT and strips a trailing semicolon', () => {
    expect(applyChip('sqlite', 'SELECT * FROM t;', 'add-limit')).toBe('SELECT * FROM t\nLIMIT 100')
  })

  it('turns a select into a count and a write into a read-only count', () => {
    expect(applyChip('postgres', 'SELECT a, b FROM t WHERE x = 1 ORDER BY a LIMIT 3', 'count-rows')).toBe('SELECT COUNT(*) FROM t WHERE x = 1')
    expect(applyChip('mysql', 'DELETE FROM t WHERE id > 3', 'count-first')).toBe('SELECT COUNT(*) FROM t WHERE id > 3')
  })

  it('rewrites a Mongo many-operation into a count and adds a filter placeholder', () => {
    const del = JSON.stringify({ operation: 'deleteMany', collection: 'u', filter: { a: 1 } })
    expect(JSON.parse(applyChip('mongodb', del, 'count-first'))).toEqual({ operation: 'count', collection: 'u', filter: { a: 1 } })
    expect(JSON.parse(applyChip('mongodb', '{"operation":"deleteMany","collection":"u"}', 'add-filter')).filter).toEqual({ field: 'value' })
  })

  it('leaves invalid JSON untouched', () => {
    expect(applyChip('mongodb', '{ nope', 'add-filter')).toBe('{ nope')
  })
})

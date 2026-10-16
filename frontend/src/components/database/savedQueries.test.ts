import { describe, expect, it } from 'vitest'
import {
  addSavedQuery, categorizeQuery, createHistoryRecord, createSavedQuery, exportSavedQueries, filterSavedQueries, importSavedQueries,
  MAX_HISTORY, mergeSavedQueries, migrateFavorites, migrateHistory, normalizeSavedQueries, redactQueryText, removeSavedQuery, renameSavedQuery,
  setPersonal, queryFamily, MAX_SAVED_QUERIES,
} from './savedQueries'

const find = JSON.stringify({ operation: 'find', collection: 'u', filter: {} })
const del = JSON.stringify({ operation: 'deleteMany', collection: 'u', filter: { a: 1 } })

describe('categorizeQuery', () => {
  it('uses the interpreter to pick the console category', () => {
    expect(categorizeQuery('postgres', 'SELECT 1')).toBe('search')
    expect(categorizeQuery('postgres', 'INSERT INTO t VALUES (1)')).toBe('insert')
    expect(categorizeQuery('mysql', 'UPDATE t SET a = 1 WHERE b = 2')).toBe('update')
    expect(categorizeQuery('sqlite', 'DELETE FROM t WHERE a = 1')).toBe('delete')
    expect(categorizeQuery('sqlite', 'CREATE INDEX i ON t (a)')).toBe('schema')
    expect(categorizeQuery('mongodb', del)).toBe('delete')
    expect(categorizeQuery('mongodb', JSON.stringify({ operation: 'aggregate', collection: 'u', pipeline: [] }))).toBe('aggregate')
    expect(categorizeQuery('redis', JSON.stringify({ command: 'DEL', args: ['k'] }))).toBe('delete')
    expect(categorizeQuery('mongodb', '{ nope')).toBe('search')
  })
})

describe('migrateFavorites', () => {
  it('turns bare strings into records with a family and a deduced category', () => {
    const records = migrateFavorites(['SELECT * FROM t', del, JSON.stringify({ command: 'GET', args: ['k'] }), 'SELECT * FROM t', '', 42])
    expect(records.map((r) => [r.family, r.category, r.connectionId])).toEqual([
      ['sql', 'search', null],
      ['mongodb', 'delete', null],
      ['redis', 'search', null],
    ])
    expect(records[0].name).toBe('SELECT * FROM t')
  })

  it('tolerates garbage input', () => {
    expect(migrateFavorites(null)).toEqual([])
    expect(migrateFavorites({})).toEqual([])
  })
})

describe('list operations', () => {
  const a = createSavedQuery({ query: 'SELECT 1', driver: 'postgres', connectionId: 'c1' })
  const b = createSavedQuery({ query: find, driver: 'mongodb' })

  it('replaces an identical record instead of duplicating it and respects the cap', () => {
    const list = addSavedQuery(addSavedQuery([], a), { ...a, id: 'other', name: 'again' })
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('other')
    let many: ReturnType<typeof addSavedQuery> = []
    for (let i = 0; i < MAX_SAVED_QUERIES + 5; i += 1) many = addSavedQuery(many, createSavedQuery({ query: `SELECT ${i}`, driver: 'sqlite' }))
    expect(many).toHaveLength(MAX_SAVED_QUERIES)
  })

  it('renames, removes and flags personal templates', () => {
    const list = [a, b]
    expect(renameSavedQuery(list, a.id, '  Orders  ')[0].name).toBe('Orders')
    expect(renameSavedQuery(list, a.id, '   ')[0].name).toBe(a.name)
    expect(removeSavedQuery(list, a.id)).toEqual([b])
    const flagged = setPersonal(list, b.id, true)
    expect(flagged[1].personal).toBe(true)
    expect(setPersonal(flagged, b.id, false)[1].personal).toBeUndefined()
  })

  it('filters by category, family, connection and text', () => {
    const list = [a, b]
    expect(filterSavedQueries(list, { family: 'mongodb' })).toEqual([b])
    expect(filterSavedQueries(list, { category: 'search', connectionId: 'c2' })).toEqual([b])
    expect(filterSavedQueries(list, { connectionId: 'c1' })).toEqual([a, b])
    expect(filterSavedQueries(list, { text: 'select' })).toEqual([a])
    expect(filterSavedQueries(list, { personalOnly: true })).toEqual([])
  })

  it('maps drivers to families', () => {
    expect(['postgres', 'mysql', 'sqlite', 'db2', 'mongodb', 'redis'].map(queryFamily)).toEqual(['sql', 'sql', 'sql', 'sql', 'mongodb', 'redis'])
  })
})

describe('storage and sharing', () => {
  it('drops malformed stored records and bounds the text', () => {
    const records = normalizeSavedQueries([{ query: 'SELECT 1', category: 'bogus', family: 'x' }, { query: '' }, null, 'str', { query: 'a'.repeat(30_000) }])
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ family: 'sql', category: 'search' })
    expect(records[1].query).toHaveLength(20_000)
  })

  it('redacts secret-looking literals and strips connection ids on export', () => {
    expect(redactQueryText("UPDATE u SET password = 'hunter2', token='abc' WHERE id = 1")).toBe("UPDATE u SET password = '<redacted>', token='<redacted>' WHERE id = 1")
    const rec = createSavedQuery({ query: "SELECT * FROM u WHERE api_key = 'k'", driver: 'sqlite', connectionId: 'secret-id' })
    const file = exportSavedQueries([rec])
    expect(file).not.toContain('secret-id')
    expect(file).not.toContain("'k'")
  })

  it('round-trips through a file and refuses foreign ones', () => {
    const file = exportSavedQueries([createSavedQuery({ query: 'SELECT 1', driver: 'postgres', connectionId: 'c1', personal: true })])
    const [back] = importSavedQueries(file)
    expect(back).toMatchObject({ query: 'SELECT 1', connectionId: null, personal: true })
    expect(() => importSavedQueries('not json')).toThrow('valid JSON')
    expect(() => importSavedQueries('{"format":"other"}')).toThrow('saved-queries')
  })

  it('merges imported records in front without duplicates', () => {
    const a = createSavedQuery({ query: 'SELECT 1', driver: 'sqlite' })
    const b = createSavedQuery({ query: 'SELECT 2', driver: 'sqlite' })
    expect(mergeSavedQueries([a], [b, { ...a, id: 'dup' }]).map((q) => q.query)).toEqual(['SELECT 2', 'SELECT 1'])
  })

  it('keeps the file order on import and never evicts personal templates at the cap', () => {
    const first = createSavedQuery({ query: 'SELECT 1', driver: 'sqlite' })
    const second = createSavedQuery({ query: 'SELECT 2', driver: 'sqlite' })
    expect(mergeSavedQueries([], [first, second]).map((q) => q.query)).toEqual(['SELECT 1', 'SELECT 2'])

    const mine = createSavedQuery({ query: 'SELECT mine', driver: 'sqlite', personal: true })
    let list = addSavedQuery([], mine)
    for (let i = 0; i < MAX_SAVED_QUERIES + 10; i += 1) list = addSavedQuery(list, createSavedQuery({ query: `SELECT ${i}`, driver: 'sqlite' }))
    expect(list.filter((q) => !q.personal)).toHaveLength(MAX_SAVED_QUERIES)
    expect(list.some((q) => q.personal)).toBe(true)
  })
})

describe('history records', () => {
  it('records where a query ran and deduces its category', () => {
    const record = createHistoryRecord({ query: 'DELETE FROM users', driver: 'postgres', connectionId: 'pg-1', name: 'Cleanup' })
    expect(record).toMatchObject({ name: 'Cleanup', category: 'delete', driver: 'postgres', connectionId: 'pg-1' })
    expect(record.id).toBeTruthy()
    expect(record.query).toBe('DELETE FROM users')
    expect(record.ts).toBeGreaterThan(0)
  })

  it('names a record after the flattened query when the tab had no name', () => {
    expect(createHistoryRecord({ query: 'SELECT *\nFROM users', driver: 'sqlite' }).name).toBe('SELECT * FROM users')
  })

  it('migrates bare strings and old {query, ts, label} entries into full records', () => {
    const migrated = migrateHistory(['SELECT 1', { query: 'UPDATE t SET a = 1 WHERE id = 2', ts: 5, label: 'Fix' }], 'mysql')
    expect(migrated).toHaveLength(2)
    expect(migrated[0]).toMatchObject({ query: 'SELECT 1', category: 'search', driver: 'mysql', connectionId: null })
    expect(migrated[1]).toMatchObject({ name: 'Fix', category: 'update', driver: 'mysql', ts: 5 })
  })

  it('keeps the recorded driver on already-migrated entries and ignores garbage', () => {
    const migrated = migrateHistory([{ query: 'db.users.find()', driver: 'mongodb', connectionId: 'm1' }, null, {}, { query: '   ' }, 7], 'sqlite')
    expect(migrated).toHaveLength(1)
    expect(migrated[0]).toMatchObject({ driver: 'mongodb', connectionId: 'm1', category: 'search' })
    expect(migrateHistory('nope', 'sqlite')).toEqual([])
  })

  it('caps the history at MAX_HISTORY', () => {
    const migrated = migrateHistory(Array.from({ length: MAX_HISTORY + 20 }, (_, i) => `SELECT ${i}`), 'sqlite')
    expect(migrated).toHaveLength(MAX_HISTORY)
  })
})

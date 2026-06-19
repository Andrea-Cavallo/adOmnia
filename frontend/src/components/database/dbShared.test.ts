import { describe, expect, it } from 'vitest'
import {
  blankConnection,
  createObjectQuery,
  nextQueryName,
  normalizeConnection,
  validateConnection,
  type QueryTab,
} from './dbShared'

describe('Database Studio model helpers', () => {
  it('repairs the legacy Local SQLite label when the saved driver is different', () => {
    const connection = normalizeConnection({ ...blankConnection(), driver: 'postgres', name: 'Local SQLite', port: 5432 })
    expect(connection.name).toBe('PostgreSQL Connection')
    expect(connection.driver).toBe('postgres')
  })

  it('creates a new query name without reusing a closed tab number', () => {
    const tabs = [
      { id: 'a', name: 'Query 1', query: '' },
      { id: 'b', name: 'Query 4', query: '' },
    ] satisfies QueryTab[]
    expect(nextQueryName(tabs)).toBe('Query 5')
  })

  it('validates incomplete connections before contacting the backend', () => {
    expect(validateConnection(blankConnection())).toContain('SQLite')
    expect(validateConnection({ ...blankConnection(), sqlitePath: 'C:\\data\\app.db' })).toBeNull()
    expect(validateConnection({ ...blankConnection(), driver: 'postgres', port: 5432, database: '' })).toContain('Database name')
  })

  it('builds safe minimal create statements for SQL and MongoDB', () => {
    expect(createObjectQuery('sqlite', 'audit_events')).toContain('CREATE TABLE "audit_events"')
    expect(JSON.parse(createObjectQuery('mongodb', 'audit_events'))).toEqual({ operation: 'createCollection', collection: 'audit_events' })
    expect(() => createObjectQuery('sqlite', 'bad name')).toThrow(/letters, numbers and underscores/)
  })
})

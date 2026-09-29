import { describe, expect, it } from 'vitest'
import { upsertConnectionFromRef } from './dbShared'
import type { EntityRef } from '@/lib/entities/types'
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

describe('upsertConnectionFromRef', () => {
  const ref: EntityRef = {
    kind: 'datasource', id: 'datasource:postgres@localhost:5432/payments', label: 'postgres@localhost:5432/payments',
    attrs: { type: 'postgres', host: 'localhost', port: '5432', user: 'app', database: 'payments' },
  }

  it('creates a connection without password and keeps existing ones', () => {
    const existing = [{ ...blankConnection(), name: 'Local SQLite' }]
    const { connections, id, created } = upsertConnectionFromRef(existing, ref)
    expect(created).toBe(true)
    expect(connections).toHaveLength(2)
    expect(connections[0]).toBe(existing[0])
    expect(connections[1]).toMatchObject({ id, driver: 'postgres', host: '127.0.0.1', port: 5432, user: 'app', database: 'payments', password: '' })
  })

  it('reuses a matching connection instead of duplicating it', () => {
    const first = upsertConnectionFromRef([], ref)
    const second = upsertConnectionFromRef(first.connections, ref)
    expect(second.created).toBe(false)
    expect(second.id).toBe(first.id)
    expect(second.connections).toBe(first.connections)
  })
})

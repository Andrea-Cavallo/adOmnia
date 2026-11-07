import { describe, expect, it } from 'vitest'
import type { DbConnection } from './dbShared'
import { connectionForDatasource } from './datasourceMatch'

function conn(id: string, patch: Partial<DbConnection>): DbConnection {
  return { id, name: id, driver: 'postgres', dsn: '', host: 'localhost', port: 5432, database: 'app', collection: '', user: '', password: '', sslMode: '', sqlitePath: '', ...patch }
}

describe('connectionForDatasource', () => {
  it('finds the saved connection of the captured server, loopback aliases included', () => {
    const connections = [conn('pg', { host: '127.0.0.1' }), conn('my', { driver: 'mysql', port: 3306 })]
    expect(connectionForDatasource(connections, 'postgres://localhost:5432')?.id).toBe('pg')
    expect(connectionForDatasource(connections, 'mysql://127.0.0.1:3306')?.id).toBe('my')
  })

  it('does not guess between two connections to the same server or on garbage', () => {
    const connections = [conn('a', {}), conn('b', { database: 'other' })]
    expect(connectionForDatasource(connections, 'postgres://localhost:5432')).toBeUndefined()
    expect(connectionForDatasource(connections, 'orders-db')).toBeUndefined()
    expect(connectionForDatasource(connections, undefined)).toBeUndefined()
  })
})

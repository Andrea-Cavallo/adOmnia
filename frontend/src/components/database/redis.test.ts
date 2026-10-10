import { describe, expect, it } from 'vitest'
import { blankConnection, browseQuery, createObjectQuery, DRIVER_META, introspectionQuery, isDangerousRedis, normalizeConnection, REDIS_DEFAULT_QUERY, SELECTABLE_DRIVERS, validateConnection } from './dbShared'
import { serializeDatabaseConnections } from './dbSecrets'

describe('Redis database connections', () => {
  it('offers Redis and restores it without migrating existing connections', () => {
    expect(SELECTABLE_DRIVERS).toContain('redis')
    expect(DRIVER_META.redis.port).toBe(6379)
    expect(normalizeConnection({ driver: 'redis', database: '3' })).toMatchObject({ driver: 'redis', port: 6379, database: '3' })
    expect(normalizeConnection({ driver: 'postgres', port: 5432 }).driver).toBe('postgres')
  })
  it('validates the database index and supports a URI override', () => {
    const redis = { ...blankConnection(), driver: 'redis' as const, port: 6379 }
    expect(validateConnection(redis)).toBeNull()
    expect(validateConnection({ ...redis, database: '3' })).toBeNull()
    expect(validateConnection({ ...redis, database: '-1' })).toContain('index')
    expect(validateConnection({ ...redis, database: 'app' })).toContain('index')
    expect(validateConnection({ ...redis, dsn: 'rediss://localhost:6380/0' })).toBeNull()
  })
  it('uses Redis operations for key exploration and flags writes', () => {
    expect(JSON.parse(REDIS_DEFAULT_QUERY)).toEqual({ command: 'PING', args: [] })
    expect(JSON.parse(introspectionQuery('redis')).operation).toBe('scan')
    expect(JSON.parse(browseQuery('redis', 'user:1')).key).toBe('user:1')
    expect(isDangerousRedis(browseQuery('redis', 'user:1'))).toBe(false)
    expect(isDangerousRedis(createObjectQuery('redis', 'test'))).toBe(true)
    expect(JSON.parse(createObjectQuery('redis', 'user:1')).args).toEqual(['user:1', ''])
    expect(isDangerousRedis('{"command":"GET","args":["key"]}')).toBe(false)
    expect(isDangerousRedis('{"command":"FLUSHALL"}')).toBe(true)
  })
  it('does not persist Redis URI credentials or plaintext passwords', () => {
    const stored = serializeDatabaseConnections([{ ...blankConnection(), driver: 'redis', password: 'redis-password', dsn: 'redis://default:uri-password@localhost:6379/0' }])
    expect(stored).not.toContain('redis-password')
    expect(stored).not.toContain('uri-password')
  })
})

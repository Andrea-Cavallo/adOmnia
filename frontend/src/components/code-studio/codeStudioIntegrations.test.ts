import { describe, expect, it } from 'vitest'
import {
  canOpenConfiguredDatabase, canOpenInDatabaseStudio, configuredDatabaseHandoff, describeConfiguredDatabase,
  type CodeStudioConfiguredDatabase, type CodeStudioProjectService,
} from './codeStudioIntegrations'

const service = (overrides: Partial<CodeStudioProjectService> = {}): CodeStudioProjectService => ({
  id: 'postgres', name: 'PostgreSQL', kind: 'database', modules: [], ...overrides,
})

const database = (overrides: Partial<CodeStudioConfiguredDatabase> = {}): CodeStudioConfiguredDatabase => ({
  name: 'PostgreSQL · orders', ...overrides,
})

describe('configured Spring datasources', () => {
  it('opens only when the Studio knows the driver and the target is known', () => {
    expect(canOpenConfiguredDatabase(database({ driver: 'postgres', host: 'db', port: 5432, database: 'orders' }))).toBe(true)
    expect(canOpenConfiguredDatabase(database({ vendor: 'sqlserver', host: 'sql' }))).toBe(false)
    expect(canOpenConfiguredDatabase(database({ driver: 'postgres', host: 'db' }))).toBe(false)
    expect(canOpenConfiguredDatabase(database({ driver: 'sqlite', database: 'C:/data/app.db' }))).toBe(true)
  })

  it('prefills the connection with known values and never with the declared password', () => {
    const handoff = configuredDatabaseHandoff(service(), database({
      driver: 'postgres', host: 'db.internal', port: 5433, database: 'orders', user: 'app',
      passwordConfigured: true, file: 'src/main/resources/application-prod.properties', line: 2,
    }), 'orders-service')
    expect(handoff).toMatchObject({
      name: 'PostgreSQL · orders', driver: 'postgres', host: 'db.internal', port: 5433,
      database: 'orders', user: 'app', sslMode: 'disable',
    })
    expect(handoff).not.toHaveProperty('password')
    expect(handoff?.credentialWarning).toContain('application-prod.properties')
    expect(handoff?.credentialWarning).toContain('not imported')
  })

  it('tells which values the configuration does not resolve', () => {
    const handoff = configuredDatabaseHandoff(service(), database({
      driver: 'postgres', host: 'db', database: 'orders', unresolved: ['username', 'password'],
    }), 'orders-service')
    expect(handoff?.credentialWarning).toContain('Not resolved: username, password')
  })

  it('keeps the SSL mode Spring declares', () => {
    const handoff = configuredDatabaseHandoff(service(), database({
      driver: 'postgres', host: 'db', database: 'orders', sslMode: 'require',
    }), 'orders-service')
    expect(handoff?.sslMode).toBe('require')
  })

  it('maps a SQLite datasource to the file path', () => {
    const handoff = configuredDatabaseHandoff(service({ id: 'sqlite', name: 'SQLite' }), database({
      name: 'SQLite · app.db', driver: 'sqlite', database: 'C:/project/data/app.db',
    }), 'orders-service')
    expect(handoff).toMatchObject({ driver: 'sqlite', sqlitePath: 'C:/project/data/app.db' })
  })

  it('does not offer a connection for an unsupported vendor', () => {
    expect(configuredDatabaseHandoff(service(), database({ vendor: 'sqlserver', host: 'sql' }), 'api')).toBeNull()
  })

  it('describes what is known without pretending to know what is missing', () => {
    expect(describeConfiguredDatabase(database({
      driver: 'mysql', host: 'mysql', port: 3307, database: 'billing', user: 'billing',
      profile: 'prod', file: 'src/main/resources/application-prod.yml', line: 7,
    }))).toBe('mysql:3307 · billing · user billing · profile prod · src/main/resources/application-prod.yml:7')
  })

  it('prefers the configured database over the dependency-only local default', () => {
    expect(canOpenInDatabaseStudio(service())).toBe(true)
    expect(canOpenInDatabaseStudio(service({ databases: [database({ vendor: 'h2' })] }))).toBe(false)
    expect(canOpenInDatabaseStudio(service({ id: 'sqlserver', name: 'SQL Server', databases: [database({ vendor: 'sqlserver' })] }))).toBe(false)
  })
})

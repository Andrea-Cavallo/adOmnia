import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearManagedSecretSession } from '@/lib/managedSecrets'
import { blankConnection } from './dbShared'
import {
  databaseCredentialState,
  hydrateDatabaseConnections,
  resolveDatabaseConnection,
  serializeDatabaseConnections,
} from './dbSecrets'

const resolveSecretMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/vaultRefs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/vaultRefs')>(),
  resolveSecret: resolveSecretMock,
}))

describe('Database Studio credential persistence', () => {
  beforeEach(() => {
    clearManagedSecretSession()
    resolveSecretMock.mockReset()
    resolveSecretMock.mockImplementation(async (value: string) => value === 'vault:ciphertext' ? 'runtime-secret' : value)
  })

  it('migrates legacy plaintext credentials to session-only memory', () => {
    const connection = { ...blankConnection(), id: 'legacy', driver: 'postgres' as const, dsn: 'postgres://user:secret@db/app', password: 'secret' }
    const runtime = hydrateDatabaseConnections([connection])

    expect(runtime[0].password).toBe('secret')
    expect(runtime[0].dsn).toContain('secret')
    const persisted = serializeDatabaseConnections(runtime)
    expect(persisted).not.toContain('secret')
    expect(hydrateDatabaseConnections(JSON.parse(persisted))[0].password).toBe('secret')
  })

  it('persists Vault references and reports the protected state', () => {
    const connection = { ...blankConnection(), id: 'protected', driver: 'postgres' as const, password: 'vault:ciphertext' }
    expect(databaseCredentialState(connection)).toBe('vault')
    expect(serializeDatabaseConnections([connection])).toContain('vault:ciphertext')
  })

  it('keeps a DSN without embedded credentials reusable on disk', () => {
    const connection = { ...blankConnection(), id: 'safe-dsn', driver: 'postgres' as const, dsn: 'postgres://db.internal/app' }
    const persisted = serializeDatabaseConnections([connection])

    expect(persisted).toContain('postgres://db.internal/app')
    expect(databaseCredentialState(connection)).toBe('none')
  })

  it('resolves Vault references only in the runtime database payload', async () => {
    const persisted = { ...blankConnection(), id: 'runtime', driver: 'postgres' as const, password: 'vault:ciphertext', savedInVault: true }

    const runtime = await resolveDatabaseConnection(persisted)

    expect(runtime.password).toBe('runtime-secret')
    expect(runtime.savedInVault).toBeUndefined()
    expect(persisted.password).toBe('vault:ciphertext')
    expect(resolveSecretMock).toHaveBeenCalledWith('vault:ciphertext')
  })
})

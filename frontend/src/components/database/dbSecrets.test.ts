import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearManagedSecretSession } from '@/lib/managedSecrets'
import { blankConnection } from './dbShared'
import {
  databaseCredentialState,
  hydrateDatabaseConnections,
  resolveDatabaseConnection,
  serializeDatabaseConnections,
  sealDatabaseConnection,
} from './dbSecrets'

const resolveSecretMock = vi.hoisted(() => vi.fn())
const sidecarFetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/useServerPort', () => ({ getServerPort: async () => 1234, serverUrl: (_port: number, path: string) => path, sidecarFetch: sidecarFetchMock }))

vi.mock('@/lib/vaultRefs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/vaultRefs')>(),
  resolveSecret: resolveSecretMock,
}))

describe('Database Studio credential persistence', () => {
  it('saves encrypted credentials that survive renderer restart without decryption', async () => {
    sidecarFetchMock.mockResolvedValue({ ok: true, json: async () => ({ connection: { ...blankConnection(), id: 'restart', password: 'vault:local:v1:opaque-password', dsn: 'vault:local:v1:opaque-dsn' }, fallback: false }) })
    const sealed = await sealDatabaseConnection({ ...blankConnection(), id: 'restart', password: 'restart-secret', dsn: 'postgres://user:restart-secret@db/app' })
    const persisted = serializeDatabaseConnections([sealed])
    clearManagedSecretSession()
    const restored = hydrateDatabaseConnections(JSON.parse(persisted))[0]
    expect(restored.password).toBe('vault:local:v1:opaque-password')
    expect(restored.dsn).toBe('vault:local:v1:opaque-dsn')
    expect(persisted).not.toContain('restart-secret')
    expect(databaseCredentialState(restored)).toBe('vault')
    expect(resolveSecretMock).not.toHaveBeenCalled()
  })
  it('does not silently discard credentials when encryption fails', async () => {
    sidecarFetchMock.mockResolvedValue({ ok: false, text: async () => 'Keychain unavailable' })
    await expect(sealDatabaseConnection({ ...blankConnection(), password: 'not-saved' })).rejects.toThrow('Keychain unavailable')
  })
  it('rejects plaintext serialization rather than silently discarding a password', () => {
    expect(() => serializeDatabaseConnections([{ ...blankConnection(), password: 'restart-secret' }])).toThrow('Encrypt database credentials before saving')
  })
  beforeEach(() => {
    clearManagedSecretSession()
    resolveSecretMock.mockReset()
    resolveSecretMock.mockImplementation(async (value: string) => value === 'vault:ciphertext' ? 'runtime-secret' : value)
  })

  it('keeps legacy plaintext available for encryption before migration writes', () => {
    const runtime = hydrateDatabaseConnections([{ ...blankConnection(), password: 'legacy-secret' }])
    expect(runtime[0].password).toBe('legacy-secret')
    expect(() => serializeDatabaseConnections(runtime)).toThrow('Encrypt database credentials before saving')
  })
  it('persists Vault references and reports the protected state', () => {
    const connection = { ...blankConnection(), id: 'protected', driver: 'postgres' as const, password: 'vault:ciphertext' }
    expect(databaseCredentialState(connection)).toBe('vault')
    expect(serializeDatabaseConnections([connection])).toContain('vault:ciphertext')
  })

  it('requires encryption for every DSN, including a DSN without credentials', () => {
    expect(() => serializeDatabaseConnections([{ ...blankConnection(), dsn: 'postgres://db/app' }])).toThrow('Encrypt database credentials before saving')
  })
  it('keeps Vault references opaque in runtime database payloads', async () => {
    const persisted = { ...blankConnection(), id: 'runtime', driver: 'postgres' as const, password: 'vault:ciphertext', savedInVault: true }

    const runtime = await resolveDatabaseConnection(persisted)

    expect(runtime.password).toBe('vault:ciphertext')
    expect(runtime.savedInVault).toBeUndefined()
    expect(persisted.password).toBe('vault:ciphertext')
    expect(resolveSecretMock).not.toHaveBeenCalled()
  })
})

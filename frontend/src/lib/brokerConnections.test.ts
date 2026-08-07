import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageGetMock = vi.hoisted(() => vi.fn())
const storagePutMock = vi.hoisted(() => vi.fn())
const storageDeleteMock = vi.hoisted(() => vi.fn())
const resolveSecretMock = vi.hoisted(() => vi.fn())

vi.mock('@/wailsjs/go/main/App', () => ({
  StorageDelete: storageDeleteMock,
  StorageGet: storageGetMock,
  StoragePut: storagePutMock,
}))

vi.mock('@/lib/vaultRefs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/vaultRefs')>(),
  resolveSecret: resolveSecretMock,
}))

import { clearManagedSecretSession } from './managedSecrets'
import {
  brokerConnectionCredentialState,
  hydrateBrokerConnectionConfig,
  loadLastBrokerConnection,
  resolveBrokerPayload,
  sanitizeBrokerConnectionConfig,
} from './brokerConnections'

describe('broker connection credentials', () => {
  beforeEach(() => {
    clearManagedSecretSession()
    storageGetMock.mockReset()
    storagePutMock.mockReset()
    storageDeleteMock.mockReset()
    resolveSecretMock.mockReset()
    resolveSecretMock.mockImplementation(async (value: string) => value === 'vault:ciphertext' ? 'runtime-secret' : value)
  })

  it('removes passwords and tokens from the bbolt representation', () => {
    const config = { addr: 'localhost:6379', password: 'redis-secret', nested: { token: 'nats-secret' } }
    const persisted = sanitizeBrokerConnectionConfig('last:redis', config)

    expect(JSON.stringify(persisted)).not.toContain('redis-secret')
    expect(JSON.stringify(persisted)).not.toContain('nats-secret')
    expect(hydrateBrokerConnectionConfig('last:redis', persisted)).toEqual(config)
  })

  it('treats credential-bearing URLs as session-only secrets', () => {
    const config = { url: 'amqp://guest:guest@localhost:5672/', queue: 'jobs' }
    const persisted = sanitizeBrokerConnectionConfig('last:rabbitmq', config)

    expect(persisted.url).toBe('')
    expect(hydrateBrokerConnectionConfig('last:rabbitmq', persisted).url).toBe(config.url)
  })

  it('persists Vault references and reports their state', () => {
    const config = { password: 'vault:ciphertext' }
    expect(sanitizeBrokerConnectionConfig('last:mqtt', config)).toEqual(config)
    expect(brokerConnectionCredentialState(config)).toBe('vault')
  })

  it('migrates legacy bbolt data and removes the plaintext record', async () => {
    storageGetMock.mockResolvedValueOnce('').mockResolvedValueOnce(JSON.stringify({
      version: 1,
      lastUsed: { redis: { addr: 'localhost:6379', password: 'legacy-secret' } },
      profiles: [],
    }))

    const runtime = await loadLastBrokerConnection<{ addr: string; password: string }>('redis')

    expect(runtime?.password).toBe('legacy-secret')
    expect(storagePutMock).toHaveBeenCalledWith(
      'broker_connections',
      'profiles-v2',
      expect.not.stringContaining('legacy-secret'),
    )
    expect(storageDeleteMock).toHaveBeenCalledWith('broker_connections', 'profiles-v1')
  })

  it('resolves Vault references only in the runtime broker payload', async () => {
    const persisted = { addr: 'localhost:6379', password: 'vault:ciphertext' }

    expect(await resolveBrokerPayload(persisted)).toEqual({ addr: 'localhost:6379', password: 'runtime-secret' })
    expect(persisted.password).toBe('vault:ciphertext')
    expect(resolveSecretMock).toHaveBeenCalledWith('vault:ciphertext')
  })
})

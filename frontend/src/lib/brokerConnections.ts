import { StorageDelete, StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import {
  clearManagedSecretsWithPrefix,
  hasPlaintextSecret,
  hasManagedSessionSecret,
  hydrateManagedSecret,
  persistManagedSecret,
} from '@/lib/managedSecrets'
import { encryptToVaultRef, isVaultRef, resolveSecret } from '@/lib/vaultRefs'

export type BrokerProtocol = 'kafka' | 'rabbitmq' | 'mqtt' | 'redis' | 'nats'

export interface BrokerConnectionProfile<T extends object = object> {
  id: string
  name: string
  protocol: BrokerProtocol
  config: T
  updatedAt: string
}

interface PersistedBrokerConnections {
  version: 2
  lastUsed: Partial<Record<BrokerProtocol, object>>
  profiles: BrokerConnectionProfile<object>[]
}

const STORAGE_BUCKET = 'broker_connections'
const STORAGE_KEY = 'profiles-v2'
const LEGACY_STORAGE_KEY = 'profiles-v1'
let storageQueue: Promise<void> = Promise.resolve()

function emptyState(): PersistedBrokerConnections {
  return { version: 2, lastUsed: {}, profiles: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasEmbeddedCredentials(value: string): boolean {
  if (isVaultRef(value)) return true
  try {
    const parsed = new URL(value)
    return Boolean(parsed.username || parsed.password)
  } catch {
    return /^[^\s:@/]+:[^\s@/]+@/.test(value) || /^[^\s:@/]+:[^\s@/]+@tcp\(/i.test(value)
  }
}

function isSecretField(key: string, value: string): boolean {
  if (/(password|passwd|token|secret|api[-_]?key)/i.test(key)) return true
  return /^(url|dsn)$/i.test(key) && hasEmbeddedCredentials(value)
}

function secretScope(owner: string, path: string[]): string {
  return `broker:${owner}:${path.join('.')}`
}

function mapConfigSync(
  value: unknown,
  owner: string,
  path: string[],
  transform: (scope: string, value: string) => string,
): unknown {
  if (Array.isArray(value)) return value.map((item, index) => mapConfigSync(item, owner, [...path, String(index)], transform))
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const nextPath = [...path, key]
    const scope = secretScope(owner, nextPath)
    if (typeof child === 'string' && (isSecretField(key, child) || (/^(url|dsn)$/i.test(key) && hasManagedSessionSecret(scope)))) {
      return [key, transform(scope, child)]
    }
    return [key, mapConfigSync(child, owner, nextPath, transform)]
  }))
}

async function mapConfigAsync(
  value: unknown,
  path: string[],
  transform: (value: string) => Promise<string>,
): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((item, index) => mapConfigAsync(item, [...path, String(index)], transform)))
  if (!isRecord(value)) return value
  const entries = await Promise.all(Object.entries(value).map(async ([key, child]) => {
    const nextPath = [...path, key]
    if (typeof child === 'string' && isSecretField(key, child)) return [key, await transform(child)] as const
    return [key, await mapConfigAsync(child, nextPath, transform)] as const
  }))
  return Object.fromEntries(entries)
}

export function sanitizeBrokerConnectionConfig<T extends object>(owner: string, config: T): T {
  return mapConfigSync(config, owner, [], persistManagedSecret) as T
}

export function hydrateBrokerConnectionConfig<T extends object>(owner: string, config: T): T {
  return mapConfigSync(config, owner, [], (scope, value) => {
    if (hasPlaintextSecret(value)) {
      persistManagedSecret(scope, value)
      return value
    }
    return hydrateManagedSecret(scope, value)
  }) as T
}

export function brokerConnectionCredentialState(config: object): 'none' | 'session' | 'vault' {
  let state: 'none' | 'session' | 'vault' = 'none'
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!isRecord(value)) return
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && isSecretField(key, child)) {
        if (hasPlaintextSecret(child)) state = 'session'
        else if (isVaultRef(child) && state === 'none') state = 'vault'
      } else visit(child)
    }
  }
  visit(config)
  return state
}

export async function protectBrokerConnectionConfig<T extends object>(config: T, passphrase: string): Promise<T> {
  let count = 0
  const protectedConfig = await mapConfigAsync(config, [], async (value) => {
    if (!hasPlaintextSecret(value)) return value
    count++
    return encryptToVaultRef(value, passphrase)
  }) as T
  if (!count) throw new Error('Enter a plaintext broker password, token or credential URL before protecting it')
  return protectedConfig
}

export async function resolveBrokerPayload<T>(payload: T): Promise<T> {
  return mapConfigAsync(payload, [], async (value) => isVaultRef(value) ? resolveSecret(value) : value) as Promise<T>
}

function sanitizeState(state: PersistedBrokerConnections): PersistedBrokerConnections {
  return {
    version: 2,
    lastUsed: Object.fromEntries(Object.entries(state.lastUsed).map(([protocol, config]) => [
      protocol,
      sanitizeBrokerConnectionConfig(`last:${protocol}`, config ?? {}),
    ])),
    profiles: state.profiles.map((profile) => ({
      ...profile,
      config: sanitizeBrokerConnectionConfig(`profile:${profile.id}`, profile.config),
    })),
  }
}

function hydrateState(state: PersistedBrokerConnections): PersistedBrokerConnections {
  return {
    ...state,
    lastUsed: Object.fromEntries(Object.entries(state.lastUsed).map(([protocol, config]) => [
      protocol,
      hydrateBrokerConnectionConfig(`last:${protocol}`, config ?? {}),
    ])),
    profiles: state.profiles.map((profile) => ({
      ...profile,
      config: hydrateBrokerConnectionConfig(`profile:${profile.id}`, profile.config),
    })),
  }
}

async function readState(): Promise<PersistedBrokerConnections> {
  try {
    const current = await StorageGet(STORAGE_BUCKET, STORAGE_KEY)
    const legacy = current ? '' : await StorageGet(STORAGE_BUCKET, LEGACY_STORAGE_KEY)
    const raw = current || legacy
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw) as Partial<PersistedBrokerConnections>
    const normalized: PersistedBrokerConnections = {
      version: 2,
      lastUsed: parsed.lastUsed ?? {},
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
    }
    const hydrated = hydrateState(normalized)
    const safe = sanitizeState(hydrated)
    await StoragePut(STORAGE_BUCKET, STORAGE_KEY, JSON.stringify(safe))
    if (legacy) await StorageDelete(STORAGE_BUCKET, LEGACY_STORAGE_KEY)
    return hydrated
  } catch {
    return emptyState()
  }
}

async function writeState(state: PersistedBrokerConnections): Promise<void> {
  await StoragePut(STORAGE_BUCKET, STORAGE_KEY, JSON.stringify(sanitizeState(state)))
}

async function updateState<T>(mutate: (state: PersistedBrokerConnections) => T): Promise<T> {
  let result!: T
  const operation = storageQueue.then(async () => {
    const state = await readState()
    result = mutate(state)
    await writeState(state)
  })
  storageQueue = operation.catch(() => undefined)
  await operation
  return result
}

export async function loadLastBrokerConnection<T extends object>(protocol: BrokerProtocol): Promise<Partial<T> | null> {
  const state = await readState()
  return (state.lastUsed[protocol] as Partial<T> | undefined) ?? null
}

export async function saveLastBrokerConnection<T extends object>(protocol: BrokerProtocol, config: T): Promise<void> {
  await updateState((state) => {
    state.lastUsed[protocol] = config
  })
}

export async function listBrokerConnectionProfiles<T extends object>(protocol: BrokerProtocol): Promise<Array<BrokerConnectionProfile<T>>> {
  const state = await readState()
  return state.profiles.filter((profile) => profile.protocol === protocol) as Array<BrokerConnectionProfile<T>>
}

export async function saveBrokerConnectionProfile<T extends object>(
  protocol: BrokerProtocol,
  name: string,
  config: T,
): Promise<BrokerConnectionProfile<T>> {
  return updateState((state) => {
    const profile: BrokerConnectionProfile<T> = {
      id: crypto.randomUUID(),
      name: name.trim(),
      protocol,
      config,
      updatedAt: new Date().toISOString(),
    }
    state.profiles = [profile, ...state.profiles]
    state.lastUsed[protocol] = config
    return profile
  })
}

export async function deleteBrokerConnectionProfile(id: string): Promise<void> {
  await updateState((state) => {
    state.profiles = state.profiles.filter((profile) => profile.id !== id)
  })
  clearManagedSecretsWithPrefix(`broker:profile:${id}:`)
}

import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'

export type BrokerProtocol = 'kafka' | 'rabbitmq' | 'mqtt' | 'redis' | 'nats'

export interface BrokerConnectionProfile<T extends object = object> {
  id: string
  name: string
  protocol: BrokerProtocol
  config: T
  updatedAt: string
}

interface PersistedBrokerConnections {
  version: 1
  lastUsed: Partial<Record<BrokerProtocol, object>>
  profiles: BrokerConnectionProfile<object>[]
}

const STORAGE_BUCKET = 'broker_connections'
const STORAGE_KEY = 'profiles-v1'
let storageQueue: Promise<void> = Promise.resolve()

function emptyState(): PersistedBrokerConnections {
  return { version: 1, lastUsed: {}, profiles: [] }
}

async function readState(): Promise<PersistedBrokerConnections> {
  try {
    const raw = await StorageGet(STORAGE_BUCKET, STORAGE_KEY)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw) as Partial<PersistedBrokerConnections>
    return {
      version: 1,
      lastUsed: parsed.lastUsed ?? {},
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
    }
  } catch {
    return emptyState()
  }
}

async function writeState(state: PersistedBrokerConnections): Promise<void> {
  await StoragePut(STORAGE_BUCKET, STORAGE_KEY, JSON.stringify(state))
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
}

import { safeStorageGet, safeStoragePut } from '@/lib/wailsStorage'
import type { BrokerProtocol } from '@/lib/brokerConnections'

export type BrokerWorkspaceTab = 'overview' | 'topics' | 'groups' | 'messages' | 'produce' | 'load'

export interface BrokerWorkspaceState {
  version: 1
  protocol: BrokerProtocol
  activeProfileId: string | null
  kafkaTab: BrokerWorkspaceTab
}

const STORAGE_BUCKET = 'broker_connections'
const STORAGE_KEY = 'workspace-v1'
const PROTOCOLS: readonly BrokerProtocol[] = ['kafka', 'rabbitmq', 'mqtt', 'redis', 'nats']
const KAFKA_TABS: readonly BrokerWorkspaceTab[] = ['overview', 'topics', 'groups', 'messages', 'produce', 'load']

export const DEFAULT_BROKER_WORKSPACE: BrokerWorkspaceState = {
  version: 1,
  protocol: 'kafka',
  activeProfileId: null,
  kafkaTab: 'messages',
}

export function parseBrokerWorkspace(raw: string): BrokerWorkspaceState {
  try {
    const parsed = JSON.parse(raw) as Partial<BrokerWorkspaceState>
    return {
      version: 1,
      protocol: PROTOCOLS.includes(parsed.protocol as BrokerProtocol) ? parsed.protocol as BrokerProtocol : DEFAULT_BROKER_WORKSPACE.protocol,
      activeProfileId: typeof parsed.activeProfileId === 'string' && parsed.activeProfileId.trim() ? parsed.activeProfileId : null,
      kafkaTab: KAFKA_TABS.includes(parsed.kafkaTab as BrokerWorkspaceTab) ? parsed.kafkaTab as BrokerWorkspaceTab : DEFAULT_BROKER_WORKSPACE.kafkaTab,
    }
  } catch {
    return DEFAULT_BROKER_WORKSPACE
  }
}

export async function loadBrokerWorkspace(): Promise<BrokerWorkspaceState> {
  const raw = await safeStorageGet(STORAGE_BUCKET, STORAGE_KEY)
  return raw ? parseBrokerWorkspace(raw) : DEFAULT_BROKER_WORKSPACE
}

export async function saveBrokerWorkspace(state: BrokerWorkspaceState): Promise<void> {
  await safeStoragePut(STORAGE_BUCKET, STORAGE_KEY, JSON.stringify(state))
}

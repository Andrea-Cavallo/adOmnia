import { blankRequest, type RequestItem, uid } from '@/lib/types'
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { safeSetItem } from '@/lib/safeLocalStorage'

export type FlowStepType = 'request' | 'condition' | 'wait' | 'script'
export type ConditionOperator = 'exists' | 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte'

export interface FlowStepDefinition {
  id: string
  type: FlowStepType
  name: string
  request: RequestItem
  condition?: { variable: string; operator: ConditionOperator; value: string }
  waitMs?: number
  script?: string
}

export interface SavedFlowDefinition {
  id: string
  name: string
  steps: FlowStepDefinition[]
  updatedAt: string
}

const LEGACY_STORAGE_KEY = 'adomnia.flows.v1'
const STORAGE_BUCKET = 'flows'
const STORAGE_ITEM = 'all'
const STEP_TYPES: FlowStepType[] = ['request', 'condition', 'wait', 'script']
const CONDITION_OPERATORS: ConditionOperator[] = ['exists', 'eq', 'neq', 'contains', 'gt', 'lt', 'gte', 'lte']

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function normalizeRequest(value: unknown, index: number): RequestItem {
  const fallback = blankRequest('GET')
  const source = record(value)
  return {
    ...fallback,
    ...source,
    id: typeof source.id === 'string' ? source.id : fallback.id,
    name: typeof source.name === 'string' ? source.name : `Step ${index + 1}`,
    type: 'request',
  } as RequestItem
}

function normalizeStep(value: unknown, index: number): FlowStepDefinition {
  const source = record(value)
  const rawType = source.type
  const type = typeof rawType === 'string' && STEP_TYPES.includes(rawType as FlowStepType)
    ? rawType as FlowStepType
    : 'request'
  const rawCondition = record(source.condition)
  const rawOperator = rawCondition.operator
  const operator = typeof rawOperator === 'string' && CONDITION_OPERATORS.includes(rawOperator as ConditionOperator)
    ? rawOperator as ConditionOperator
    : 'exists'
  return {
    id: typeof source.id === 'string' ? source.id : uid(),
    type,
    name: typeof source.name === 'string' ? source.name : `step${index + 1}`,
    request: normalizeRequest(source.request, index),
    condition: {
      variable: typeof rawCondition.variable === 'string' ? rawCondition.variable : '',
      operator,
      value: typeof rawCondition.value === 'string' ? rawCondition.value : '',
    },
    waitMs: typeof source.waitMs === 'number' && Number.isFinite(source.waitMs) ? Math.max(0, source.waitMs) : 500,
    script: typeof source.script === 'string' ? source.script : '',
  }
}

export function normalizeFlowDefinitions(value: unknown): SavedFlowDefinition[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    const source = record(item)
    return {
      id: typeof source.id === 'string' ? source.id : uid(),
      name: typeof source.name === 'string' ? source.name : `Flow ${index + 1}`,
      steps: Array.isArray(source.steps) ? source.steps.map(normalizeStep) : [],
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date().toISOString(),
    }
  })
}

function readLegacyDefinitions(): SavedFlowDefinition[] {
  try {
    return normalizeFlowDefinitions(JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '[]'))
  } catch {
    return []
  }
}

export async function loadFlowDefinitions(): Promise<SavedFlowDefinition[]> {
  try {
    const raw = await StorageGet(STORAGE_BUCKET, STORAGE_ITEM)
    if (raw) {
      const definitions = normalizeFlowDefinitions(JSON.parse(raw))
      await StoragePut(STORAGE_BUCKET, STORAGE_ITEM, JSON.stringify(definitions))
      safeSetItem(LEGACY_STORAGE_KEY, JSON.stringify(definitions))
      return definitions
    }
    const legacy = readLegacyDefinitions()
    if (legacy.length > 0) await saveFlowDefinitions(legacy)
    return legacy
  } catch {
    return readLegacyDefinitions()
  }
}

export async function saveFlowDefinitions(value: unknown): Promise<SavedFlowDefinition[]> {
  const definitions = normalizeFlowDefinitions(value)
  localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(definitions))
  try {
    await StoragePut(STORAGE_BUCKET, STORAGE_ITEM, JSON.stringify(definitions))
  } catch (error) {
    const goBinding = (window as unknown as {
      go?: { main?: { App?: { StoragePut?: unknown } } }
    }).go?.main?.App?.StoragePut
    if (goBinding) throw error
    // Browser development mode has no Wails storage binding; keep the local fallback useful.
  }
  return definitions
}

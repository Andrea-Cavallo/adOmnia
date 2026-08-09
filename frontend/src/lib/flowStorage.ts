import { blankRequest, type RequestItem, uid } from '@/lib/types'
import { StorageGet, StoragePut } from '@/wailsjs/go/main/App'
import { safeSetItem } from '@/lib/safeLocalStorage'
import { storageSchema } from '@/lib/storageSchemas'

export type FlowNodeType = 'start' | 'end' | 'request' | 'condition' | 'extract'
export type FlowRunStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'
export type FlowEdgeBranch = 'next' | 'success' | 'error' | 'true' | 'false' | 'else'
export type ConditionOperator = 'exists' | 'not_exists' | 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte'

export interface FlowVariableMapping {
  id: string
  name: string
  source: 'body' | 'header' | 'status' | 'expression'
  path: string
  fallback?: string
}

export interface FlowCondition {
  source: 'status' | 'header' | 'body' | 'variable' | 'expression'
  path: string
  operator: ConditionOperator
  value: string
}

export interface FlowNodeConfig {
  request?: RequestItem
  expectedStatus?: string
  stopOnFailure?: boolean
  retryCount?: number
  timeoutMs?: number
  extractions?: FlowVariableMapping[]
  condition?: FlowCondition
  endState?: 'success' | 'failed'
  note?: string
}

export interface FlowNodeDefinition {
  id: string
  mermaidKey?: string
  type: FlowNodeType
  label: string
  x: number
  y: number
  width?: number
  height?: number
  config: FlowNodeConfig
}

export interface FlowEdgeDefinition {
  id: string
  source: string
  target: string
  label?: string
  branch: FlowEdgeBranch
}

export interface FlowExecutionSettings {
  maxSteps: number
  failOnHttpError: boolean
  stopOnMissingBranch: boolean
}

export interface FlowGraphDefinition {
  nodes: FlowNodeDefinition[]
  edges: FlowEdgeDefinition[]
  viewport?: { x: number; y: number; zoom: number }
  settings: FlowExecutionSettings
}

export interface SavedFlowDefinition {
  id: string
  name: string
  graph: FlowGraphDefinition
  mermaidSource?: string
  updatedAt: string
  version: 3
}

export type FlowStepType = 'request' | 'condition' | 'wait' | 'script'

export interface FlowStepDefinition {
  id: string
  type: FlowStepType
  name: string
  request: RequestItem
  condition?: { variable: string; operator: Exclude<ConditionOperator, 'not_exists'>; value: string }
  waitMs?: number
  script?: string
}

const FLOW_STORAGE_SCHEMA = storageSchema('flows')
const LEGACY_STORAGE_KEY = FLOW_STORAGE_SCHEMA.legacyKeys?.[0] ?? 'adomnia.flows.v1'
const STORAGE_BUCKET = FLOW_STORAGE_SCHEMA.bucket
const STORAGE_ITEM = FLOW_STORAGE_SCHEMA.item
const NODE_TYPES: FlowNodeType[] = ['start', 'end', 'request', 'condition', 'extract']
const EDGE_BRANCHES: FlowEdgeBranch[] = ['next', 'success', 'error', 'true', 'false', 'else']
const CONDITION_OPERATORS: ConditionOperator[] = ['exists', 'not_exists', 'eq', 'neq', 'contains', 'gt', 'lt', 'gte', 'lte']

export const DEFAULT_FLOW_SETTINGS: FlowExecutionSettings = {
  maxSteps: 80,
  failOnHttpError: true,
  stopOnMissingBranch: true,
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeRequest(value: unknown, index: number): RequestItem {
  const fallback = blankRequest('GET', `Request ${index + 1}`)
  const source = record(value)
  return {
    ...fallback,
    ...source,
    id: stringValue(source.id, fallback.id),
    name: stringValue(source.name, fallback.name),
    type: 'request',
  } as RequestItem
}

function normalizeMapping(value: unknown, index: number): FlowVariableMapping {
  const source = record(value)
  const rawSource = source.source
  const mappingSource = rawSource === 'header' || rawSource === 'status' || rawSource === 'expression' ? rawSource : 'body'
  return {
    id: stringValue(source.id, uid()),
    name: stringValue(source.name, index === 0 ? 'token' : `var${index + 1}`),
    source: mappingSource,
    path: stringValue(source.path),
    fallback: stringValue(source.fallback),
  }
}

function normalizeCondition(value: unknown): FlowCondition {
  const source = record(value)
  const rawSource = source.source
  const conditionSource = rawSource === 'header' || rawSource === 'body' || rawSource === 'variable' || rawSource === 'expression' ? rawSource : 'status'
  const rawOperator = source.operator
  const operator = typeof rawOperator === 'string' && CONDITION_OPERATORS.includes(rawOperator as ConditionOperator)
    ? rawOperator as ConditionOperator
    : 'eq'
  return {
    source: conditionSource,
    path: stringValue(source.path, conditionSource === 'status' ? 'response.status' : ''),
    operator,
    value: stringValue(source.value, conditionSource === 'status' ? '200' : ''),
  }
}

function normalizeNode(value: unknown, index: number): FlowNodeDefinition {
  const source = record(value)
  const config = record(source.config)
  const rawType = source.type
  const type = typeof rawType === 'string' && NODE_TYPES.includes(rawType as FlowNodeType) ? rawType as FlowNodeType : 'request'
  return {
    id: stringValue(source.id, uid()),
    mermaidKey: stringValue(source.mermaidKey),
    type,
    label: stringValue(source.label, type === 'start' ? 'Start' : type === 'end' ? 'End' : `Node ${index + 1}`),
    x: numberValue(source.x, 120 + index * 260),
    y: numberValue(source.y, 160),
    width: numberValue(source.width, type === 'condition' ? 148 : 210),
    height: numberValue(source.height, type === 'condition' ? 148 : 116),
    config: {
      request: type === 'request' ? normalizeRequest(config.request, index) : undefined,
      expectedStatus: stringValue(config.expectedStatus, '2xx'),
      stopOnFailure: typeof config.stopOnFailure === 'boolean' ? config.stopOnFailure : true,
      retryCount: numberValue(config.retryCount, 0),
      timeoutMs: numberValue(config.timeoutMs, 0),
      extractions: Array.isArray(config.extractions) ? config.extractions.map(normalizeMapping) : [],
      condition: type === 'condition' ? normalizeCondition(config.condition) : undefined,
      endState: config.endState === 'failed' ? 'failed' : 'success',
      note: stringValue(config.note),
    },
  }
}

function normalizeEdge(value: unknown): FlowEdgeDefinition {
  const source = record(value)
  const rawBranch = source.branch
  const branch = typeof rawBranch === 'string' && EDGE_BRANCHES.includes(rawBranch as FlowEdgeBranch)
    ? rawBranch as FlowEdgeBranch
    : 'next'
  return {
    id: stringValue(source.id, uid()),
    source: stringValue(source.source),
    target: stringValue(source.target),
    label: stringValue(source.label, branch === 'next' ? '' : branch),
    branch,
  }
}

function normalizeGraph(value: unknown): FlowGraphDefinition {
  const source = record(value)
  const settings = record(source.settings)
  const nodes = Array.isArray(source.nodes) ? source.nodes.map(normalizeNode) : []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(source.edges)
    ? source.edges.map(normalizeEdge).filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    : []
  return {
    nodes: nodes.length > 0 ? nodes : createDefaultFlowGraph().nodes,
    edges,
    viewport: record(source.viewport) as FlowGraphDefinition['viewport'],
    settings: {
      maxSteps: numberValue(settings.maxSteps, DEFAULT_FLOW_SETTINGS.maxSteps),
      failOnHttpError: typeof settings.failOnHttpError === 'boolean' ? settings.failOnHttpError : DEFAULT_FLOW_SETTINGS.failOnHttpError,
      stopOnMissingBranch: typeof settings.stopOnMissingBranch === 'boolean' ? settings.stopOnMissingBranch : DEFAULT_FLOW_SETTINGS.stopOnMissingBranch,
    },
  }
}

function normalizeStep(value: unknown, index: number): FlowStepDefinition {
  const source = record(value)
  const rawCondition = record(source.condition)
  const rawOperator = rawCondition.operator
  const operator = typeof rawOperator === 'string' && CONDITION_OPERATORS.includes(rawOperator as ConditionOperator) && rawOperator !== 'not_exists'
    ? rawOperator as Exclude<ConditionOperator, 'not_exists'>
    : 'exists'
  const rawType = source.type
  const type = rawType === 'condition' || rawType === 'wait' || rawType === 'script' ? rawType : 'request'
  return {
    id: stringValue(source.id, uid()),
    type,
    name: stringValue(source.name, `step${index + 1}`),
    request: normalizeRequest(source.request, index),
    condition: {
      variable: stringValue(rawCondition.variable),
      operator,
      value: stringValue(rawCondition.value),
    },
    waitMs: numberValue(source.waitMs, 500),
    script: stringValue(source.script),
  }
}

function graphFromLegacySteps(steps: FlowStepDefinition[]): FlowGraphDefinition {
  const startId = uid()
  const endId = uid()
  const nodes: FlowNodeDefinition[] = [{
    id: startId,
    type: 'start',
    label: 'Start',
    x: 80,
    y: 220,
    width: 130,
    height: 74,
    config: {},
  }]
  const edges: FlowEdgeDefinition[] = []
  let previousId = startId

  steps.forEach((step, index) => {
    const nodeType: FlowNodeType = step.type === 'condition' ? 'condition' : step.type === 'script' ? 'extract' : 'request'
    const nodeId = step.id || uid()
    const node: FlowNodeDefinition = {
      id: nodeId,
      type: nodeType,
      label: step.name || `Step ${index + 1}`,
      x: 320 + index * 260,
      y: nodeType === 'condition' ? 185 : 205,
      width: nodeType === 'condition' ? 150 : 220,
      height: nodeType === 'condition' ? 150 : 122,
      config: nodeType === 'request'
        ? { request: step.request, expectedStatus: '2xx', stopOnFailure: true, extractions: [] }
        : nodeType === 'condition'
          ? {
              condition: {
                source: 'variable',
                path: step.condition?.variable ?? '',
                operator: step.condition?.operator ?? 'exists',
                value: step.condition?.value ?? '',
              },
            }
          : {
              note: step.type === 'wait'
                ? `Legacy wait step: ${step.waitMs ?? 0} ms`
                : step.script ?? '',
              extractions: [],
            },
    }
    nodes.push(node)
    edges.push({ id: uid(), source: previousId, target: nodeId, branch: 'next', label: '' })
    previousId = nodeId
  })

  nodes.push({
    id: endId,
    type: 'end',
    label: 'End success',
    x: 340 + steps.length * 260,
    y: 220,
    width: 140,
    height: 74,
    config: { endState: 'success' },
  })
  edges.push({ id: uid(), source: previousId, target: endId, branch: 'next', label: '' })
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, settings: DEFAULT_FLOW_SETTINGS }
}

export function createDefaultFlowGraph(): FlowGraphDefinition {
  const startId = uid()
  const requestId = uid()
  const conditionId = uid()
  const successEndId = uid()
  const failedEndId = uid()
  return {
    nodes: [
      { id: startId, type: 'start', label: 'Start', x: 90, y: 235, width: 130, height: 74, config: {} },
      {
        id: requestId,
        type: 'request',
        label: 'Login API',
        x: 330,
        y: 210,
        width: 230,
        height: 126,
        config: {
          request: { ...blankRequest('POST', 'Login API'), url: 'https://api.example.com/login' },
          expectedStatus: '2xx',
          stopOnFailure: true,
          extractions: [{ id: uid(), name: 'token', source: 'body', path: 'access_token' }],
        },
      },
      {
        id: conditionId,
        type: 'condition',
        label: 'Profile active?',
        x: 690,
        y: 198,
        width: 156,
        height: 156,
        config: {
          condition: { source: 'expression', path: 'response.status', operator: 'eq', value: '200' },
        },
      },
      { id: successEndId, type: 'end', label: 'End success', x: 1040, y: 155, width: 146, height: 74, config: { endState: 'success' } },
      { id: failedEndId, type: 'end', label: 'End failed', x: 1040, y: 310, width: 146, height: 74, config: { endState: 'failed' } },
    ],
    edges: [
      { id: uid(), source: startId, target: requestId, branch: 'next', label: '' },
      { id: uid(), source: requestId, target: conditionId, branch: 'success', label: 'success' },
      { id: uid(), source: conditionId, target: successEndId, branch: 'true', label: 'true' },
      { id: uid(), source: conditionId, target: failedEndId, branch: 'false', label: 'else' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: DEFAULT_FLOW_SETTINGS,
  }
}

export function normalizeFlowDefinitions(value: unknown): SavedFlowDefinition[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    const source = record(item)
    const id = stringValue(source.id, uid())
    const name = stringValue(source.name, `Flow ${index + 1}`)
    const graph = source.graph
      ? normalizeGraph(source.graph)
      : graphFromLegacySteps(Array.isArray(source.steps) ? source.steps.map(normalizeStep) : [])
    return {
      id,
      name,
      graph,
      mermaidSource: stringValue(source.mermaidSource),
      updatedAt: stringValue(source.updatedAt, new Date().toISOString()),
      version: FLOW_STORAGE_SCHEMA.currentVersion as 3,
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
  safeSetItem(LEGACY_STORAGE_KEY, JSON.stringify(definitions))
  try {
    await StoragePut(STORAGE_BUCKET, STORAGE_ITEM, JSON.stringify(definitions))
  } catch (error) {
    // Wails 3 bindings are statically imported: a failed call is a real
    // backend failure, not evidence that the bridge is absent.
    throw error
  }
  return definitions
}

import { ensureAIConfigured } from '@/lib/aiEngine'
import { flattenApiCatalog } from '@/lib/apiCatalog'
import {
  DEFAULT_FLOW_SETTINGS,
  type ConditionOperator,
  type FlowCondition,
  type FlowEdgeBranch,
  type FlowGraphDefinition,
  type FlowNodeDefinition,
  type SavedFlowDefinition,
} from '@/lib/flowStorage'
import { blankKVRow, blankRequest, type Collection, type Environment, type HttpMethod, type RequestAssertion, type RequestBody, uid } from '@/lib/types'
import * as AIEngine from '@/wailsjs/go/main/AIEngine'

export interface AiFlowContext {
  collections: Collection[]
  environments: Environment[]
}

export interface AiFlowGenerateOptions {
  instructions: string
  context: AiFlowContext
}

export interface AiFlowPreview {
  definition: SavedFlowDefinition
  summary: {
    name: string
    description: string
    stepCount: number
    apiCalls: string[]
    variables: string[]
    conditions: string[]
    assertions: string[]
    missing: string[]
    warnings: string[]
    dependencies: string[]
    destructiveOperations: string[]
    sanitizedContext: string[]
  }
}

export interface AiFlowModel {
  name: string
  description?: string
  nodes: AiFlowNode[]
  edges: AiEdge[]
  missing?: string[]
  warnings?: string[]
}

export type AiFlowNode =
  | AiHttpNode
  | AiConditionNode
  | AiEndNode

export interface AiHttpNode {
  id: string
  type: 'http-request'
  label?: string
  method: HttpMethod
  url: string
  headers?: Record<string, string>
  query?: Record<string, string>
  body?: unknown
  bodyRaw?: string
  extract?: Record<string, string>
  expectedStatus?: string
  assertions?: AiAssertion[]
  retry?: number
  timeoutMs?: number
}

export interface AiConditionNode {
  id: string
  type: 'condition'
  label?: string
  expression: string
}

export interface AiEndNode {
  id: string
  type: 'end'
  label?: string
  state?: 'success' | 'failed'
}

export interface AiEdge {
  from: string
  to: string
  condition?: 'true' | 'false' | 'success' | 'error' | 'next' | string
}

export interface AiAssertion {
  target: RequestAssertion['target']
  operator: RequestAssertion['operator']
  path?: string
  headerName?: string
  expected?: string
}

const SECRET_NAME = /(token|secret|password|passwd|pwd|api[-_ ]?key|apikey|authorization|cookie|client[-_ ]?secret|refresh)/i
const SECRET_VALUE = /(bearer\s+[a-z0-9._~+/=-]{12,}|[a-z0-9_]{20,})/i
const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
function stripFence(value: string) {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return (fenced?.[1] ?? trimmed).trim()
}

export function sanitizeAiFlowText(value: string): { text: string; replacements: string[] } {
  const replacements = new Set<string>()
  const text = value
    .split(/\r?\n/)
    .map((line) => {
      const keyValue = line.match(/^(\s*["']?[\w .-]*(?:token|secret|password|passwd|pwd|api[-_ ]?key|apikey|authorization|cookie|client[-_ ]?secret|refresh)[\w .-]*["']?\s*[:=]\s*)(.+)$/i)
      if (keyValue) {
        const keyName = keyValue[1].replace(/[^\w]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()
        const token = keyName === 'AUTHORIZATION' ? '{{ACCESS_TOKEN}}' : `{{${keyName || 'SECRET'}}}`
        replacements.add(token)
        return `${keyValue[1]}${token}`
      }
      return line.replace(SECRET_VALUE, (match) => {
        const token = match.toLowerCase().startsWith('bearer') ? '{{ACCESS_TOKEN}}' : '{{SECRET_VALUE}}'
        replacements.add(token)
        return token
      })
    })
    .join('\n')
  return { text, replacements: [...replacements] }
}

export function buildAiFlowPrompt(options: AiFlowGenerateOptions): { system: string; user: string; sanitizedContext: string[] } {
  const catalog = flattenApiCatalog(options.context.collections).slice(0, 80).map((item) => ({
    label: item.label,
    source: item.source,
    method: item.request.method,
    url: item.request.url,
    headers: item.request.headers.filter((header) => header.enabled && header.key && !SECRET_NAME.test(header.key)).map((header) => header.key),
  }))
  const env = options.context.environments.map((environment) => ({
    name: environment.name,
    variables: environment.variables
      .filter((variable) => variable.enabled)
      .map((variable) => SECRET_NAME.test(variable.key) || variable.type === 'secret' ? `${variable.key}={{SECRET}}` : `${variable.key}=${variable.value}`),
  }))
  const sanitized = sanitizeAiFlowText(options.instructions)
  return {
    system: [
      'You generate executable adOmnia API Flow JSON.',
      'Return only valid JSON. Never wrap in Markdown.',
      'Use only supported node types: http-request, condition, end.',
      'Preserve exact user-provided URLs, methods, headers, static values, assertion names, variable names, and JSON bodies.',
      'If required information is missing, put it in missing[] and use obvious placeholders such as {{baseUrl}}.',
      'Prefer catalog endpoints over invented endpoints when labels or paths match.',
    ].join('\n'),
    user: JSON.stringify({
      instructions: sanitized.text,
      outputSchema: {
        name: 'string',
        description: 'string',
        nodes: [
          { id: 'login', type: 'http-request', method: 'POST', url: '{{baseUrl}}/auth/login', headers: {}, body: {}, extract: { token: '$.access_token' }, expectedStatus: '2xx', retry: 0, timeoutMs: 30000 },
          { id: 'check', type: 'condition', expression: 'login.status == 200' },
          { id: 'done', type: 'end', state: 'success' },
        ],
        edges: [{ from: 'login', to: 'check', condition: 'success' }],
        missing: ['string'],
        warnings: ['string'],
      },
      catalog,
      environments: env,
    }, null, 2),
    sanitizedContext: sanitized.replacements,
  }
}

export function parseAiFlowResponse(raw: string): AiFlowModel {
  const parsed = JSON.parse(stripFence(raw)) as AiFlowModel
  return parsed
}

function jsonBody(body: unknown, bodyRaw?: string): RequestBody {
  if (typeof bodyRaw === 'string') return { id: uid(), name: 'Body 1', type: 'raw', raw: bodyRaw, lang: 'json', form: [] }
  if (body === undefined || body === null) return { id: uid(), name: 'Body 1', type: 'none', raw: '', lang: 'json', form: [] }
  return { id: uid(), name: 'Body 1', type: 'raw', raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2), lang: 'json', form: [] }
}

function pathFromJsonPath(path: string) {
  return path.replace(/^\$\./, '').replace(/^\$/, '')
}

function conditionFromExpression(expression: string): FlowCondition {
  const binary = expression.match(/^\s*(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/)
  if (!binary) return { source: 'expression', path: expression, operator: 'exists', value: '' }
  const [, left, op, rightRaw] = binary
  const operator: ConditionOperator = op === '==' ? 'eq' : op === '!=' ? 'neq' : op === '>' ? 'gt' : op === '<' ? 'lt' : op === '>=' ? 'gte' : 'lte'
  return { source: 'expression', path: left.trim(), operator, value: rightRaw.trim().replace(/^["']|["']$/g, '') }
}

function branchFromCondition(condition: string | undefined, sourceType: AiFlowNode['type']): FlowEdgeBranch {
  const normalized = (condition ?? '').toLowerCase()
  if (sourceType === 'condition') return normalized === 'false' || normalized === 'else' ? 'false' : 'true'
  if (normalized === 'error' || normalized === 'failed' || normalized === 'fail') return 'error'
  if (normalized === 'success' || normalized === 'ok') return 'success'
  return 'next'
}

export function validateAiFlowModel(model: AiFlowModel): string[] {
  const errors: string[] = []
  if (!model.name?.trim()) errors.push('Flow name is required.')
  if (!Array.isArray(model.nodes) || model.nodes.length === 0) errors.push('At least one node is required.')
  if (!Array.isArray(model.edges)) errors.push('Edges must be an array.')
  const ids = new Set<string>()
  for (const node of model.nodes ?? []) {
    if (!node.id?.trim()) errors.push('Every node needs an id.')
    if (ids.has(node.id)) errors.push(`Duplicate node id: ${node.id}.`)
    ids.add(node.id)
    if (node.type === 'http-request') {
      if (!HTTP_METHODS.includes(node.method)) errors.push(`${node.id} has unsupported HTTP method ${node.method}.`)
      if (!node.url?.trim()) errors.push(`${node.id} is missing a URL.`)
      if (node.bodyRaw) {
        try { JSON.parse(node.bodyRaw) } catch { errors.push(`${node.id} has invalid JSON bodyRaw.`) }
      } else if (typeof node.body === 'string' && node.body.trim().startsWith('{')) {
        try { JSON.parse(node.body) } catch { errors.push(`${node.id} has invalid JSON body.`) }
      }
    } else if (node.type === 'condition') {
      if (!node.expression?.trim()) errors.push(`${node.id} condition expression is missing.`)
    } else if (node.type !== 'end') {
      errors.push(`${(node as { id?: string }).id ?? 'node'} uses an unsupported node type.`)
    }
  }
  for (const edge of model.edges ?? []) {
    if (!ids.has(edge.from)) errors.push(`Edge source does not exist: ${edge.from}.`)
    if (!ids.has(edge.to)) errors.push(`Edge target does not exist: ${edge.to}.`)
  }
  errors.push(...detectCycles(model))
  return [...new Set(errors)]
}

function detectCycles(model: AiFlowModel): string[] {
  const outgoing = new Map<string, string[]>()
  model.edges?.forEach((edge) => outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const errors: string[] = []
  const visit = (id: string) => {
    if (visiting.has(id)) {
      errors.push(`Circular dependency detected at ${id}.`)
      return
    }
    if (visited.has(id)) return
    visiting.add(id)
    for (const next of outgoing.get(id) ?? []) visit(next)
    visiting.delete(id)
    visited.add(id)
  }
  model.nodes?.forEach((node) => visit(node.id))
  return errors
}

export function convertAiFlowToSavedDefinition(model: AiFlowModel): SavedFlowDefinition {
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]))
  const startId = uid()
  const flowNodes: FlowNodeDefinition[] = [{
    id: startId,
    mermaidKey: 'start',
    type: 'start',
    label: 'Start',
    x: 72,
    y: 210,
    width: 136,
    height: 66,
    config: {},
  }]

  model.nodes.forEach((node, index) => {
    const x = 320 + index * 280
    if (node.type === 'http-request') {
      const headers = Object.entries(node.headers ?? {}).map(([key, value]) => ({ id: uid(), key, value, enabled: true }))
      const query = Object.entries(node.query ?? {}).map(([key, value]) => ({ id: uid(), key, value, enabled: true }))
      const request = {
        ...blankRequest(node.method, node.label || node.id),
        id: uid(),
        name: node.label || node.id,
        method: node.method,
        url: node.url,
        params: query.length ? query : [blankKVRow()],
        headers: headers.length ? headers : [blankKVRow()],
        bodies: [jsonBody(node.body, node.bodyRaw)],
        activeBodyIdx: 0,
        assertions: (node.assertions ?? []).map((assertion): RequestAssertion => ({
          id: uid(),
          enabled: true,
          target: assertion.target,
          operator: assertion.operator,
          path: assertion.path,
          headerName: assertion.headerName,
          expected: assertion.expected,
        })),
      }
      flowNodes.push({
        id: node.id,
        mermaidKey: node.id,
        type: 'request',
        label: node.label || node.id,
        x,
        y: 170,
        width: 244,
        height: 126,
        config: {
          request,
          expectedStatus: node.expectedStatus || '2xx',
          stopOnFailure: true,
          retryCount: Math.max(0, Math.min(9, node.retry ?? 0)),
          timeoutMs: Math.max(0, node.timeoutMs ?? 0),
          extractions: Object.entries(node.extract ?? {}).map(([name, path]) => ({ id: uid(), name, source: 'body', path: pathFromJsonPath(path) })),
        },
      })
    } else if (node.type === 'condition') {
      flowNodes.push({
        id: node.id,
        mermaidKey: node.id,
        type: 'condition',
        label: node.label || node.id,
        x,
        y: 150,
        width: 170,
        height: 170,
        config: { condition: conditionFromExpression(node.expression) },
      })
    } else {
      flowNodes.push({
        id: node.id,
        mermaidKey: node.id,
        type: 'end',
        label: node.label || (node.state === 'failed' ? 'End failed' : 'End success'),
        x,
        y: node.state === 'failed' ? 265 : 145,
        width: 188,
        height: 74,
        config: { endState: node.state === 'failed' ? 'failed' : 'success' },
      })
    }
  })

  const incoming = new Set(model.edges.map((edge) => edge.to))
  const first = model.nodes.find((node) => !incoming.has(node.id)) ?? model.nodes[0]
  const flowEdges = first ? [{ id: uid(), source: startId, target: first.id, branch: 'next' as FlowEdgeBranch, label: '' }] : []
  flowEdges.push(...model.edges.map((edge) => ({
    id: uid(),
    source: edge.from,
    target: edge.to,
    branch: branchFromCondition(edge.condition, nodesById.get(edge.from)?.type ?? 'http-request'),
    label: edge.condition ?? '',
  })))

  const graph: FlowGraphDefinition = {
    nodes: flowNodes,
    edges: flowEdges,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: DEFAULT_FLOW_SETTINGS,
  }

  return {
    id: uid(),
    name: model.name,
    mermaidSource: '',
    updatedAt: new Date().toISOString(),
    version: 3,
    graph,
  }
}

export function summarizeAiFlow(definition: SavedFlowDefinition, model: AiFlowModel, sanitizedContext: string[]): AiFlowPreview['summary'] {
  const requests = definition.graph.nodes.filter((node) => node.type === 'request')
  return {
    name: definition.name,
    description: model.description ?? '',
    stepCount: definition.graph.nodes.length,
    apiCalls: requests.map((node) => `${node.config.request?.method} ${node.config.request?.url}`),
    variables: requests.flatMap((node) => node.config.extractions?.map((item) => `${item.name} = response.${item.source}.${item.path}`) ?? []),
    conditions: definition.graph.nodes.filter((node) => node.type === 'condition').map((node) => `${node.config.condition?.path} ${node.config.condition?.operator} ${node.config.condition?.value}`),
    assertions: requests.flatMap((node) => node.config.request?.assertions?.map((assertion) => `${assertion.target} ${assertion.operator} ${assertion.expected ?? ''}`) ?? []),
    missing: model.missing ?? [],
    warnings: [...(model.warnings ?? []), ...unsupportedWarnings(model)],
    dependencies: definition.graph.edges.map((edge) => `${edge.source} -> ${edge.target}${edge.label ? ` (${edge.label})` : ''}`),
    destructiveOperations: requests
      .filter((node) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(node.config.request?.method ?? ''))
      .map((node) => `${node.config.request?.method} ${node.config.request?.url}`),
    sanitizedContext,
  }
}

function unsupportedWarnings(model: AiFlowModel): string[] {
  const warnings: string[] = []
  const fanOut = new Map<string, number>()
  model.edges.forEach((edge) => fanOut.set(edge.from, (fanOut.get(edge.from) ?? 0) + 1))
  fanOut.forEach((count, id) => {
    const node = model.nodes.find((item) => item.id === id)
    if (count > 1 && node?.type !== 'condition') warnings.push(`Parallel fan-out from ${id} is represented as branches; current runner executes one path at a time.`)
  })
  return warnings
}

export async function generateAiFlowPreview(options: AiFlowGenerateOptions): Promise<AiFlowPreview> {
  const prompt = buildAiFlowPrompt(options)
  await ensureAIConfigured()
  const raw = await AIEngine.Complete(prompt.system, prompt.user, 4096)
  if (!raw.trim()) throw new Error('AI returned an empty response.')
  const model = parseAiFlowResponse(raw)
  const errors = validateAiFlowModel(model)
  if (errors.length > 0) throw new Error(`AI Flow schema is invalid: ${errors.join(' ')}`)
  const definition = convertAiFlowToSavedDefinition(model)
  return { definition, summary: summarizeAiFlow(definition, model, prompt.sanitizedContext) }
}

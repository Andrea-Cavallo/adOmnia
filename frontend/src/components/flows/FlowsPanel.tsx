import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  Circle,
  Diamond,
  Download,
  FileJson,
  FileText,
  GitBranch,
  Link2,
  Play,
  Plus,
  Save,
  Square,
  Trash2,
  Unlink2,
  ZoomIn,
  ZoomOut,
  XCircle,
} from 'lucide-react'
import { executeRequest } from '@/lib/executeRequest'
import { evaluateAssertions } from '@/lib/assertionEngine'
import { blankKVRow, blankRequest, type AssertionResult, type HttpMethod, type RequestItem, type ResponseData, uid } from '@/lib/types'
import { useEnvironmentsStore } from '@/stores/environments'
import {
  createDefaultFlowGraph,
  loadFlowDefinitions,
  saveFlowDefinitions,
  type ConditionOperator,
  type FlowCondition,
  type FlowEdgeBranch,
  type FlowGraphDefinition,
  type FlowNodeDefinition,
  type FlowNodeType,
  type FlowRunStatus,
  type FlowVariableMapping,
  type SavedFlowDefinition,
} from '@/lib/flowStorage'

type InspectorTab = 'edit' | 'run'
type ConnectDraft = { source: string; branch: FlowEdgeBranch } | null
type RuntimeByNode = Record<string, { status: FlowRunStatus; durationMs?: number; message?: string }>
type CanvasMenu = { x: number; y: number; nodeId?: string; edgeId?: string } | null
type MermaidShape = 'plain' | 'round' | 'diamond'

interface RunEntry {
  id: string
  nodeId: string
  nodeLabel: string
  status: FlowRunStatus
  durationMs: number
  httpStatus?: number
  request?: RequestItem
  response?: ResponseData
  assertions?: AssertionResult[]
  extracted?: Record<string, string>
  error?: string
}

interface FlowContext {
  vars: Record<string, string>
  response?: ResponseData
  responses: Record<string, ResponseData>
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const OPERATORS: ConditionOperator[] = ['exists', 'not_exists', 'eq', 'neq', 'contains', 'gt', 'lt', 'gte', 'lte']
const NODE_W = 230
const NODE_H = 126
const CANVAS_W = 2200
const CANVAS_H = 1400
const MIN_ZOOM = 0.45
const MAX_ZOOM = 1.7

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function cx(node: FlowNodeDefinition) {
  return node.x + (node.width ?? NODE_W) / 2
}

function cy(node: FlowNodeDefinition) {
  return node.y + (node.height ?? NODE_H) / 2
}

function normalizeName(text: string) {
  return text.trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '').toLowerCase()
}

function methodColor(method: string) {
  if (method === 'GET') return 'text-[var(--color-method-get)]'
  if (method === 'POST') return 'text-[var(--color-method-post)]'
  if (method === 'PUT') return 'text-[var(--color-method-put)]'
  if (method === 'PATCH') return 'text-[var(--color-method-patch)]'
  if (method === 'DELETE') return 'text-[var(--color-method-delete)]'
  return 'text-[var(--color-info)]'
}

function safeJson(body: string): unknown {
  try { return JSON.parse(body) } catch { return undefined }
}

function getPath(source: unknown, path: string): unknown {
  if (!path) return source
  return path.split('.').filter(Boolean).reduce<unknown>((value, key) => {
    if (value == null) return undefined
    if (Array.isArray(value)) return value[Number(key)]
    if (typeof value === 'object') return (value as Record<string, unknown>)[key]
    return undefined
  }, source)
}

function stringifyValue(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function valueFromMapping(mapping: FlowVariableMapping, ctx: FlowContext): string {
  let value: unknown = ''
  if (mapping.source === 'status') value = ctx.response?.status
  else if (mapping.source === 'header') value = ctx.response?.headers?.[mapping.path] ?? ctx.response?.headers?.[mapping.path.toLowerCase()]
  else if (mapping.source === 'body') value = getPath(safeJson(ctx.response?.body ?? ''), mapping.path)
  else value = resolveExpression(mapping.path, ctx)
  const result = stringifyValue(value)
  return result || mapping.fallback || ''
}

function resolveExpression(path: string, ctx: FlowContext): unknown {
  const trimmed = path.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) return ctx.vars[trimmed.slice(2, -2).trim()]
  if (trimmed.startsWith('vars.')) return ctx.vars[trimmed.slice(5)]
  if (trimmed.startsWith('response.status')) return ctx.response?.status
  if (trimmed.startsWith('response.headers.')) return ctx.response?.headers?.[trimmed.slice(17)]
  if (trimmed.startsWith('response.body.')) return getPath(safeJson(ctx.response?.body ?? ''), trimmed.slice(14))
  const [nodeKey, ...rest] = trimmed.split('.')
  if (rest.length > 0 && ctx.responses[nodeKey]) {
    const response = ctx.responses[nodeKey]
    if (rest[0] === 'status') return response.status
    if (rest[0] === 'headers') return response.headers[rest.slice(1).join('.')]
    if (rest[0] === 'body') return getPath(safeJson(response.body), rest.slice(1).join('.'))
  }
  return ctx.vars[trimmed] ?? trimmed
}

function evaluateCondition(condition: FlowCondition | undefined, ctx: FlowContext) {
  if (!condition) return { passed: false, message: 'Condition is not configured.' }
  let actual: unknown
  if (condition.source === 'status') actual = ctx.response?.status
  else if (condition.source === 'header') actual = ctx.response?.headers?.[condition.path] ?? ctx.response?.headers?.[condition.path.toLowerCase()]
  else if (condition.source === 'body') actual = getPath(safeJson(ctx.response?.body ?? ''), condition.path)
  else if (condition.source === 'variable') actual = ctx.vars[condition.path]
  else actual = resolveExpression(condition.path, ctx)

  const actualText = stringifyValue(actual)
  const expected = condition.value
  switch (condition.operator) {
    case 'exists': return { passed: actualText !== '', message: actualText !== '' ? 'value exists' : `${condition.path} is missing` }
    case 'not_exists': return { passed: actualText === '', message: actualText === '' ? 'value missing' : `${condition.path} exists` }
    case 'eq': return { passed: actualText === expected, message: `${actualText} == ${expected}` }
    case 'neq': return { passed: actualText !== expected, message: `${actualText} != ${expected}` }
    case 'contains': return { passed: actualText.includes(expected), message: `${actualText} contains ${expected}` }
    case 'gt': return { passed: Number(actualText) > Number(expected), message: `${actualText} > ${expected}` }
    case 'lt': return { passed: Number(actualText) < Number(expected), message: `${actualText} < ${expected}` }
    case 'gte': return { passed: Number(actualText) >= Number(expected), message: `${actualText} >= ${expected}` }
    case 'lte': return { passed: Number(actualText) <= Number(expected), message: `${actualText} <= ${expected}` }
  }
}

function validateFlow(graph: FlowGraphDefinition): string[] {
  const errors: string[] = []
  const starts = graph.nodes.filter((node) => node.type === 'start')
  if (starts.length !== 1) errors.push(starts.length === 0 ? 'Add exactly one Start node.' : 'Only one Start node is supported.')
  if (graph.nodes.filter((node) => node.type === 'end').length === 0) errors.push('Add at least one End node.')
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  graph.edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) errors.push('A connection points to a missing node.')
  })
  graph.nodes.forEach((node) => {
    const outgoing = graph.edges.filter((edge) => edge.source === node.id)
    const incoming = graph.edges.filter((edge) => edge.target === node.id)
    if (node.type !== 'start' && incoming.length === 0) errors.push(`${node.label} is disconnected from the flow.`)
    if (node.type !== 'end' && outgoing.length === 0) errors.push(`${node.label} has no outgoing connection.`)
    if (node.type === 'request' && !node.config.request?.url.trim()) errors.push(`${node.label} is missing a request URL.`)
    if (node.type === 'condition' && !node.config.condition?.path.trim()) errors.push(`${node.label} is missing a condition path.`)
    if (node.type === 'condition' && !outgoing.some((edge) => edge.branch === 'true')) errors.push(`${node.label} needs a true branch.`)
    if (node.type === 'condition' && !outgoing.some((edge) => edge.branch === 'false' || edge.branch === 'else')) errors.push(`${node.label} needs a false/else branch.`)
  })

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const edge of graph.edges.filter((item) => item.source === id)) {
      if (visit(edge.target)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  if (starts[0] && visit(starts[0].id)) errors.push('Circular flows are not supported yet.')
  return [...new Set(errors)]
}

function newNode(type: FlowNodeType, x: number, y: number): FlowNodeDefinition {
  const id = uid()
  if (type === 'start') return { id, type, label: 'Start', x, y, width: 130, height: 74, config: {} }
  if (type === 'end') return { id, type, label: 'End success', x, y, width: 146, height: 74, config: { endState: 'success' } }
  if (type === 'condition') return {
    id,
    type,
    label: 'IF condition',
    x,
    y,
    width: 156,
    height: 156,
    config: { condition: { source: 'expression', path: 'response.status', operator: 'eq', value: '200' } },
  }
  if (type === 'extract') return {
    id,
    type,
    label: 'Extract variables',
    x,
    y,
    width: NODE_W,
    height: 112,
    config: { extractions: [{ id: uid(), name: 'token', source: 'body', path: 'access_token' }] },
  }
  return {
    id,
    type,
    label: 'API request',
    x,
    y,
    width: NODE_W,
    height: NODE_H,
    config: { request: blankRequest('GET', 'API request'), expectedStatus: '2xx', stopOnFailure: true, extractions: [] },
  }
}

function parseMermaidEndpoint(raw: string): { key: string; label: string; shape: MermaidShape } {
  const text = raw.trim().replace(/;$/, '')
  const keyMatch = text.match(/^([A-Za-z0-9_.:-]+)/)
  if (!keyMatch) return { key: normalizeName(text) || uid(), label: text || 'API request', shape: 'plain' }
  const key = keyMatch[1]
  const rest = text.slice(key.length).trim()
  if (rest.startsWith('((') && rest.includes('))')) {
    const label = rest.slice(2, rest.indexOf('))')).trim()
    return { key, label: label || key, shape: 'round' }
  }
  if (rest.startsWith('{') && rest.includes('}')) {
    const label = rest.slice(1, rest.indexOf('}')).trim()
    return { key, label: label || key, shape: 'diamond' }
  }
  if (rest.startsWith('[') && rest.includes(']')) {
    const label = rest.slice(1, rest.indexOf(']')).trim()
    return { key, label: label || key, shape: 'plain' }
  }
  if (rest.startsWith('(') && rest.includes(')')) {
    const label = rest.slice(1, rest.indexOf(')')).trim()
    return { key, label: label || key, shape: 'round' }
  }
  return { key, label: key, shape: 'plain' }
}

function nodeTypeFromMermaid(label: string, shape: MermaidShape): FlowNodeType {
  const normalized = label.toLowerCase()
  if (shape === 'diamond' || normalized.startsWith('if ') || normalized.includes('?')) return 'condition'
  if (normalized === 'start' || normalized.startsWith('start ')) return 'start'
  if (normalized.startsWith('end') || normalized.includes('success') || normalized.includes('failed')) return 'end'
  return 'request'
}

function branchFromMermaid(label: string, sourceType: FlowNodeType): FlowEdgeBranch {
  const value = label.trim().toLowerCase()
  if (sourceType === 'condition') {
    if (value === 'false' || value === 'else' || value === 'no') return 'false'
    return 'true'
  }
  if (value === 'error' || value === 'fail' || value === 'failed') return 'error'
  if (value === 'success' || value === 'ok') return 'success'
  return 'next'
}

function parseMermaidEdgeLine(line: string): { from: string; to: string; label: string } | null {
  const arrow = line.match(/\s*(?:-->|---?>|==>|-.->|→|—>|--)\s*/)
  if (!arrow || arrow.index === undefined) return null

  const from = line.slice(0, arrow.index).trim()
  let to = line.slice(arrow.index + arrow[0].length).trim().replace(/;$/, '')
  let label = ''
  const labelMatch = to.match(/^\|([^|]*)\|\s*(.+)$/)
  if (labelMatch) {
    label = labelMatch[1].trim()
    to = labelMatch[2].trim()
  }

  if (!from || !to) return null
  return { from, to, label }
}

function rememberMermaidNode(nodesByKey: Map<string, { label: string; shape: MermaidShape }>, endpoint: { key: string; label: string; shape: MermaidShape }) {
  const existing = nodesByKey.get(endpoint.key)
  if (!existing) {
    nodesByKey.set(endpoint.key, { label: endpoint.label, shape: endpoint.shape })
    return
  }

  const existingHasShape = existing.shape !== 'plain'
  const nextHasShape = endpoint.shape !== 'plain'
  const existingHasLabel = existing.label !== endpoint.key
  const nextHasLabel = endpoint.label !== endpoint.key

  nodesByKey.set(endpoint.key, {
    label: nextHasLabel && (!existingHasLabel || nextHasShape) ? endpoint.label : existing.label,
    shape: nextHasShape && !existingHasShape ? endpoint.shape : existing.shape,
  })
}

function graphFromMermaid(source: string): FlowGraphDefinition {
  const nodesByKey = new Map<string, { label: string; shape: MermaidShape }>()
  const edgeSeeds: { source: string; target: string; label: string }[] = []

  source.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('%%') || /^(graph|flowchart)\s+/i.test(trimmed)) return
    const edge = parseMermaidEdgeLine(trimmed)
    if (!edge) {
      const endpoint = parseMermaidEndpoint(trimmed)
      rememberMermaidNode(nodesByKey, endpoint)
      return
    }
    const from = parseMermaidEndpoint(edge.from)
    const to = parseMermaidEndpoint(edge.to)
    rememberMermaidNode(nodesByKey, from)
    rememberMermaidNode(nodesByKey, to)
    edgeSeeds.push({ source: from.key, target: to.key, label: edge.label })
  })

  const keys = [...nodesByKey.keys()]
  const incoming = new Map(keys.map((key) => [key, 0]))
  edgeSeeds.forEach((edge) => incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1))
  const startKey = keys.find((key) => {
    const seed = nodesByKey.get(key)
    return seed && nodeTypeFromMermaid(seed.label, seed.shape) === 'start'
  }) ?? keys.find((key) => (incoming.get(key) ?? 0) === 0) ?? keys[0]

  const ordered: string[] = []
  const queue = startKey ? [startKey] : []
  const seen = new Set<string>()
  while (queue.length) {
    const key = queue.shift()!
    if (seen.has(key)) continue
    seen.add(key)
    ordered.push(key)
    edgeSeeds.filter((edge) => edge.source === key).forEach((edge) => queue.push(edge.target))
  }
  keys.forEach((key) => { if (!seen.has(key)) ordered.push(key) })

  const keyToId = new Map<string, string>()
  const nodes = ordered.map((key, index) => {
    const seed = nodesByKey.get(key) ?? { label: key, shape: 'plain' as MermaidShape }
    const type = nodeTypeFromMermaid(seed.label, seed.shape)
    const node = newNode(type, 90 + index * 300, type === 'condition' ? 190 : 220)
    keyToId.set(key, node.id)
    return {
      ...node,
      label: seed.label,
      config: type === 'request'
        ? { ...node.config, request: { ...(node.config.request ?? blankRequest('GET', seed.label)), name: seed.label } }
          : type === 'condition'
          ? { ...node.config, condition: { source: 'expression' as const, path: 'response.status', operator: 'eq' as const, value: '200' } }
          : node.config,
    }
  })

  const edges = edgeSeeds.flatMap((edge) => {
    const sourceId = keyToId.get(edge.source)
    const targetId = keyToId.get(edge.target)
    const source = nodes.find((node) => node.id === sourceId)
    if (!sourceId || !targetId || !source) return []
    const branch = branchFromMermaid(edge.label, source.type)
    return [{ id: uid(), source: sourceId, target: targetId, branch, label: edge.label || (branch === 'next' ? '' : branch) }]
  })

  return { nodes: nodes.length ? nodes : createDefaultFlowGraph().nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, settings: createDefaultFlowGraph().settings }
}

function exportRunMarkdown(flowName: string, run: RunEntry[], vars: Record<string, string>) {
  const lines = [`# Flow run: ${flowName}`, '', `Generated: ${new Date().toISOString()}`, '']
  lines.push('| Node | Status | HTTP | Duration | Extracted |')
  lines.push('| --- | --- | ---: | ---: | ---: |')
  run.forEach((entry) => {
    lines.push(`| ${entry.nodeLabel} | ${entry.status.toUpperCase()} | ${entry.httpStatus ?? '-'} | ${entry.durationMs.toFixed(0)}ms | ${Object.keys(entry.extracted ?? {}).length} |`)
    if (entry.error) lines.push(`| ${entry.nodeLabel} error | ${entry.error.replace(/\|/g, '\\|')} |  |  |  |`)
  })
  lines.push('', '## Variables', '')
  Object.entries(vars).forEach(([key, value]) => lines.push(`- \`${key}\`: \`${value}\``))
  return lines.join('\n')
}

export function FlowsPanel() {
  const envVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const [flowName, setFlowName] = useState('Untitled visual flow')
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null)
  const [savedFlows, setSavedFlows] = useState<SavedFlowDefinition[]>([])
  const [graph, setGraph] = useState<FlowGraphDefinition>(() => createDefaultFlowGraph())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => graph.nodes[1]?.id ?? graph.nodes[0]?.id ?? null)
  const [runtime, setRuntime] = useState<RuntimeByNode>({})
  const [vars, setVars] = useState<Record<string, string>>({})
  const [lastRun, setLastRun] = useState<RunEntry[]>([])
  const [running, setRunning] = useState(false)
  const [connectDraft, setConnectDraft] = useState<ConnectDraft>(null)
  const [tab, setTab] = useState<InspectorTab>('edit')
  const [saveError, setSaveError] = useState('')
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenu>(null)
  const [showMermaidImport, setShowMermaidImport] = useState(false)
  const [mermaidText, setMermaidText] = useState(`flowchart LR
  Start((Start)) --> Login[Login API]
  Login -->|success| Profile[Get user profile]
  Profile --> Active{Profile active?}
  Active -->|true| Update[Call update API]
  Active -->|false| Error[Call error-handling API]
  Update --> EndSuccess((End success))
  Error --> EndFailed((End failed))`)
  const canvasScrollRef = useRef<HTMLDivElement>(null)
  const canvasContentRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null)
  const panRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    loadFlowDefinitions().then((flows) => {
      if (cancelled) return
      setSavedFlows(flows)
      if (flows[0]) loadFlow(flows[0])
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null
  const sortedSavedFlows = useMemo(() => [...savedFlows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [savedFlows])
  const validationErrors = useMemo(() => validateFlow(graph), [graph])
  const zoom = clamp(graph.viewport?.zoom ?? 1, MIN_ZOOM, MAX_ZOOM)

  const updateGraph = (next: FlowGraphDefinition) => setGraph({ ...next, nodes: [...next.nodes], edges: [...next.edges] })
  const patchViewport = (patch: Partial<NonNullable<FlowGraphDefinition['viewport']>>) => {
    setGraph((current) => ({ ...current, viewport: { x: 0, y: 0, zoom, ...(current.viewport ?? {}), ...patch } }))
  }
  const patchNode = (id: string, patch: Partial<FlowNodeDefinition>) => {
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === id ? { ...node, ...patch, config: patch.config ? { ...node.config, ...patch.config } : node.config } : node),
    }))
  }
  const patchRequest = (node: FlowNodeDefinition, patch: Partial<RequestItem>) => {
    patchNode(node.id, { config: { request: { ...(node.config.request ?? blankRequest()), ...patch } } })
  }

  const screenToCanvas = (clientX: number, clientY: number) => {
    const rect = canvasContentRef.current?.getBoundingClientRect()
    if (!rect) return { x: clientX, y: clientY }
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom }
  }

  const persistFlows = async (next: SavedFlowDefinition[]) => {
    setSavedFlows(next)
    setSaveError('')
    try {
      const normalized = await saveFlowDefinitions(next)
      setSavedFlows(normalized)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }

  const saveFlow = () => {
    const id = activeFlowId ?? uid()
    const saved: SavedFlowDefinition = {
      id,
      name: flowName.trim() || 'Untitled visual flow',
      graph,
      updatedAt: new Date().toISOString(),
      version: 3,
    }
    void persistFlows([saved, ...savedFlows.filter((flow) => flow.id !== id)])
    setActiveFlowId(id)
    setFlowName(saved.name)
  }

  const loadFlow = (flow: SavedFlowDefinition) => {
    setActiveFlowId(flow.id)
    setFlowName(flow.name)
    setGraph(flow.graph)
    setSelectedNodeId(flow.graph.nodes.find((node) => node.type === 'request')?.id ?? flow.graph.nodes[0]?.id ?? null)
    setRuntime({})
    setVars({})
    setLastRun([])
    setTab('edit')
  }

  const deleteFlow = (id: string) => {
    void persistFlows(savedFlows.filter((flow) => flow.id !== id))
    if (activeFlowId === id) {
      setActiveFlowId(null)
      updateGraph(createDefaultFlowGraph())
    }
  }

  const addNode = (type: FlowNodeType) => {
    const viewport = canvasScrollRef.current
    const x = viewport ? (viewport.scrollLeft + viewport.clientWidth / 2) / zoom - 110 : 260 + graph.nodes.length * 32
    const y = viewport ? (viewport.scrollTop + viewport.clientHeight / 2) / zoom - 70 : 180 + graph.nodes.length * 18
    const node = newNode(type, Math.round(x), Math.round(y))
    setGraph((current) => ({ ...current, nodes: [...current.nodes, node] }))
    setSelectedNodeId(node.id)
  }

  const removeNode = (id: string) => {
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== id),
      edges: current.edges.filter((edge) => edge.source !== id && edge.target !== id),
    }))
    setSelectedNodeId(null)
    setConnectDraft((draft) => draft?.source === id ? null : draft)
    setCanvasMenu(null)
  }

  const removeEdge = (id: string) => {
    setGraph((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== id) }))
    setCanvasMenu(null)
  }

  const removeNodeConnections = (id: string) => {
    setGraph((current) => ({ ...current, edges: current.edges.filter((edge) => edge.source !== id && edge.target !== id) }))
    setConnectDraft((draft) => draft?.source === id ? null : draft)
    setCanvasMenu(null)
  }

  const startDrag = (event: React.MouseEvent, node: FlowNodeDefinition) => {
    if ((event.target as HTMLElement).closest('[data-flow-control]')) return
    event.preventDefault()
    setCanvasMenu(null)
    setSelectedNodeId(node.id)
    const point = screenToCanvas(event.clientX, event.clientY)
    dragRef.current = { id: node.id, offsetX: point.x - node.x, offsetY: point.y - node.y }
    const onMove = (move: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const next = screenToCanvas(move.clientX, move.clientY)
      setGraph((current) => ({
        ...current,
        nodes: current.nodes.map((item) => item.id === drag.id ? { ...item, x: Math.round(next.x - drag.offsetX), y: Math.round(next.y - drag.offsetY) } : item),
      }))
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const startPan = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).closest('[data-flow-canvas-bg]')) return
    const viewport = canvasScrollRef.current
    if (!viewport) return
    event.preventDefault()
    setCanvasMenu(null)
    panRef.current = { x: event.clientX, y: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop }
    const onMove = (move: MouseEvent) => {
      const pan = panRef.current
      if (!pan) return
      viewport.scrollLeft = pan.scrollLeft - (move.clientX - pan.x)
      viewport.scrollTop = pan.scrollTop - (move.clientY - pan.y)
    }
    const onUp = () => {
      panRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const setCanvasZoom = (nextZoom: number) => {
    patchViewport({ zoom: clamp(Number(nextZoom.toFixed(2)), MIN_ZOOM, MAX_ZOOM) })
  }

  const handleCanvasWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    setCanvasZoom(zoom + (event.deltaY > 0 ? -0.08 : 0.08))
  }

  const connectTo = (target: string) => {
    if (!connectDraft || connectDraft.source === target) return
    const id = uid()
    setGraph((current) => ({
      ...current,
      edges: [
        ...current.edges.filter((edge) => !(edge.source === connectDraft.source && edge.branch === connectDraft.branch)),
        { id, source: connectDraft.source, target, branch: connectDraft.branch, label: connectDraft.branch === 'next' ? '' : connectDraft.branch },
      ],
    }))
    setConnectDraft(null)
    setCanvasMenu(null)
  }

  const handleNodeSelect = (nodeId: string) => {
    setSelectedNodeId(nodeId)
    setCanvasMenu(null)
    if (connectDraft && connectDraft.source !== nodeId) connectTo(nodeId)
  }

  const openNodeMenu = (event: React.MouseEvent, nodeId: string) => {
    event.preventDefault()
    event.stopPropagation()
    setSelectedNodeId(nodeId)
    setCanvasMenu({ x: event.clientX, y: event.clientY, nodeId })
  }

  const openEdgeMenu = (event: React.MouseEvent, edgeId: string) => {
    event.preventDefault()
    event.stopPropagation()
    setCanvasMenu({ x: event.clientX, y: event.clientY, edgeId })
  }

  const nextEdge = (nodeId: string, branch: FlowEdgeBranch) => {
    const preferred = graph.edges.find((edge) => edge.source === nodeId && edge.branch === branch)
    if (preferred) return preferred
    if (branch !== 'next') return graph.edges.find((edge) => edge.source === nodeId && edge.branch === 'next')
    return graph.edges.find((edge) => edge.source === nodeId)
  }

  const runFlow = async () => {
    const errors = validateFlow(graph)
    if (errors.length > 0 || running) {
      setTab('run')
      return
    }
    setRunning(true)
    setTab('run')
    const startNode = graph.nodes.find((node) => node.type === 'start')
    if (!startNode) return
    const runEntries: RunEntry[] = []
    const nodeRuntime: RuntimeByNode = Object.fromEntries(graph.nodes.map((node) => [node.id, { status: 'pending' as FlowRunStatus }]))
    setRuntime(nodeRuntime)
    let ctx: FlowContext = { vars: { ...envVars() }, responses: {} }
    let current: FlowNodeDefinition | undefined = startNode
    let steps = 0

    const setNodeStatus = (id: string, patch: RuntimeByNode[string]) => {
      nodeRuntime[id] = { ...nodeRuntime[id], ...patch }
      setRuntime({ ...nodeRuntime })
    }
    const pushEntry = (entry: RunEntry) => {
      runEntries.push(entry)
      setLastRun([...runEntries])
    }

    while (current && steps < graph.settings.maxSteps) {
      steps += 1
      setNodeStatus(current.id, { status: 'running', message: undefined })
      const start = performance.now()
      const entryBase = { id: uid(), nodeId: current.id, nodeLabel: current.label }

      if (current.type === 'start') {
        const durationMs = performance.now() - start
        setNodeStatus(current.id, { status: 'success', durationMs })
        pushEntry({ ...entryBase, status: 'success', durationMs })
        current = graph.nodes.find((node) => node.id === nextEdge(current!.id, 'next')?.target)
        continue
      }

      if (current.type === 'end') {
        const status: FlowRunStatus = current.config.endState === 'failed' ? 'failed' : 'success'
        const durationMs = performance.now() - start
        setNodeStatus(current.id, { status, durationMs, message: current.config.endState })
        pushEntry({ ...entryBase, status, durationMs })
        break
      }

      if (current.type === 'condition') {
        const result = evaluateCondition(current.config.condition, ctx)
        const durationMs = performance.now() - start
        const status: FlowRunStatus = result.passed ? 'success' : 'skipped'
        setNodeStatus(current.id, { status, durationMs, message: result.message })
        pushEntry({ ...entryBase, status, durationMs, error: result.passed ? undefined : result.message })
        const branch: FlowEdgeBranch = result.passed ? 'true' : 'false'
        const edge = nextEdge(current.id, branch) ?? nextEdge(current.id, 'else')
        if (!edge && graph.settings.stopOnMissingBranch) break
        current = graph.nodes.find((node) => node.id === edge?.target)
        continue
      }

      if (current.type === 'extract') {
        const extracted = Object.fromEntries((current.config.extractions ?? [])
          .filter((mapping) => mapping.name.trim())
          .map((mapping) => [mapping.name.trim(), valueFromMapping(mapping, ctx)]))
        ctx = { ...ctx, vars: { ...ctx.vars, ...extracted } }
        setVars(ctx.vars)
        const durationMs = performance.now() - start
        setNodeStatus(current.id, { status: 'success', durationMs, message: `${Object.keys(extracted).length} variables` })
        pushEntry({ ...entryBase, status: 'success', durationMs, extracted })
        current = graph.nodes.find((node) => node.id === nextEdge(current!.id, 'next')?.target)
        continue
      }

      const request = current.config.request ?? blankRequest()
      const execution = await executeRequest(request, ctx.vars)
      const response = execution.response
      const assertions = evaluateAssertions(request.assertions, response)
      const failedAssertions = assertions.filter((assertion) => !assertion.passed)
      const failedScripts = execution.scriptRuns.filter((run) => !run.passed)
      const expectedOk = expectedStatusMatches(current.config.expectedStatus ?? '2xx', response.status)
      const failed = Boolean(response.error)
        || (graph.settings.failOnHttpError && response.status >= 400)
        || !expectedOk
        || failedAssertions.length > 0
        || failedScripts.length > 0
      const extracted = Object.fromEntries((current.config.extractions ?? [])
        .filter((mapping) => mapping.name.trim())
        .map((mapping) => [mapping.name.trim(), valueFromMapping(mapping, { ...ctx, response })]))
      const nodeKey = normalizeName(current.label) || current.id
      const nextVars = { ...execution.vars, ...extracted, [`${nodeKey}.status`]: String(response.status) }
      ctx = { vars: nextVars, response, responses: { ...ctx.responses, [nodeKey]: response } }
      setVars(ctx.vars)

      const durationMs = performance.now() - start
      const error = response.error?.message
        || (!expectedOk ? `Expected ${current.config.expectedStatus || '2xx'}, got HTTP ${response.status}` : undefined)
        || (failedAssertions.length > 0 ? `${failedAssertions.length} assertion failed` : undefined)
        || failedScripts[0]?.error
      setNodeStatus(current.id, {
        status: failed ? 'failed' : 'success',
        durationMs,
        message: failed ? error : `${response.status} ${response.statusText}`,
      })
      pushEntry({
        ...entryBase,
        status: failed ? 'failed' : 'success',
        durationMs,
        httpStatus: response.status,
        request,
        response,
        assertions,
        extracted,
        error,
      })
      const branch: FlowEdgeBranch = failed ? 'error' : 'success'
      const edge = nextEdge(current.id, branch)
      if (failed && current.config.stopOnFailure !== false && !edge) break
      current = graph.nodes.find((node) => node.id === edge?.target)
    }

    if (steps >= graph.settings.maxSteps) {
      pushEntry({ id: uid(), nodeId: 'engine', nodeLabel: 'Execution limit', status: 'failed', durationMs: 0, error: `Stopped after ${graph.settings.maxSteps} steps.` })
    }
    graph.nodes.forEach((node) => {
      if (!nodeRuntime[node.id] || nodeRuntime[node.id].status === 'pending') nodeRuntime[node.id] = { status: 'skipped' }
    })
    setRuntime({ ...nodeRuntime })
    setVars(ctx.vars)
    setRunning(false)
  }

  const exportFlowJson = () => downloadBlob(
    JSON.stringify({ format: 'adomnia-flow', version: 3, definition: { name: flowName, graph }, lastRun: { vars, steps: lastRun } }, null, 2),
    `${flowName.replace(/[^\w.-]+/g, '-').toLowerCase() || 'flow'}.json`,
    'application/json',
  )
  const exportRun = () => downloadBlob(exportRunMarkdown(flowName, lastRun, vars), `${flowName.replace(/[^\w.-]+/g, '-').toLowerCase() || 'flow'}-run.md`, 'text/markdown')

  const importMermaid = () => {
    const next = graphFromMermaid(mermaidText)
    updateGraph(next)
    setActiveFlowId(null)
    setFlowName('Imported Mermaid flow')
    setSelectedNodeId(next.nodes.find((node) => node.type === 'request')?.id ?? next.nodes[0]?.id ?? null)
    setRuntime({})
    setVars({})
    setLastRun([])
    setConnectDraft(null)
    setCanvasMenu(null)
    setShowMermaidImport(false)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (event.key === 'Escape') {
        setConnectDraft(null)
        setCanvasMenu(null)
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNodeId) {
        const node = graph.nodes.find((item) => item.id === selectedNodeId)
        if (node && node.type !== 'start') {
          event.preventDefault()
          removeNode(selectedNodeId)
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [graph.nodes, selectedNodeId])

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[218px_1fr_372px] bg-surface-0">
      <aside className="flex min-h-0 flex-col border-r border-border-1 bg-surface-1">
        <div className="border-b border-border-1 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-text-2">
            <GitBranch size={13} className="text-accent" /> Visual Flows
          </div>
          <input value={flowName} onChange={(e) => setFlowName(e.target.value)} className="h-8 w-full rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1" />
          {saveError && <div className="mt-2 rounded border border-error/30 bg-error/10 px-2 py-1 text-[10px] text-error">{saveError}</div>}
        </div>
        <div className="flex gap-1 border-b border-border-1 p-2">
          <button onClick={saveFlow} title="Save flow" className="flex h-8 flex-1 items-center justify-center rounded border border-border-2 text-text-3 hover:text-text-1"><Save size={14} /></button>
          <button onClick={exportFlowJson} title="Export JSON" className="flex h-8 flex-1 items-center justify-center rounded border border-border-2 text-text-3 hover:text-text-1"><FileJson size={14} /></button>
          <button onClick={() => setShowMermaidImport(true)} title="Import Mermaid" className="flex h-8 flex-1 items-center justify-center rounded border border-border-2 text-text-3 hover:text-text-1"><FileText size={14} /></button>
          <button onClick={exportRun} disabled={lastRun.length === 0} title="Export run report" className="flex h-8 flex-1 items-center justify-center rounded border border-border-2 text-text-3 hover:text-text-1 disabled:opacity-40"><Download size={14} /></button>
        </div>
        <div className="border-b border-border-1 p-2">
          <button onClick={() => { const next = createDefaultFlowGraph(); updateGraph(next); setActiveFlowId(null); setFlowName('Untitled visual flow'); setSelectedNodeId(next.nodes[1]?.id ?? next.nodes[0]?.id) }} className="flex h-8 w-full items-center justify-center gap-1.5 rounded bg-accent px-3 text-xs font-medium text-white hover:opacity-90">
            <Plus size={13} /> New flow
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {sortedSavedFlows.map((flow) => (
            <div key={flow.id} className={`mb-1 flex items-center gap-1 rounded border px-2 py-1.5 ${flow.id === activeFlowId ? 'border-accent/60 bg-accent/10' : 'border-border-1 bg-surface-0'}`}>
              <button onClick={() => loadFlow(flow)} className="min-w-0 flex-1 text-left text-[11px] text-text-2">
                <div className="truncate font-medium text-text-1">{flow.name}</div>
                <div className="truncate text-[10px] text-text-4">{flow.graph.nodes.length} nodes</div>
              </button>
              <button onClick={() => deleteFlow(flow.id)} title="Delete flow" className="text-text-4 hover:text-error"><Trash2 size={12} /></button>
            </div>
          ))}
          {sortedSavedFlows.length === 0 && <div className="px-1 py-4 text-[11px] text-text-4">Save a graph to reuse it from this workspace.</div>}
        </div>
      </aside>

      <section className="flex min-h-0 flex-col">
        <div className="flex h-12 items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
          <NodeButton label="Start" icon={<Circle size={13} />} onClick={() => addNode('start')} />
          <NodeButton label="API" icon={<Square size={13} />} onClick={() => addNode('request')} />
          <NodeButton label="IF" icon={<Diamond size={13} />} onClick={() => addNode('condition')} />
          <NodeButton label="Extract" icon={<Braces size={13} />} onClick={() => addNode('extract')} />
          <NodeButton label="End" icon={<CheckCircle2 size={13} />} onClick={() => addNode('end')} />
          <button onClick={runFlow} disabled={running} className="ml-auto flex h-8 items-center gap-1.5 rounded bg-accent px-3 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
            <Play size={13} /> {running ? 'Running' : 'Run flow'}
          </button>
        </div>
        <div
          ref={canvasScrollRef}
          onMouseDown={startPan}
          onWheel={handleCanvasWheel}
          onContextMenu={(event) => { event.preventDefault(); setCanvasMenu(null) }}
          className="relative min-h-0 flex-1 cursor-grab overflow-auto bg-[radial-gradient(circle_at_1px_1px,var(--color-border-2)_1px,transparent_0)] [background-size:22px_22px] active:cursor-grabbing"
        >
          {validationErrors.length > 0 && (
            <div className="absolute left-3 top-3 z-20 max-w-md rounded border border-warning/30 bg-surface-1/95 px-3 py-2 shadow-lg">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-warning"><AlertTriangle size={13} /> Flow needs attention</div>
              <div className="space-y-0.5 text-[10px] text-text-3">{validationErrors.slice(0, 4).map((error) => <div key={error}>{error}</div>)}</div>
            </div>
          )}
          <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded border border-border-1 bg-surface-1/95 p-1 shadow-lg">
            <button onClick={() => setCanvasZoom(zoom - 0.1)} title="Zoom out" className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1"><ZoomOut size={13} /></button>
            <div className="min-w-[46px] text-center font-mono text-[11px] text-text-2">{Math.round(zoom * 100)}%</div>
            <button onClick={() => setCanvasZoom(zoom + 0.1)} title="Zoom in" className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1"><ZoomIn size={13} /></button>
            <button onClick={() => setCanvasZoom(1)} title="Reset zoom" className="h-7 rounded px-2 text-[10px] text-text-3 hover:bg-surface-2 hover:text-text-1">100</button>
          </div>
          {connectDraft && (
            <div className="absolute left-3 top-[84px] z-20 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-[11px] text-text-2 shadow-lg">
              Click another node or its left port to connect <span className="font-semibold text-accent">{connectDraft.branch}</span>. Press Esc to cancel.
            </div>
          )}
          <div data-flow-canvas-bg className="relative" style={{ width: CANVAS_W * zoom, height: CANVAS_H * zoom }}>
            <div
              ref={canvasContentRef}
              data-flow-canvas-bg
              className="relative origin-top-left"
              style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${zoom})` }}
            >
            <svg className="absolute inset-0 h-full w-full overflow-visible">
              <defs>
                <marker id="flow-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L9,3 z" fill="var(--color-text-3)" />
                </marker>
              </defs>
              {graph.edges.map((edge) => {
                const source = graph.nodes.find((node) => node.id === edge.source)
                const target = graph.nodes.find((node) => node.id === edge.target)
                if (!source || !target) return null
                const sx = cx(source)
                const sy = cy(source)
                const tx = cx(target)
                const ty = cy(target)
                const midX = (sx + tx) / 2
                const path = `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`
                return (
                  <g key={edge.id}>
                    <path d={path} fill="none" stroke="transparent" strokeWidth="14" className="cursor-pointer" onContextMenu={(event) => openEdgeMenu(event, edge.id)} />
                    <path d={path} fill="none" stroke="var(--color-text-3)" strokeWidth="1.8" markerEnd="url(#flow-arrow)" opacity="0.72" className="pointer-events-none" />
                    {(edge.label || edge.branch !== 'next') && (
                      <text x={midX} y={(sy + ty) / 2 - 8} fill="var(--color-text-2)" fontSize="10" textAnchor="middle">{edge.label || edge.branch}</text>
                    )}
                  </g>
                )
              })}
            </svg>
            {graph.nodes.map((node) => (
              <FlowNode
                key={node.id}
                node={node}
                runtime={runtime[node.id]?.status ?? 'pending'}
                message={runtime[node.id]?.message}
                selected={node.id === selectedNodeId}
                connectDraft={connectDraft}
                onMouseDown={(event) => { if (!connectDraft) startDrag(event, node) }}
                onSelect={() => handleNodeSelect(node.id)}
                onContextMenu={(event) => openNodeMenu(event, node.id)}
                onConnectStart={(branch) => { setCanvasMenu(null); setSelectedNodeId(node.id); setConnectDraft({ source: node.id, branch }) }}
                onConnectEnd={() => connectTo(node.id)}
              />
            ))}
            </div>
          </div>
          {showMermaidImport && (
            <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="flex max-h-[82vh] w-[680px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg border border-border-1 bg-surface-1 shadow-2xl">
                <div className="flex h-11 items-center gap-2 border-b border-border-1 px-3">
                  <FileText size={14} className="text-accent" />
                  <div className="flex-1 text-xs font-semibold text-text-1">Import Mermaid Flow</div>
                  <button onClick={() => setShowMermaidImport(false)} className="grid h-7 w-7 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1" title="Close">
                    <XCircle size={14} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 p-3">
                  <textarea
                    value={mermaidText}
                    onChange={(event) => setMermaidText(event.target.value)}
                    className="h-[360px] w-full resize-none rounded border border-border-2 bg-surface-0 p-3 font-mono text-xs leading-5 text-text-1 outline-none focus:border-accent"
                    spellCheck={false}
                  />
                  <div className="mt-2 text-[10px] text-text-4">Supported: flowchart/graph edges like A[API] --&gt;|success| B&#123;IF?&#125;. Request nodes are created with editable method, URL, headers and body in the right panel.</div>
                </div>
                <div className="flex justify-end gap-2 border-t border-border-1 p-3">
                  <button onClick={() => setShowMermaidImport(false)} className="h-8 rounded px-3 text-xs text-text-3 hover:bg-surface-2 hover:text-text-1">Cancel</button>
                  <button onClick={importMermaid} className="h-8 rounded bg-accent px-3 text-xs font-medium text-white hover:opacity-90">Import as Flow</button>
                </div>
              </div>
            </div>
          )}
          {canvasMenu && (
            <div
              className="fixed z-[220] w-48 overflow-hidden rounded-md border border-border-1 bg-surface-1 py-1 shadow-2xl"
              style={{ left: canvasMenu.x, top: canvasMenu.y }}
              onContextMenu={(event) => event.preventDefault()}
            >
              {canvasMenu.nodeId && (
                <>
                  <button
                    onClick={() => removeNodeConnections(canvasMenu.nodeId!)}
                    className="flex h-8 w-full items-center gap-2 px-3 text-left text-xs text-text-2 hover:bg-surface-2 hover:text-text-1"
                  >
                    <Unlink2 size={13} /> Delete connections
                  </button>
                  <button
                    onClick={() => removeNode(canvasMenu.nodeId!)}
                    disabled={graph.nodes.find((node) => node.id === canvasMenu.nodeId)?.type === 'start'}
                    className="flex h-8 w-full items-center gap-2 px-3 text-left text-xs text-error hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={13} /> Delete node
                  </button>
                </>
              )}
              {canvasMenu.edgeId && (
                <button
                  onClick={() => removeEdge(canvasMenu.edgeId!)}
                  className="flex h-8 w-full items-center gap-2 px-3 text-left text-xs text-error hover:bg-error/10"
                >
                  <Trash2 size={13} /> Delete connection
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <aside className="flex min-h-0 flex-col border-l border-border-1 bg-surface-1">
        <div className="grid grid-cols-2 border-b border-border-1 p-2">
          <button onClick={() => setTab('edit')} className={`h-8 rounded text-xs ${tab === 'edit' ? 'bg-surface-2 text-text-1' : 'text-text-3 hover:text-text-1'}`}>Edit</button>
          <button onClick={() => setTab('run')} className={`h-8 rounded text-xs ${tab === 'run' ? 'bg-surface-2 text-text-1' : 'text-text-3 hover:text-text-1'}`}>Run/debug</button>
        </div>
        {tab === 'edit'
          ? <NodeInspector node={selectedNode} graph={graph} patchNode={patchNode} patchRequest={patchRequest} removeNode={removeNode} />
          : <RunPanel lastRun={lastRun} vars={vars} runtime={runtime} validationErrors={validationErrors} />}
      </aside>
    </div>
  )
}

function expectedStatusMatches(expected: string, status: number): boolean {
  const trimmed = expected.trim()
  if (!trimmed || trimmed === 'any') return true
  if (/^\dxx$/.test(trimmed)) return Math.floor(status / 100) === Number(trimmed[0])
  if (trimmed.includes(',')) return trimmed.split(',').some((item: string) => expectedStatusMatches(item, status))
  return Number(trimmed) === status
}

function NodeButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-8 items-center gap-1.5 rounded border border-border-2 bg-surface-2 px-2.5 text-xs text-text-2 hover:border-accent/40 hover:text-text-1">
      {icon}{label}
    </button>
  )
}

function FlowNode({
  node,
  runtime,
  message,
  selected,
  connectDraft,
  onMouseDown,
  onSelect,
  onContextMenu,
  onConnectStart,
  onConnectEnd,
}: {
  node: FlowNodeDefinition
  runtime: FlowRunStatus
  message?: string
  selected: boolean
  connectDraft: ConnectDraft
  onMouseDown: (event: React.MouseEvent) => void
  onSelect: () => void
  onContextMenu: (event: React.MouseEvent) => void
  onConnectStart: (branch: FlowEdgeBranch) => void
  onConnectEnd: () => void
}) {
  const request = node.config.request
  const statusColor = runtime === 'success' ? 'bg-success' : runtime === 'failed' ? 'bg-error' : runtime === 'running' ? 'bg-accent' : runtime === 'skipped' ? 'bg-warning' : 'bg-text-4'
  const branches: FlowEdgeBranch[] = node.type === 'condition' ? ['true', 'false'] : node.type === 'request' ? ['success', 'error'] : ['next']
  const shape = node.type === 'condition'
    ? 'rotate-45 rounded-[18px]'
    : node.type === 'start' || node.type === 'end'
      ? 'rounded-full'
      : 'rounded-lg'
  return (
    <div
      onMouseDown={onMouseDown}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`absolute select-none border bg-surface-1 shadow-lg transition-colors ${connectDraft ? 'cursor-crosshair' : 'cursor-grab'} ${shape} ${selected ? 'border-accent shadow-glow' : 'border-border-2 hover:border-border-3'}`}
      style={{ left: node.x, top: node.y, width: node.width ?? NODE_W, height: node.height ?? NODE_H }}
    >
      <div className={node.type === 'condition' ? '-rotate-45 flex h-full flex-col items-center justify-center px-5 text-center' : 'flex h-full flex-col p-3'}>
        <div className="mb-2 flex w-full items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${statusColor}`} />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-1">{node.label}</span>
        </div>
        {node.type === 'request' && request && (
          <>
            <div className="mb-1 flex items-center gap-2 text-[11px]">
              <span className={`font-semibold ${methodColor(request.method)}`}>{request.method}</span>
              <span className="truncate font-mono text-text-3">{request.url || 'No URL configured'}</span>
            </div>
            <div className="truncate text-[10px] text-text-4">{(node.config.extractions ?? []).length} extractions · expected {node.config.expectedStatus || '2xx'}</div>
          </>
        )}
        {node.type === 'condition' && (
          <div className="max-w-[112px] text-[10px] leading-4 text-text-3">
            {node.config.condition?.path || 'response.status'} {node.config.condition?.operator || 'eq'} {node.config.condition?.value || '200'}
          </div>
        )}
        {node.type === 'extract' && <div className="text-[10px] text-text-3">{(node.config.extractions ?? []).length} variable mappings</div>}
        {(node.type === 'start' || node.type === 'end') && <div className="text-[10px] text-text-3">{node.type === 'start' ? 'Entry point' : node.config.endState}</div>}
        {message && <div className="mt-auto truncate text-[10px] text-text-4">{message}</div>}
      </div>
      {selected && (
        <div data-flow-control className="absolute left-1/2 top-[-38px] z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-accent/40 bg-surface-1/95 px-2 py-1 shadow-xl">
          <span className="px-1 text-[9px] font-semibold uppercase tracking-wide text-accent">Connect</span>
          {branches.map((branch) => (
            <button
              key={branch}
              onClick={(e) => { e.stopPropagation(); onConnectStart(branch) }}
              className="h-6 rounded-full border border-border-2 bg-surface-2 px-2 text-[9px] font-semibold uppercase text-text-2 hover:border-accent hover:text-accent"
              title={`Connect ${branch}`}
            >
              {branch === 'success' ? 'ok' : branch === 'error' ? 'err' : branch}
            </button>
          ))}
        </div>
      )}
      <button data-flow-control onClick={(e) => { e.stopPropagation(); onConnectEnd() }} className={`absolute -left-4 top-1/2 z-10 h-8 w-8 -translate-y-1/2 rounded-full border-2 shadow-lg transition-colors ${connectDraft ? 'border-accent bg-accent/25 hover:bg-accent/35' : 'border-border-3 bg-surface-2 hover:border-accent/60'}`} title="Connect here" />
      <div data-flow-control className="absolute -right-5 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1.5">
        {branches.map((branch) => (
          <button key={branch} onClick={(e) => { e.stopPropagation(); onConnectStart(branch) }} title={`Connect ${branch}`} className="flex h-8 min-w-8 items-center justify-center gap-1 rounded-full border border-border-3 bg-surface-2 px-2 text-[9px] font-semibold uppercase text-text-3 shadow-lg transition-colors hover:border-accent hover:text-accent">
            <Link2 size={11} />
            {branches.length > 1 && <span>{branch === 'success' ? 'ok' : branch === 'error' ? 'err' : branch}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-text-4">{label}{children}</label>
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`h-8 rounded border border-border-2 bg-surface-2 px-2 text-xs normal-case tracking-normal text-text-1 outline-none focus:border-accent ${props.className ?? ''}`} />
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`h-8 rounded border border-border-2 bg-surface-2 px-2 text-xs normal-case tracking-normal text-text-1 outline-none focus:border-accent ${props.className ?? ''}`} />
}

function NodeInspector({
  node,
  graph,
  patchNode,
  patchRequest,
  removeNode,
}: {
  node: FlowNodeDefinition | null
  graph: FlowGraphDefinition
  patchNode: (id: string, patch: Partial<FlowNodeDefinition>) => void
  patchRequest: (node: FlowNodeDefinition, patch: Partial<RequestItem>) => void
  removeNode: (id: string) => void
}) {
  if (!node) return <div className="p-4 text-xs text-text-4">Select a node on the canvas to edit it.</div>
  const request = node.config.request
  const updateMapping = (mappingId: string, patch: Partial<FlowVariableMapping>) => {
    patchNode(node.id, { config: { extractions: (node.config.extractions ?? []).map((mapping) => mapping.id === mappingId ? { ...mapping, ...patch } : mapping) } })
  }
  const addMapping = () => patchNode(node.id, { config: { extractions: [...(node.config.extractions ?? []), { id: uid(), name: 'value', source: 'body', path: '' }] } })
  const removeMapping = (id: string) => patchNode(node.id, { config: { extractions: (node.config.extractions ?? []).filter((mapping) => mapping.id !== id) } })
  const outgoing = graph.edges.filter((edge) => edge.source === node.id)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex-1">
          <div className="text-xs font-semibold text-text-1">{node.type.toUpperCase()}</div>
          <div className="text-[10px] text-text-4">{outgoing.length} outgoing connections</div>
        </div>
        <button onClick={() => removeNode(node.id)} disabled={node.type === 'start'} className="rounded p-1 text-text-4 hover:text-error disabled:opacity-30" title="Delete node"><Trash2 size={14} /></button>
      </div>
      <div className="space-y-3">
        <Field label="Label"><TextInput value={node.label} onChange={(e) => patchNode(node.id, { label: e.target.value })} /></Field>
        {node.type === 'end' && (
          <Field label="End state">
            <SelectInput value={node.config.endState ?? 'success'} onChange={(e) => patchNode(node.id, { config: { endState: e.target.value === 'failed' ? 'failed' : 'success' } })}>
              <option value="success">success</option>
              <option value="failed">failed</option>
            </SelectInput>
          </Field>
        )}
        {node.type === 'condition' && <ConditionEditor condition={node.config.condition} onChange={(condition) => patchNode(node.id, { config: { condition } })} />}
        {node.type === 'request' && request && (
          <>
            <div className="grid grid-cols-[96px_1fr] gap-2">
              <Field label="Method">
                <SelectInput value={request.method} onChange={(e) => patchRequest(node, { method: e.target.value as HttpMethod })}>
                  {METHODS.map((method) => <option key={method}>{method}</option>)}
                </SelectInput>
              </Field>
              <Field label="Expected"><TextInput value={node.config.expectedStatus ?? '2xx'} onChange={(e) => patchNode(node.id, { config: { expectedStatus: e.target.value } })} placeholder="2xx, 200, 200,201, any" /></Field>
            </div>
            <Field label="URL"><TextInput value={request.url} onChange={(e) => patchRequest(node, { url: e.target.value })} placeholder="https://api.local/users/{{userId}}" /></Field>
            <KvEditor label="Headers" rows={request.headers} onChange={(headers) => patchRequest(node, { headers })} />
            {!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && (
              <Field label="Body">
                <textarea
                  value={request.bodies[request.activeBodyIdx]?.raw ?? ''}
                  onChange={(e) => {
                    const bodies = [...request.bodies]
                    const index = request.activeBodyIdx
                    bodies[index] = { ...bodies[index], type: 'raw', raw: e.target.value, lang: 'json' }
                    patchRequest(node, { bodies })
                  }}
                  rows={7}
                  className="rounded border border-border-2 bg-surface-2 p-2 font-mono text-xs normal-case leading-5 tracking-normal text-text-1 outline-none focus:border-accent"
                  placeholder={'{ "token": "{{token}}" }'}
                />
              </Field>
            )}
            <label className="flex items-center gap-2 text-xs text-text-3">
              <input type="checkbox" checked={node.config.stopOnFailure !== false} onChange={(e) => patchNode(node.id, { config: { stopOnFailure: e.target.checked } })} />
              Stop if this request fails and no error branch exists
            </label>
          </>
        )}
        {(node.type === 'request' || node.type === 'extract') && (
          <section className="rounded border border-border-1 bg-surface-0 p-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold text-text-2">Extract Variables</div>
              <button onClick={addMapping} className="rounded p-1 text-text-4 hover:text-accent" title="Add extraction"><Plus size={13} /></button>
            </div>
            <div className="space-y-2">
              {(node.config.extractions ?? []).map((mapping) => (
                <div key={mapping.id} className="grid grid-cols-[1fr_82px_1fr_22px] gap-1">
                  <TextInput value={mapping.name} onChange={(e) => updateMapping(mapping.id, { name: e.target.value })} placeholder="token" />
                  <SelectInput value={mapping.source} onChange={(e) => updateMapping(mapping.id, { source: e.target.value as FlowVariableMapping['source'] })}>
                    <option value="body">body</option>
                    <option value="header">header</option>
                    <option value="status">status</option>
                    <option value="expression">expr</option>
                  </SelectInput>
                  <TextInput value={mapping.path} onChange={(e) => updateMapping(mapping.id, { path: e.target.value })} placeholder="access_token" />
                  <button onClick={() => removeMapping(mapping.id)} className="text-text-4 hover:text-error"><Trash2 size={12} /></button>
                </div>
              ))}
              {(node.config.extractions ?? []).length === 0 && <div className="text-[10px] text-text-4">Extract `token = response.body.access_token`, headers, status, or expression paths.</div>}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function ConditionEditor({ condition, onChange }: { condition: FlowCondition | undefined; onChange: (condition: FlowCondition) => void }) {
  const value = condition ?? { source: 'expression', path: 'response.status', operator: 'eq', value: '200' }
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-[108px_1fr] gap-2">
        <Field label="Source">
          <SelectInput value={value.source} onChange={(e) => onChange({ ...value, source: e.target.value as FlowCondition['source'] })}>
            <option value="status">status</option>
            <option value="header">header</option>
            <option value="body">body</option>
            <option value="variable">variable</option>
            <option value="expression">expression</option>
          </SelectInput>
        </Field>
        <Field label="Path"><TextInput value={value.path} onChange={(e) => onChange({ ...value, path: e.target.value })} placeholder="response.body.user.active" /></Field>
      </div>
      <div className="grid grid-cols-[116px_1fr] gap-2">
        <Field label="Operator">
          <SelectInput value={value.operator} onChange={(e) => onChange({ ...value, operator: e.target.value as ConditionOperator })}>
            {OPERATORS.map((operator) => <option key={operator}>{operator}</option>)}
          </SelectInput>
        </Field>
        <Field label="Value"><TextInput value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })} placeholder="true" /></Field>
      </div>
    </section>
  )
}

function KvEditor({ label, rows, onChange }: { label: string; rows: RequestItem['headers']; onChange: (rows: RequestItem['headers']) => void }) {
  return (
    <section className="rounded border border-border-1 bg-surface-0 p-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-text-2">{label}</div>
        <button onClick={() => onChange([...rows, blankKVRow()])} className="rounded p-1 text-text-4 hover:text-accent" title="Add header"><Plus size={13} /></button>
      </div>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[18px_1fr_1fr_22px] gap-1">
            <input type="checkbox" checked={row.enabled} onChange={(e) => onChange(rows.map((item) => item.id === row.id ? { ...item, enabled: e.target.checked } : item))} />
            <TextInput value={row.key} onChange={(e) => onChange(rows.map((item) => item.id === row.id ? { ...item, key: e.target.value } : item))} placeholder="Authorization" />
            <TextInput value={row.value} onChange={(e) => onChange(rows.map((item) => item.id === row.id ? { ...item, value: e.target.value } : item))} placeholder="Bearer {{token}}" />
            <button onClick={() => onChange(rows.filter((item) => item.id !== row.id))} className="text-text-4 hover:text-error"><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
    </section>
  )
}

function RunPanel({ lastRun, vars, runtime, validationErrors }: { lastRun: RunEntry[]; vars: Record<string, string>; runtime: RuntimeByNode; validationErrors: string[] }) {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const entry = lastRun.find((item) => item.id === selectedEntryId) ?? lastRun[lastRun.length - 1] ?? null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {validationErrors.length > 0 && (
        <div className="border-b border-border-1 p-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-warning"><AlertTriangle size={13} /> Validation</div>
          <div className="space-y-1 text-[10px] text-text-3">{validationErrors.map((error) => <div key={error}>{error}</div>)}</div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-2 text-xs font-semibold text-text-2">Execution Order</div>
        <div className="space-y-1">
          {lastRun.map((item, index) => (
            <button key={item.id} onClick={() => setSelectedEntryId(item.id)} className={`w-full rounded border px-2 py-1.5 text-left text-[11px] ${entry?.id === item.id ? 'border-accent/60 bg-accent/10' : 'border-border-1 bg-surface-0'}`}>
              <div className="flex items-center gap-2">
                <span className="text-text-4">{index + 1}</span>
                <StatusIcon status={item.status} />
                <span className="min-w-0 flex-1 truncate text-text-2">{item.nodeLabel}</span>
                <span className="text-text-4">{item.durationMs.toFixed(0)}ms</span>
              </div>
              {item.error && <div className="mt-1 truncate text-error">{item.error}</div>}
            </button>
          ))}
          {lastRun.length === 0 && <div className="rounded border border-border-1 bg-surface-0 p-3 text-[11px] text-text-4">Run the flow to inspect requests, responses, variables, and errors.</div>}
        </div>
        <div className="mt-4 text-xs font-semibold text-text-2">Variables</div>
        <div className="mt-2 max-h-40 overflow-y-auto rounded border border-border-1 bg-surface-0 p-2 font-mono text-[10px]">
          {Object.entries(vars).map(([key, value]) => <div key={key} className="grid grid-cols-[112px_1fr] gap-2 border-b border-border-1/30 py-0.5"><span className="truncate text-accent">{key}</span><span className="truncate text-text-3">{value}</span></div>)}
          {Object.keys(vars).length === 0 && <div className="text-text-4">No extracted variables yet.</div>}
        </div>
        <div className="mt-4 text-xs font-semibold text-text-2">Node States</div>
        <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-text-3">
          {Object.entries(runtime).map(([id, item]) => <div key={id} className="flex items-center gap-1 rounded border border-border-1 bg-surface-0 px-2 py-1"><StatusIcon status={item.status} />{item.status}</div>)}
        </div>
      </div>
      {entry && (
        <div className="max-h-[44%] min-h-[180px] border-t border-border-1 bg-surface-0 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-text-2">
            <StatusIcon status={entry.status} /> {entry.nodeLabel}
          </div>
          <pre className="h-[calc(100%-28px)] overflow-auto whitespace-pre-wrap rounded border border-border-1 bg-surface-1 p-2 font-mono text-[10px] leading-4 text-text-3">
            {JSON.stringify({
              request: entry.request ? { method: entry.request.method, url: entry.request.url, headers: entry.request.headers } : undefined,
              response: entry.response ? { status: entry.response.status, headers: entry.response.headers, body: tryFormatBody(entry.response.body) } : undefined,
              assertions: entry.assertions,
              extracted: entry.extracted,
              error: entry.error,
            }, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: FlowRunStatus }) {
  if (status === 'success') return <CheckCircle2 size={12} className="text-success" />
  if (status === 'failed') return <XCircle size={12} className="text-error" />
  if (status === 'running') return <Circle size={12} className="text-accent" />
  if (status === 'skipped') return <Circle size={12} className="text-warning" />
  return <Circle size={12} className="text-text-4" />
}

function tryFormatBody(body: string) {
  try { return JSON.parse(body) } catch { return body }
}

import { blankRequest, type RequestItem, uid } from '@/lib/types'
import {
  DEFAULT_FLOW_SETTINGS,
  type ConditionOperator,
  type FlowCondition,
  type FlowEdgeBranch,
  type FlowGraphDefinition,
  type FlowNodeDefinition,
  type FlowNodeType,
} from '@/lib/flowStorage'

type MermaidShape = 'plain' | 'round' | 'diamond'

export interface ApiCatalogRequest {
  id: string
  label: string
  source: string
  request: RequestItem
}

const NODE_WIDTH = 232
const NODE_HEIGHT = 104

export const DEFAULT_MERMAID_FLOW = `flowchart TD
    A[Login API] --> B[Get User Profile]
    B --> C{User is active?}
    C -->|Yes| D[Get Dashboard Data]
    C -->|No| E[Show Error / Stop Flow]`

function normalizeName(text: string) {
  return text.trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '').toLowerCase()
}

function stripQuotes(text: string) {
  return text.trim().replace(/^["']|["']$/g, '')
}

function parseEndpoint(raw: string): { key: string; label: string; shape: MermaidShape } {
  const text = raw.trim().replace(/;$/, '')
  const keyMatch = text.match(/^([A-Za-z0-9_.:-]+)/)
  if (!keyMatch) return { key: normalizeName(text) || uid(), label: stripQuotes(text) || 'API step', shape: 'plain' }
  const key = keyMatch[1]
  const rest = text.slice(key.length).trim()
  if (rest.startsWith('((') && rest.includes('))')) {
    const label = rest.slice(2, rest.indexOf('))')).trim()
    return { key, label: stripQuotes(label || key), shape: 'round' }
  }
  if (rest.startsWith('{') && rest.includes('}')) {
    const label = rest.slice(1, rest.indexOf('}')).trim()
    return { key, label: stripQuotes(label || key), shape: 'diamond' }
  }
  if (rest.startsWith('[') && rest.includes(']')) {
    const label = rest.slice(1, rest.indexOf(']')).trim()
    return { key, label: stripQuotes(label || key), shape: 'plain' }
  }
  if (rest.startsWith('(') && rest.includes(')')) {
    const label = rest.slice(1, rest.indexOf(')')).trim()
    return { key, label: stripQuotes(label || key), shape: 'round' }
  }
  return { key, label: stripQuotes(key), shape: 'plain' }
}

function parseEdgeLine(line: string): { from: string; to: string; label: string } | null {
  const arrow = line.match(/\s*(?:-->|---?>|==>|-.->|->|--)\s*/)
  if (!arrow || arrow.index === undefined) return null
  const from = line.slice(0, arrow.index).trim()
  let to = line.slice(arrow.index + arrow[0].length).trim().replace(/;$/, '')
  let label = ''
  const labelMatch = to.match(/^\|([^|]*)\|\s*(.+)$/)
  if (labelMatch) {
    label = stripQuotes(labelMatch[1])
    to = labelMatch[2].trim()
  }
  if (!from || !to) return null
  return { from, to, label }
}

function rememberNode(nodesByKey: Map<string, { label: string; shape: MermaidShape }>, endpoint: { key: string; label: string; shape: MermaidShape }) {
  const existing = nodesByKey.get(endpoint.key)
  if (!existing) {
    nodesByKey.set(endpoint.key, { label: endpoint.label, shape: endpoint.shape })
    return
  }
  const hasBetterLabel = endpoint.label !== endpoint.key && existing.label === endpoint.key
  const hasBetterShape = endpoint.shape !== 'plain' && existing.shape === 'plain'
  nodesByKey.set(endpoint.key, {
    label: hasBetterLabel ? endpoint.label : existing.label,
    shape: hasBetterShape ? endpoint.shape : existing.shape,
  })
}

function nodeType(label: string, shape: MermaidShape): FlowNodeType {
  const lower = label.toLowerCase()
  if (shape === 'diamond' || lower.startsWith('if ') || lower.includes('?')) return 'condition'
  if (lower === 'start' || lower.startsWith('start ')) return 'start'
  if (lower.startsWith('end') || lower.includes('stop') || lower.includes('success') || lower.includes('failed') || lower.includes('error')) return 'end'
  return 'request'
}

function branch(label: string, sourceType: FlowNodeType): FlowEdgeBranch {
  const lower = label.trim().toLowerCase()
  if (sourceType === 'condition') {
    if (['false', 'no', 'else', 'error', 'fail', 'failed', 'stop'].includes(lower)) return 'false'
    return 'true'
  }
  if (['error', 'fail', 'failed'].includes(lower)) return 'error'
  if (['success', 'ok', 'yes'].includes(lower)) return 'success'
  return 'next'
}

function inferCondition(label: string): FlowCondition {
  const lower = label.toLowerCase()
  const wordMatch = lower.match(/\b(active|enabled|valid|success|ok|verified|authenticated|approved|paid|ready)\b/)
  if (wordMatch) {
    return { source: 'body', path: wordMatch[1], operator: 'eq', value: 'true' }
  }
  const statusMatch = lower.match(/\b(status|http)\s*(?:is|=|==)?\s*(\d{3})\b/)
  if (statusMatch) {
    return { source: 'status', path: 'response.status', operator: 'eq', value: statusMatch[2] }
  }
  return { source: 'expression', path: 'response.status', operator: 'gte', value: '200' }
}

function requestLabelScore(label: string, candidate: ApiCatalogRequest): number {
  const needle = normalizeName(label)
  const name = normalizeName(candidate.request.name)
  const display = normalizeName(candidate.label)
  const url = normalizeName(candidate.request.url)
  if (!needle) return 0
  if (needle === name || needle === display) return 100
  if (name.includes(needle) || display.includes(needle)) return 80 - Math.abs(name.length - needle.length)
  if (needle.includes(name) && name.length > 3) return 70 - Math.abs(name.length - needle.length)
  if (url.includes(needle)) return 45
  const words = needle.split('_').filter((part) => part.length > 2)
  return words.reduce((score, word) => score + (name.includes(word) || display.includes(word) || url.includes(word) ? 8 : 0), 0)
}

export function matchCatalogRequest(label: string, catalog: ApiCatalogRequest[]): ApiCatalogRequest | null {
  const best = catalog
    .map((candidate) => ({ candidate, score: requestLabelScore(label, candidate) }))
    .sort((a, b) => b.score - a.score)[0]
  return best && best.score >= 16 ? best.candidate : null
}

export function graphFromMermaid(source: string, catalog: ApiCatalogRequest[] = []): FlowGraphDefinition {
  const nodesByKey = new Map<string, { label: string; shape: MermaidShape }>()
  const edgeSeeds: { source: string; target: string; label: string }[] = []

  source.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('%%') || /^(graph|flowchart)\s+/i.test(trimmed)) return
    const edge = parseEdgeLine(trimmed)
    if (!edge) {
      rememberNode(nodesByKey, parseEndpoint(trimmed))
      return
    }
    const from = parseEndpoint(edge.from)
    const to = parseEndpoint(edge.to)
    rememberNode(nodesByKey, from)
    rememberNode(nodesByKey, to)
    edgeSeeds.push({ source: from.key, target: to.key, label: edge.label })
  })

  const keys = [...nodesByKey.keys()]
  if (keys.length === 0) return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, settings: DEFAULT_FLOW_SETTINGS }

  const incoming = new Map(keys.map((key) => [key, 0]))
  edgeSeeds.forEach((edge) => incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1))
  const startKey = keys.find((key) => {
    const seed = nodesByKey.get(key)
    return seed && nodeType(seed.label, seed.shape) === 'start'
  }) ?? keys.find((key) => (incoming.get(key) ?? 0) === 0) ?? keys[0]

  const ordered: string[] = []
  const queue = [startKey]
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
  const nodes = ordered.map((key, index): FlowNodeDefinition => {
    const seed = nodesByKey.get(key) ?? { label: key, shape: 'plain' as MermaidShape }
    const type = nodeType(seed.label, seed.shape)
    const matched = type === 'request' ? matchCatalogRequest(seed.label, catalog) : null
    const id = uid()
    keyToId.set(key, id)
    const x = 72 + index * 290
    const y = type === 'condition' ? 126 : type === 'end' ? 170 : 150
    const request = matched
      ? { ...matched.request, id: uid(), name: seed.label }
      : { ...blankRequest('GET', seed.label), name: seed.label }
    return {
      id,
      mermaidKey: key,
      type,
      label: seed.label,
      x,
      y,
      width: type === 'condition' ? 172 : type === 'start' || type === 'end' ? 150 : NODE_WIDTH,
      height: type === 'condition' ? 148 : type === 'start' || type === 'end' ? 70 : NODE_HEIGHT,
      config: type === 'request'
        ? { request, expectedStatus: '2xx', stopOnFailure: true, extractions: [] }
        : type === 'condition'
          ? { condition: inferCondition(seed.label) }
          : type === 'end' && seed.label.toLowerCase().includes('error')
            ? { endState: 'failed' }
            : {},
    }
  })

  const edges = edgeSeeds.flatMap((edge) => {
    const sourceId = keyToId.get(edge.source)
    const targetId = keyToId.get(edge.target)
    const sourceNode = nodes.find((node) => node.id === sourceId)
    if (!sourceId || !targetId || !sourceNode) return []
    const edgeBranch = branch(edge.label, sourceNode.type)
    return [{ id: uid(), source: sourceId, target: targetId, branch: edgeBranch, label: edge.label || (edgeBranch === 'next' ? '' : edgeBranch) }]
  })

  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, settings: DEFAULT_FLOW_SETTINGS }
}

export function expectedStatusMatches(pattern: string, status: number): boolean {
  const value = pattern.trim().toLowerCase()
  if (!value || value === 'any') return true
  if (/^\dxx$/.test(value)) return Math.floor(status / 100) === Number(value[0])
  if (/^\d{3}$/.test(value)) return status === Number(value)
  if (/^\d{3}-\d{3}$/.test(value)) {
    const [min, max] = value.split('-').map(Number)
    return status >= min && status <= max
  }
  return value.split(',').map((item) => item.trim()).some((item) => expectedStatusMatches(item, status))
}

export function conditionOperators(): ConditionOperator[] {
  return ['exists', 'not_exists', 'eq', 'neq', 'contains', 'gt', 'lt', 'gte', 'lte']
}

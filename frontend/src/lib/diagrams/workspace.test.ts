import { describe, expect, it } from 'vitest'
import { blueprintNodeOf, entityAt, generateWorkspaceDiagram, relatedEntities, resolveEntity } from './workspace'
import { newElementId, DEFAULT_EDGE_DATA } from './model'
import { mergeGeneratedGraph } from './workspaceMerge'

type Analysis = Parameters<typeof generateWorkspaceDiagram>[0]
type Entity = Analysis['entities'][number]
type Link = Analysis['links'][number]

function entity(partial: Partial<Entity> & Pick<Entity, 'id' | 'kind' | 'label'>): Entity {
  return { confidence: 'derived', ...partial }
}

function analysis(entities: Entity[], links: Link[] = []): Analysis {
  return {
    root: '/repo', fingerprint: 'fp1', languages: ['go'], entities, links,
    sources: [{ language: 'go', nodes: entities.length, edges: links.length }],
    stats: {},
  } as unknown as Analysis
}

const payment = entity({ id: 'mod:payments', kind: 'service', label: 'payments', language: 'go' })
const handler = entity({ id: 'fn:payments.CreatePayment', kind: 'function', label: 'payments.CreatePayment', file: 'service/payment.go', line: 42, service: 'mod:payments', language: 'go' })
const reserve = entity({ id: 'fn:payments.ReserveFunds', kind: 'function', label: 'payments.ReserveFunds', file: 'service/wallet.go', line: 12, service: 'mod:payments', language: 'go' })
const endpoint = entity({ id: 'http:POST /payments', kind: 'endpoint', label: 'POST /payments', file: 'service/http.go', line: 9, service: 'mod:payments' })
const topic = entity({ id: 'topic:payments.created', kind: 'topic', label: 'payments.created', service: 'mod:payments' })
const links: Link[] = [
  { from: 'fn:payments.CreatePayment', to: 'http:POST /payments', kind: 'handles', confidence: 'derived' },
  { from: 'fn:payments.CreatePayment', to: 'fn:payments.ReserveFunds', kind: 'calls', confidence: 'derived' },
  { from: 'fn:payments.CreatePayment', to: 'topic:payments.created', kind: 'produces', confidence: 'inferred' },
]

describe('workspace → diagram', () => {
  it('shows services and infrastructure in the architectural view, not every function', () => {
    const generated = generateWorkspaceDiagram(analysis([payment, handler, reserve, endpoint, topic], links), { sessionId: 's1', view: 'architecture' })
    const keys = generated.blueprint.nodes.map((node) => node.key)
    expect(keys).toContain('mod:payments')
    expect(keys).toContain('http:POST /payments')
    expect(keys).toContain('topic:payments.created')
    expect(keys).not.toContain('fn:payments.CreatePayment')
    expect(generated.origin.sessionId).toBe('s1')
    expect(generated.origin.fingerprint).toBe('fp1')
  })

  it('follows the endpoint to its handler and the handler to its callees', () => {
    const generated = generateWorkspaceDiagram(analysis([payment, handler, reserve, endpoint, topic], links), { sessionId: 's1', view: 'endpoints', depth: 3 })
    const keys = generated.blueprint.nodes.map((node) => node.key)
    expect(keys).toContain('http:POST /payments')
    expect(keys).toContain('fn:payments.CreatePayment')
    expect(keys).toContain('fn:payments.ReserveFunds')
    expect(keys).toContain('topic:payments.created')
  })

  it('aggregates cross-service calls into architecture arrows, with the weakest confidence', () => {
    const wallet = entity({ id: 'mod:wallet', kind: 'service', label: 'wallet', language: 'go' })
    const reserveWallet = entity({ id: 'fn:wallet.Reserve', kind: 'function', label: 'wallet.Reserve', service: 'mod:wallet', language: 'go' })
    const cross: Link = { from: 'fn:payments.ReserveFunds', to: 'fn:wallet.Reserve', kind: 'calls', confidence: 'inferred' }
    const generated = generateWorkspaceDiagram(analysis([payment, wallet, handler, reserve, reserveWallet, endpoint], [...links, cross]), { sessionId: 's1', view: 'architecture' })
    const arrow = generated.blueprint.links.find((link) => link.from === 'mod:payments' && link.to === 'mod:wallet')
    expect(arrow).toBeDefined()
    expect(arrow?.confidence).toBe('inferred')
    expect(arrow?.dashed).toBe(true)
    expect(arrow?.label).toContain('depends')
  })

  it('distinguishes inferred relations visually and keeps the evidence', () => {    const generated = generateWorkspaceDiagram(analysis([payment, handler, reserve, endpoint, topic], links), { sessionId: 's1', view: 'functions', focusId: 'fn:payments.CreatePayment' })
    const inferred = generated.blueprint.links.find((link) => link.to === 'topic:payments.created')
    expect(inferred?.dashed).toBe(true)
    expect(inferred?.confidence).toBe('inferred')
    expect(inferred?.evidence).toContain('inferred')
    const call = generated.blueprint.links.find((link) => link.to === 'fn:payments.ReserveFunds')
    expect(call?.dashed).toBeFalsy()
  })

  it('carries source refs on generated nodes', () => {
    const node = blueprintNodeOf(handler, { sessionId: 's1', workspaceId: 'w1' }, 'fp1')
    expect(node.source).toMatchObject({ sessionId: 's1', entityId: 'fn:payments.CreatePayment', file: 'service/payment.go', line: 42 })
    expect(node.generated).toBe(true)
  })

  it('finds the handler at a caret and its callers', () => {
    const fixture = analysis([payment, handler, reserve, endpoint, topic], links)
    expect(entityAt(fixture, 'service/payment.go', 50)?.id).toBe('fn:payments.CreatePayment')
    expect(entityAt(fixture, 'nope.go', 1)).toBeUndefined()
    const { entities } = relatedEntities(fixture, 'fn:payments.ReserveFunds', 'callers')
    expect(entities.map((item) => item.id)).toContain('fn:payments.CreatePayment')
  })

  it('treats the handler as what an endpoint calls', () => {
    const fixture = analysis([payment, handler, reserve, endpoint, topic], links)
    expect(relatedEntities(fixture, 'http:POST /payments', 'callees').entities.map((item) => item.id)).toContain('fn:payments.CreatePayment')
    expect(relatedEntities(fixture, 'fn:payments.CreatePayment', 'callers').entities.map((item) => item.id)).toContain('http:POST /payments')
  })

  it('resolves a renamed entity by file when the id is gone', () => {
    const renamed = { ...handler, id: 'fn:payments.CreatePayment.v2', label: 'payments.CreatePaymentV2' }
    const found = resolveEntity(analysis([renamed]), { entityId: handler.id, kind: 'function', file: 'service/payment.go', line: 42 })
    expect(found?.id).toBe('fn:payments.CreatePayment.v2')
  })

  it('explains an empty view instead of inventing a diagram', () => {
    const generated = generateWorkspaceDiagram(analysis([]), { sessionId: 's1', view: 'osgi' })
    expect(generated.blueprint.nodes).toHaveLength(0)
    expect(generated.notes.join(' ')).toMatch(/No OSGi/)
  })
})

describe('merging a refresh', () => {
  const node = (entityId: string, x: number, label: string, generated = true) => ({
    id: newElementId('n'), type: 'shape' as const, position: { x, y: 0 },
    data: {
      shape: 'process', label, style: { fill: '', stroke: '', strokeWidth: 1, radius: 0, textColor: '', fontSize: 12, dashed: false },
      rotation: 0, locked: false, generated,
      ...(generated ? { source: { sessionId: 's1', entityId, kind: 'function' } } : {}),
    },
  })

  it('keeps the user position and label, updates refs and marks disappeared nodes stale', () => {
    const manual = node('manual', 10, 'Note', false)
    const moved = node('fn:a', 300, 'My label')
    const gone = node('fn:gone', 0, 'Old')
    const current = { nodes: [manual, moved, gone], edges: [] }
    const freshNode = (entityId: string, label: string) => node(entityId, 0, label)
    const freshNodes = [freshNode('fn:a', 'a()'), freshNode('fn:b', 'b()')]
    const fresh = {
      nodes: freshNodes,
      edges: [{ id: 'e1', type: 'smart' as const, source: freshNodes[1].id, target: freshNodes[0].id, sourceHandle: null, targetHandle: null, data: { ...DEFAULT_EDGE_DATA, generated: true } }],
    }
    const merged = mergeGeneratedGraph(current, fresh)
    const kept = merged.graph.nodes.find((item) => item.data.source?.entityId === 'fn:a')
    expect(kept?.position.x).toBe(300)
    expect(kept?.data.label).toBe('My label')
    expect(merged.graph.nodes.find((item) => item.data.source?.entityId === 'fn:gone')?.data.stale).toBe(true)
    expect(merged.graph.nodes.some((item) => item.id === manual.id)).toBe(true)
    expect(merged.added).toBe(1)
    expect(merged.stale).toBe(1)
    expect(merged.graph.edges).toHaveLength(1)
  })

  it('drops the old generated connectors but keeps the manual ones', () => {
    const a = node('fn:a', 0, 'a()')
    const b = node('fn:b', 100, 'b()')
    const manualEdge = { id: 'manual-edge', type: 'smart' as const, source: a.id, target: b.id, sourceHandle: null, targetHandle: null, data: { ...DEFAULT_EDGE_DATA } }
    const generatedEdge = { ...manualEdge, id: 'gen-old', data: { ...DEFAULT_EDGE_DATA, generated: true } }
    const current = { nodes: [a, b], edges: [manualEdge, generatedEdge] }
    const fresh = { nodes: [node('fn:a', 0, 'a()'), node('fn:b', 100, 'b()')], edges: [] }
    const merged = mergeGeneratedGraph(current, fresh)
    expect(merged.graph.edges.map((edge) => edge.id)).toEqual(['manual-edge'])
  })
})

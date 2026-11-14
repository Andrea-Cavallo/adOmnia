/**
 * Workspace → Diagram. The analysis comes from the Go normalizer (one entity per adapter node, each
 * with a stable id and a source reference); this module decides what the selected view shows and
 * how it looks. It never scans sources and never invents a relation: every generated link carries
 * the confidence and evidence the adapter reported.
 */
import type { WorkspaceAnalysis, WorkspaceEntity, WorkspaceLink } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/diagrams/models'
import type { BlueprintLink, BlueprintNode, DiagramBlueprint } from './blueprint'
import type { DiagramCodeRef, DiagramOrigin, DiagramViewKind, LinkConfidence } from './model'

export interface GenerateOptions {
  sessionId: string
  workspaceId?: string
  projectName?: string
  view: DiagramViewKind
  /** Service or entity the view starts from (service, functions, endpoints). */
  focusId?: string
  /** How many call hops the function/endpoint views follow. */
  depth?: number
  /** Safety stop for very large workspaces. */
  maxNodes?: number
}

export interface GeneratedDiagram {
  blueprint: DiagramBlueprint
  origin: DiagramOrigin
  /** Things the user should know: truncation, missing focus. */
  notes: string[]
  entityCount: number
  truncated: boolean
}

const LIMITS: Record<DiagramViewKind, number> = { architecture: 140, service: 90, functions: 60, endpoints: 90, osgi: 140 }
const DEFAULT_DEPTH: Record<DiagramViewKind, number> = { architecture: 0, service: 0, functions: 2, endpoints: 3, osgi: 0 }

const FLOW_LINK_KINDS = new Set(['calls', 'invokes', 'flows-to', 'dispatches', 'calls-ext', 'starts', 'handles'])
/** Relations an endpoint/function view follows: execution plus what the handler exposes and touches. */
const TRAVERSAL_LINK_KINDS = new Set([...FLOW_LINK_KINDS, 'handles', 'produces', 'consumes', 'queries', 'uses'])

const SHAPES: Record<string, string> = {
  service: 'service', module: 'service', bundle: 'osgi-bundle', package: 'uml-package',
  function: 'process', method: 'process', type: 'uml-class', interface: 'uml-interface',
  endpoint: 'rest-endpoint', topic: 'kafka-topic', table: 'database', external: 'external',
  entry: 'terminator', flow: 'camel-route', subflow: 'subprocess', activator: 'process', config: 'process', other: 'process',
}

const SERVICE_LANGUAGE_SHAPE: Record<string, string> = { go: 'go-service', java: 'java-service', xml: 'java-service', declared: 'java-service', flow: 'osgi-bundle' }

const CONFIDENCE_LABEL: Record<string, string> = { declared: 'declared', derived: 'derived', inferred: 'inferred', observed: 'observed' }

const LINK_TINT: Record<string, string | undefined> = { declared: 'green', derived: 'blue', inferred: 'amber', observed: 'violet' }

export function confidenceOf(value: string | undefined): LinkConfidence {
  return value === 'declared' || value === 'inferred' || value === 'observed' ? value : 'derived'
}

/** "pkg/path" → "path"; Go labels repeat the package on every function. */
function shortLabel(entity: WorkspaceEntity): string {
  const label = entity.label || entity.id
  if (entity.kind === 'function' || entity.kind === 'method') {
    const tail = label.includes('.') ? label.slice(label.lastIndexOf('.') + 1) : label
    return tail.endsWith('()') ? tail : `${tail}()`
  }
  // A Go module is named by its import path: the last segment is the name people use.
  if ((entity.kind === 'package' || entity.kind === 'service') && label.includes('/')) return label.slice(label.lastIndexOf('/') + 1)
  return label
}

function subtitleOf(entity: WorkspaceEntity): string | undefined {
  if (entity.file) return `${entity.file}${entity.line ? `:${entity.line}` : ''}`
  return entity.detail || undefined
}

export function codeRefOf(entity: WorkspaceEntity, options: Pick<GenerateOptions, 'sessionId' | 'workspaceId'>, fingerprint?: string): DiagramCodeRef {
  return {
    sessionId: options.sessionId,
    workspaceId: options.workspaceId,
    entityId: entity.id,
    kind: entity.kind,
    file: entity.file,
    line: entity.line,
    column: entity.line ? 1 : undefined,
    symbol: entity.label,
    confidence: confidenceOf(entity.confidence),
    fingerprint,
  }
}

export function blueprintNodeOf(entity: WorkspaceEntity, options: Pick<GenerateOptions, 'sessionId' | 'workspaceId'>, fingerprint?: string): BlueprintNode {
  const shape = entity.kind === 'service'
    ? SERVICE_LANGUAGE_SHAPE[entity.language ?? ''] ?? SHAPES.service
    : SHAPES[entity.kind] ?? SHAPES.other
  const color = entity.kind === 'service' ? (entity.language === 'go' ? 'blue' : 'amber') : undefined
  return {
    key: entity.id,
    shape,
    label: shortLabel(entity),
    subtitle: subtitleOf(entity),
    ...(color ? { color } : {}),
    source: codeRefOf(entity, options, fingerprint),
    service: entity.service,
    generated: true,
  }
}

export function blueprintLinkOf(link: WorkspaceLink): BlueprintLink {
  const confidence = confidenceOf(link.confidence)
  const observed = confidence === 'observed'
  const inferred = confidence === 'inferred'
  return {
    from: link.from,
    to: link.to,
    label: link.detail || link.kind,
    confidence,
    evidence: `${link.kind}${link.detail ? ` · ${link.detail}` : ''} · ${CONFIDENCE_LABEL[confidence]}`,
    generated: true,
    ...(inferred ? { dashed: true } : {}),
    ...(observed ? { flow: true } : {}),
    ...(LINK_TINT[confidence] ? { color: LINK_TINT[confidence] } : {}),
  }
}

/** Builds the diagram for one view, starting from the workspace analysis. */
export function generateWorkspaceDiagram(analysis: WorkspaceAnalysis, options: GenerateOptions): GeneratedDiagram {
  const { entities, links } = selectView(analysis, options)
  const byId = new Map(entities.map((entity) => [entity.id, entity]))
  const visibleIds = new Set(byId.keys())
  const direct = dedupeLinks(links.filter((link) => visibleIds.has(link.from) && visibleIds.has(link.to) && link.from !== link.to))
  const structural = options.view === 'architecture' || options.view === 'osgi'
    ? [...ownershipLinks(analysis, visibleIds), ...aggregateServiceLinks(analysis, visibleIds, direct)]
    : []
  const blueprint: DiagramBlueprint = {
    nodes: entities.map((entity) => blueprintNodeOf(entity, options, analysis.fingerprint)),
    links: dedupeLinks([...direct, ...structural]).map((link) => blueprintLinkOf(link)),
  }
  const origin: DiagramOrigin = {
    sessionId: options.sessionId,
    workspaceId: options.workspaceId,
    root: analysis.root,
    projectName: options.projectName,
    fingerprint: analysis.fingerprint,
    generatedAt: Date.now(),
    view: options.view,
    focusId: options.focusId,
    sources: analysis.sources.map((source) => source.language),
  }
  const notes: string[] = []
  if (analysis.truncated) notes.push('The analysis was truncated: some files were not read.')
  if (analysis.problems?.length) notes.push(...analysis.problems.slice(0, 4))
  if (entities.length === 0) notes.push(emptyViewNote(options.view))
  return { blueprint, origin, notes, entityCount: entities.length, truncated: !!analysis.truncated }
}

function emptyViewNote(view: DiagramViewKind): string {
  if (view === 'osgi') return 'No OSGi bundle, flow or activator was found in this workspace.'
  if (view === 'functions') return 'No function or method was found for this focus.'
  return 'No entity was found in this view. Try another view or refresh the analysis.'
}

function selectView(analysis: WorkspaceAnalysis, options: GenerateOptions): { entities: WorkspaceEntity[]; links: WorkspaceLink[] } {
  const limit = options.maxNodes ?? LIMITS[options.view]
  let selected: WorkspaceEntity[] = []
  switch (options.view) {
    case 'architecture':
      selected = analysis.entities.filter((entity) => entity.kind === 'service'
        || ['endpoint', 'topic', 'table'].includes(entity.kind)
        || (entity.kind === 'external' && !entity.id.startsWith('dep:') && !entity.id.startsWith('std:')))
      break
    case 'service':
      selected = serviceView(analysis, options.focusId)
      break
    case 'functions':
      selected = neighborhood(analysis, options.focusId, options.depth ?? DEFAULT_DEPTH.functions, new Set(['function', 'method', 'endpoint', 'flow', 'subflow', 'external', 'topic', 'table']))
      break
    case 'endpoints':
      selected = endpointView(analysis, options.depth ?? DEFAULT_DEPTH.endpoints)
      break
    case 'osgi':
      selected = analysis.entities.filter((entity) => (entity.kind === 'service' && entity.language !== 'go') || ['flow', 'subflow', 'activator', 'external'].includes(entity.kind))
      break
  }
  const truncated = selected.length > limit
  if (truncated) selected = selected.slice(0, limit)
  const ids = new Set(selected.map((entity) => entity.id))
  return { entities: selected, links: analysis.links.filter((link) => ids.has(link.from) && ids.has(link.to)) }
}

function serviceView(analysis: WorkspaceAnalysis, focusId?: string): WorkspaceEntity[] {
  const services = analysis.entities.filter((entity) => entity.kind === 'service')
  const focus = focusId ?? services[0]?.id
  if (!focus) return []
  const target = analysis.entities.find((entity) => entity.id === focus)
  const children = analysis.entities.filter((entity) => entity.service === focus && entity.id !== focus && entity.kind !== 'package' && entity.kind !== 'type' && entity.kind !== 'function' && entity.kind !== 'method')
  const handlers = analysis.entities.filter((entity) => entity.service === focus && (entity.kind === 'function' || entity.kind === 'method')).slice(0, 12)
  return target ? [target, ...children, ...handlers] : []
}

function endpointView(analysis: WorkspaceAnalysis, depth: number): WorkspaceEntity[] {
  const endpoints = analysis.entities.filter((entity) => entity.kind === 'endpoint').slice(0, 24)
  const seen = new Map<string, WorkspaceEntity>()
  for (const endpoint of endpoints) {
    for (const entity of neighborhood(analysis, endpoint.id, depth, null)) seen.set(entity.id, entity)
  }
  return [...seen.values()]
}

/** Breadth-first walk over call/flow links, from one entity. */
function neighborhood(analysis: WorkspaceAnalysis, focusId: string | undefined, depth: number, kinds: Set<string> | null): WorkspaceEntity[] {
  const byId = new Map(analysis.entities.map((entity) => [entity.id, entity]))
  if (!focusId || !byId.has(focusId)) return []
  const outgoing = new Map<string, WorkspaceLink[]>()
  const incoming = new Map<string, WorkspaceLink[]>()
  for (const link of analysis.links) {
    if (!TRAVERSAL_LINK_KINDS.has(link.kind)) continue
    outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), link])
    incoming.set(link.to, [...(incoming.get(link.to) ?? []), link])
  }
  const selected = new Map<string, WorkspaceEntity>()
  const seen = new Set([focusId])
  let frontier = [focusId]
  for (let hop = 0; hop <= depth; hop++) {
    const next: string[] = []
    for (const id of frontier) {
      const entity = byId.get(id)
      if (entity && (!kinds || kinds.has(entity.kind))) selected.set(id, entity)
      for (const link of [...(outgoing.get(id) ?? []), ...(incoming.get(id) ?? [])]) {
        const other = link.from === id ? link.to : link.from
        if (seen.has(other)) continue
        seen.add(other)
        next.push(other)
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }
  return [...selected.values()]
}

/**
 * Architecture view: an endpoint, topic, table or external system belongs to the service the
 * adapter attributed it to. The link is structural (derived from ownership), not a runtime call.
 */
function ownershipLinks(analysis: WorkspaceAnalysis, visible: ReadonlySet<string>): WorkspaceLink[] {
  const links: WorkspaceLink[] = []
  for (const entity of analysis.entities) {
    if (!entity.service || entity.service === entity.id || !visible.has(entity.id) || !visible.has(entity.service)) continue
    const role = entity.kind === 'endpoint' ? 'exposes' : entity.kind === 'table' ? 'uses' : entity.kind === 'topic' ? 'uses' : 'depends'
    links.push({ from: entity.service, to: entity.id, kind: role, confidence: 'derived' })
  }
  return links
}

/**
 * Architecture view: relations between entities that are not shown become one relation between
 * their services. The confidence is the weakest of the underlying relations, so an aggregated
 * arrow is never stronger than what proved it.
 */
function aggregateServiceLinks(analysis: WorkspaceAnalysis, visible: ReadonlySet<string>, direct: WorkspaceLink[]): WorkspaceLink[] {
  const byId = new Map(analysis.entities.map((entity) => [entity.id, entity]))
  const directPairs = new Set(direct.map((link) => `${link.from}\u0000${link.to}`))
  const rank: Record<string, number> = { inferred: 1, derived: 2, declared: 3, observed: 4 }
  const weakest: Record<number, string> = { 1: 'inferred', 2: 'derived', 3: 'declared', 4: 'observed' }
  const groups = new Map<string, { from: string; to: string; count: number; kinds: Set<string>; confidence: number }>()
  for (const link of analysis.links) {
    const from = byId.get(link.from)
    const to = byId.get(link.to)
    // A service's own handler/table relations describe the service, not a link to itself.
    const source = from?.kind === 'service' ? from.id : from?.service
    const target = to?.kind === 'service' ? to.id : to?.service
    if (!source || !target || source === target) continue
    if (!visible.has(source) || !visible.has(target)) continue
    if (directPairs.has(`${source}\u0000${target}`)) continue
    const key = `${source}\u0000${target}`
    const confidence = rank[confidenceOf(link.confidence)] ?? 2
    const group = groups.get(key)
    if (group) {
      group.count++
      group.kinds.add(link.kind)
      group.confidence = Math.min(group.confidence, confidence)
    } else {
      groups.set(key, { from: source, to: target, count: 1, kinds: new Set([link.kind]), confidence })
    }
  }
  return [...groups.values()].map((group) => ({
    from: group.from,
    to: group.to,
    kind: 'depends',
    detail: `depends · ${[...group.kinds].sort().join(', ')}`,
    confidence: weakest[group.confidence] ?? 'derived',
  }))
}

/** One relation per pair and kind: adapters can report the same call from several evidence points. */export function dedupeLinks(links: WorkspaceLink[], entityIds?: ReadonlySet<string>): WorkspaceLink[] {
  const seen = new Map<string, WorkspaceLink>()
  const rank: Record<string, number> = { observed: 4, declared: 3, derived: 2, inferred: 1 }
  for (const link of links) {
    if (entityIds && (!entityIds.has(link.from) || !entityIds.has(link.to))) continue
    const key = `${link.from}\u0000${link.to}\u0000${link.kind}`
    const current = seen.get(key)
    if (!current || (rank[confidenceOf(link.confidence)] ?? 0) > (rank[confidenceOf(current.confidence)] ?? 0)) seen.set(key, link)
  }
  return [...seen.values()]
}

/**
 * Finds the entity a diagram node refers to after a refresh. The id is authoritative; when a symbol
 * was renamed the file (and then the symbol name) is the fallback. Only entities of the same kind are
 * candidates, so a function is never replaced by a package.
 */
export function resolveEntity(analysis: WorkspaceAnalysis, ref: Pick<DiagramCodeRef, 'entityId' | 'kind' | 'file' | 'line' | 'symbol'>): WorkspaceEntity | undefined {
  const direct = analysis.entities.find((entity) => entity.id === ref.entityId)
  if (direct) return direct
  const sameKind = analysis.entities.filter((entity) => entity.kind === ref.kind)
  if (ref.file) {
    const inFile = sameKind.filter((entity) => entity.file === ref.file)
    if (inFile.length === 1) return inFile[0]
    if (ref.line) {
      const nearest = inFile.reduce<WorkspaceEntity | undefined>((best, entity) =>
        !best || Math.abs((entity.line ?? 0) - ref.line!) < Math.abs((best.line ?? 0) - ref.line!) ? entity : best, undefined)
      if (nearest && Math.abs((nearest.line ?? 0) - ref.line) <= 20) return nearest
    }
    if (ref.symbol) {
      const named = inFile.find((entity) => entity.label === ref.symbol || entity.label.endsWith(`.${ref.symbol}`))
      if (named) return named
    }
  }
  return ref.symbol ? sameKind.find((entity) => entity.label === ref.symbol || entity.label.endsWith(`.${ref.symbol}`)) : undefined
}

/** The entity declared at a source location: used by Show in Diagram Studio from the editor. */
export function entityAt(analysis: WorkspaceAnalysis, file: string, line: number): WorkspaceEntity | undefined {
  const inFile = analysis.entities.filter((entity) => entity.file === file)
  if (inFile.length === 0) return undefined
  const rank = (entity: WorkspaceEntity) => ['function', 'method', 'endpoint', 'flow', 'subflow', 'type', 'service'].indexOf(entity.kind)
  const exact = inFile.filter((entity) => entity.line === line)
  if (exact.length) return exact.sort((a, b) => rank(a) - rank(b))[0]
  const containing = inFile
    .filter((entity) => entity.line && entity.line <= line)
    .sort((a, b) => (b.line ?? 0) - (a.line ?? 0))[0]
  if (containing && line - (containing.line ?? 0) <= 200) return containing
  return inFile.sort((a, b) => Math.abs((a.line ?? 0) - line) - Math.abs((b.line ?? 0) - line))[0]
}

/** The direct callers and callees of an entity, for Show Callers / Show Callees. */
export function relatedEntities(analysis: WorkspaceAnalysis, id: string, direction: 'callers' | 'callees' | 'both'): { entities: WorkspaceEntity[]; links: WorkspaceLink[] } {
  const byId = new Map(analysis.entities.map((entity) => [entity.id, entity]))
  const links = analysis.links.filter((link) => {
    if (!FLOW_LINK_KINDS.has(link.kind)) return false
    // `handles` is stored handler → endpoint, but a request runs endpoint → handler.
    const [upstream, downstream] = link.kind === 'handles' ? [link.to, link.from] : [link.from, link.to]
    if (direction === 'callers') return downstream === id
    if (direction === 'callees') return upstream === id
    return link.from === id || link.to === id
  })
  const ids = new Set<string>([id])
  for (const link of links) { ids.add(link.from); ids.add(link.to) }
  return { links, entities: [...ids].flatMap((entityId) => { const entity = byId.get(entityId); return entity ? [entity] : [] }) }
}

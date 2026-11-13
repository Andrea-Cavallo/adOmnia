/**
 * The shape library: what each shape is called, where it is listed, how big it starts and how it
 * looks by default. Pure data: drawing lives in components/diagrams/shapeSvg.tsx, so a new shape is
 * one entry here (plus a geometry there only when no existing outline fits).
 */
import type { NodeStyle, ShapeCategory, ShapeGeometry } from './model'

export interface ShapeDefinition {
  id: string
  label: string
  category: ShapeCategory
  /** Extra words the library search matches. */
  keywords: string
  geometry: ShapeGeometry
  width: number
  height: number
  /** Overrides of the theme defaults; empty colors follow the active theme. */
  style?: Partial<NodeStyle>
  subtitle?: string
  /** Lucide icon drawn next to the label (see components/diagrams/shapeIcons.ts). */
  icon?: string
  /** Rotation makes sense for outlines, not for boxes of text or containers. */
  rotatable: boolean
  /** Containers sit behind the nodes they enclose. */
  container?: boolean
  /** UML classifiers show attribute and operation compartments. */
  compartments?: { attributes: string; operations: string }
}

export const SHAPE_CATEGORIES: ReadonlyArray<{ id: ShapeCategory; label: string }> = [
  { id: 'flowchart', label: 'Flowchart' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'integration', label: 'Integration & services' },
  { id: 'uml', label: 'UML' },
  { id: 'containers', label: 'Containers' },
  { id: 'annotations', label: 'Text & notes' },
]

/** Restrained tints for the inspector: a hue for meaning, never neon. Empty = theme default. */
export const STYLE_PALETTE: ReadonlyArray<{ id: string; label: string; fill: string; stroke: string }> = [
  { id: 'theme', label: 'Theme', fill: '', stroke: '' },
  { id: 'graphite', label: 'Graphite', fill: '#1f2125', stroke: '#4a4f57' },
  { id: 'green', label: 'Green', fill: '#14241b', stroke: '#3fb96b' },
  { id: 'blue', label: 'Blue', fill: '#141e2b', stroke: '#4c8fd6' },
  { id: 'amber', label: 'Amber', fill: '#2a2213', stroke: '#d4a03a' },
  { id: 'red', label: 'Red', fill: '#2a1617', stroke: '#d65a5a' },
  { id: 'violet', label: 'Violet', fill: '#1f1830', stroke: '#9b7ad8' },
  { id: 'paper', label: 'Paper', fill: '#f4f1ea', stroke: '#8a8478' },
]

export const DEFAULT_NODE_STYLE: NodeStyle = { fill: '', stroke: '', strokeWidth: 1.5, textColor: '', fontSize: 13, dashed: false }

const shape = (definition: ShapeDefinition): ShapeDefinition => definition

export const SHAPES: readonly ShapeDefinition[] = [
  // Flowchart
  shape({ id: 'process', label: 'Process', category: 'flowchart', keywords: 'step action task box', geometry: 'rectangle', width: 160, height: 72, rotatable: true }),
  shape({ id: 'decision', label: 'Decision', category: 'flowchart', keywords: 'if branch condition choice', geometry: 'diamond', width: 140, height: 100, rotatable: true }),
  shape({ id: 'io', label: 'Input / Output', category: 'flowchart', keywords: 'data read write parallelogram', geometry: 'parallelogram', width: 170, height: 72, rotatable: true }),
  shape({ id: 'terminator', label: 'Start / End', category: 'flowchart', keywords: 'terminator begin finish stop pill', geometry: 'pill', width: 150, height: 56, rotatable: true }),
  shape({ id: 'connector', label: 'Connector', category: 'flowchart', keywords: 'junction circle on-page reference', geometry: 'circle', width: 48, height: 48, rotatable: false }),
  shape({ id: 'document', label: 'Document', category: 'flowchart', keywords: 'file report page', geometry: 'document', width: 150, height: 84, rotatable: true }),
  shape({ id: 'stored-data', label: 'Stored data', category: 'flowchart', keywords: 'storage disk cylinder', geometry: 'cylinder', width: 120, height: 90, rotatable: false }),

  // Architecture
  shape({ id: 'service', label: 'Service', category: 'architecture', keywords: 'microservice backend app server', geometry: 'rounded', width: 170, height: 76, icon: 'server', rotatable: false }),
  shape({ id: 'api', label: 'API', category: 'architecture', keywords: 'endpoint http rest interface', geometry: 'rounded', width: 150, height: 64, icon: 'globe', subtitle: 'HTTP', rotatable: false }),
  shape({ id: 'database', label: 'Database', category: 'architecture', keywords: 'sql postgres oracle mysql db store', geometry: 'cylinder', width: 120, height: 100, icon: 'database', rotatable: false }),
  shape({ id: 'cache', label: 'Cache', category: 'architecture', keywords: 'redis memcached in-memory', geometry: 'cylinder', width: 120, height: 90, icon: 'zap', subtitle: 'Redis', rotatable: false }),
  shape({ id: 'queue', label: 'Message queue', category: 'architecture', keywords: 'mq broker rabbitmq jms amqp', geometry: 'queue', width: 180, height: 64, icon: 'layers', rotatable: false }),
  shape({ id: 'gateway', label: 'API Gateway', category: 'architecture', keywords: 'gateway ingress proxy edge', geometry: 'hexagon', width: 170, height: 80, icon: 'shield', rotatable: false }),
  shape({ id: 'load-balancer', label: 'Load balancer', category: 'architecture', keywords: 'lb balancer nginx haproxy', geometry: 'hexagon', width: 160, height: 72, icon: 'network', rotatable: false }),
  shape({ id: 'client', label: 'Client', category: 'architecture', keywords: 'browser web mobile frontend user', geometry: 'rounded', width: 150, height: 68, icon: 'monitor', rotatable: false }),
  shape({ id: 'external', label: 'External system', category: 'architecture', keywords: 'third party cloud saas partner', geometry: 'cloud', width: 180, height: 100, icon: 'cloud', rotatable: false }),

  // Integration & services (Go/Java, events, Camel, SOAP, OSGi)
  shape({ id: 'go-service', label: 'Go service', category: 'integration', keywords: 'golang microservice grpc', geometry: 'rounded', width: 170, height: 76, icon: 'server', subtitle: 'Go', style: { stroke: '#4c8fd6' }, rotatable: false }),
  shape({ id: 'java-service', label: 'Java service', category: 'integration', keywords: 'spring boot jakarta quarkus microservice', geometry: 'rounded', width: 170, height: 76, icon: 'server', subtitle: 'Java · Spring', style: { stroke: '#d4a03a' }, rotatable: false }),
  shape({ id: 'rest-endpoint', label: 'REST endpoint', category: 'integration', keywords: 'http get post route controller', geometry: 'pill', width: 170, height: 52, icon: 'globe', subtitle: 'GET /resource', rotatable: false }),
  shape({ id: 'soap-endpoint', label: 'SOAP endpoint', category: 'integration', keywords: 'wsdl xml jax-ws ws-security', geometry: 'rounded', width: 170, height: 64, icon: 'file', subtitle: 'WSDL', rotatable: false }),
  shape({ id: 'kafka-topic', label: 'Kafka topic', category: 'integration', keywords: 'kafka topic stream partition event log', geometry: 'queue', width: 180, height: 60, icon: 'layers', subtitle: 'topic', style: { stroke: '#3fb96b' }, rotatable: false }),
  shape({ id: 'event', label: 'Domain event', category: 'integration', keywords: 'event message published fact', geometry: 'parallelogram', width: 170, height: 60, icon: 'radio', rotatable: false }),
  shape({ id: 'camel-route', label: 'Camel route', category: 'integration', keywords: 'apache camel route eip from to processor', geometry: 'rounded', width: 180, height: 68, icon: 'route', subtitle: 'from → to', rotatable: false }),
  shape({ id: 'saga-orchestrator', label: 'Saga orchestrator', category: 'integration', keywords: 'saga orchestration transaction compensation', geometry: 'hexagon', width: 180, height: 80, icon: 'workflow', rotatable: false }),
  shape({ id: 'saga-step', label: 'Saga step', category: 'integration', keywords: 'saga local transaction compensate', geometry: 'rounded', width: 160, height: 64, icon: 'repeat', subtitle: 'compensate: undo', rotatable: false }),
  shape({ id: 'osgi-bundle', label: 'OSGi bundle', category: 'integration', keywords: 'osgi bundle plugin eclipse equinox manifest', geometry: 'component', width: 170, height: 72, icon: 'puzzle', subtitle: 'Bundle-SymbolicName', rotatable: false }),

  // UML
  shape({ id: 'uml-class', label: 'Class', category: 'uml', keywords: 'uml class attributes methods', geometry: 'uml-class', width: 200, height: 140, rotatable: false, compartments: { attributes: '- id: String\n- name: String', operations: '+ save(): void' } }),
  shape({ id: 'uml-interface', label: 'Interface', category: 'uml', keywords: 'uml interface contract', geometry: 'uml-class', width: 200, height: 110, subtitle: '«interface»', rotatable: false, compartments: { attributes: '', operations: '+ handle(event): void' } }),
  shape({ id: 'uml-package', label: 'Package', category: 'uml', keywords: 'uml package namespace module', geometry: 'package', width: 200, height: 130, rotatable: false }),
  shape({ id: 'uml-component', label: 'Component', category: 'uml', keywords: 'uml component module', geometry: 'component', width: 180, height: 80, rotatable: false }),

  // Containers
  shape({ id: 'container', label: 'Container', category: 'containers', keywords: 'group frame area region', geometry: 'container', width: 360, height: 240, rotatable: false, container: true }),
  shape({ id: 'boundary', label: 'System boundary', category: 'containers', keywords: 'boundary bounded context namespace cluster', geometry: 'container', width: 420, height: 280, style: { dashed: true }, rotatable: false, container: true }),

  // Text & notes
  shape({ id: 'text', label: 'Text', category: 'annotations', keywords: 'label caption title free text', geometry: 'text', width: 160, height: 40, rotatable: true }),
  shape({ id: 'note', label: 'Note', category: 'annotations', keywords: 'annotation comment sticky', geometry: 'note', width: 180, height: 110, style: { fill: '#2a2213', stroke: '#d4a03a' }, rotatable: false }),
]

const SHAPE_BY_ID = new Map(SHAPES.map((definition) => [definition.id, definition]))

/** The shape of an id; an unknown id (a newer file) falls back to a process box rather than failing. */
export function shapeOf(id: string): ShapeDefinition {
  return SHAPE_BY_ID.get(id) ?? SHAPES[0]
}

export const isKnownShape = (id: string) => SHAPE_BY_ID.has(id)

/** Shapes matching a free-text query in their label, category or keywords; all of them for an empty one. */
export function searchShapes(query: string, shapes: readonly ShapeDefinition[] = SHAPES): ShapeDefinition[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...shapes]
  return shapes.filter((definition) => {
    const haystack = `${definition.label} ${definition.category} ${definition.keywords} ${definition.subtitle ?? ''}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

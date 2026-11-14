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
  /** Text a new shape starts with, when the library label would not fit in it. */
  text?: string
  /** Lucide icon drawn next to the label (see components/diagrams/shapeIcons.ts). */
  icon?: string
  /** Rotation makes sense for outlines, not for boxes of text or containers. */
  rotatable: boolean
  /** Containers sit behind the nodes they enclose. */
  container?: boolean
  /** UML classifiers show attribute and operation compartments. */
  compartments?: { attributes: string; operations: string }
  /** Made by the editor (dropped images), not offered in the library. */
  hidden?: boolean
  /** A legend starts with these rows. */
  legend?: Array<{ color: string; label: string; dashed?: boolean }>
  /** Operand separators a new fragment starts with (alt/else). */
  dividers?: Array<{ y: number; label: string }>
  /** Clicks pass through the inside to what is behind; only the border and title tab catch them. */
  passThrough?: boolean
}

export const SHAPE_CATEGORIES: ReadonlyArray<{ id: ShapeCategory; label: string }> = [
  { id: 'basic', label: 'Basic shapes' },
  { id: 'flowchart', label: 'Flowchart' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'integration', label: 'Integration & services' },
  { id: 'uml', label: 'UML' },
  { id: 'sequence', label: 'Sequence (UML)' },
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

export const DEFAULT_NODE_STYLE: NodeStyle = { fill: '', stroke: '', strokeWidth: 1.5, radius: 0, textColor: '', fontSize: 13, dashed: false }

const shape = (definition: ShapeDefinition): ShapeDefinition => definition

export const SHAPES: readonly ShapeDefinition[] = [
  // Basic shapes
  shape({ id: 'rectangle', label: 'Rectangle', category: 'basic', keywords: 'box square', geometry: 'rectangle', width: 140, height: 80, text: '', rotatable: true }),
  shape({ id: 'rounded-rectangle', label: 'Rounded', category: 'basic', keywords: 'rounded rectangle box', geometry: 'rounded', width: 140, height: 80, text: '', rotatable: true }),
  shape({ id: 'ellipse', label: 'Ellipse', category: 'basic', keywords: 'oval use case', geometry: 'ellipse', width: 140, height: 80, text: '', rotatable: true }),
  shape({ id: 'circle', label: 'Circle', category: 'basic', keywords: 'round dot', geometry: 'circle', width: 88, height: 88, text: '', rotatable: false }),
  shape({ id: 'triangle', label: 'Triangle', category: 'basic', keywords: 'warning delta', geometry: 'triangle', width: 110, height: 96, text: '', rotatable: true }),
  shape({ id: 'diamond', label: 'Diamond', category: 'basic', keywords: 'rhombus', geometry: 'diamond', width: 110, height: 110, text: '', rotatable: true }),
  shape({ id: 'hexagon', label: 'Hexagon', category: 'basic', keywords: 'hex', geometry: 'hexagon', width: 130, height: 96, text: '', rotatable: true }),
  shape({ id: 'star', label: 'Star', category: 'basic', keywords: 'favorite highlight', geometry: 'star', width: 96, height: 96, text: '', rotatable: true }),
  shape({ id: 'block-arrow', label: 'Arrow', category: 'basic', keywords: 'block arrow direction right', geometry: 'arrow', width: 140, height: 64, text: '', rotatable: true }),
  shape({ id: 'cloud', label: 'Cloud', category: 'basic', keywords: 'internet network', geometry: 'cloud', width: 160, height: 96, text: '', rotatable: false }),

  // Flowchart
  shape({ id: 'process', label: 'Process', category: 'flowchart', keywords: 'step action task box', geometry: 'rectangle', width: 160, height: 72, rotatable: true }),
  shape({ id: 'decision', label: 'Decision', category: 'flowchart', keywords: 'if branch condition choice', geometry: 'diamond', width: 140, height: 100, rotatable: true }),
  shape({ id: 'io', label: 'Input / Output', category: 'flowchart', keywords: 'data read write parallelogram', geometry: 'parallelogram', width: 170, height: 72, rotatable: true }),
  shape({ id: 'terminator', label: 'Start / End', category: 'flowchart', keywords: 'terminator begin finish stop pill', geometry: 'pill', width: 150, height: 56, rotatable: true }),
  shape({ id: 'connector', label: 'Connector', category: 'flowchart', keywords: 'junction circle on-page reference', geometry: 'circle', width: 48, height: 48, text: '', rotatable: false }),
  shape({ id: 'document', label: 'Document', category: 'flowchart', keywords: 'file report page', geometry: 'document', width: 150, height: 84, rotatable: true }),
  shape({ id: 'stored-data', label: 'Stored data', category: 'flowchart', keywords: 'storage disk cylinder', geometry: 'cylinder', width: 120, height: 90, rotatable: false }),
  shape({ id: 'subprocess', label: 'Subprocess', category: 'flowchart', keywords: 'predefined process subroutine function call', geometry: 'subprocess', width: 160, height: 72, rotatable: true }),
  shape({ id: 'manual-input', label: 'Manual input', category: 'flowchart', keywords: 'keyboard user entry', geometry: 'manual-input', width: 160, height: 72, rotatable: true }),
  shape({ id: 'preparation', label: 'Preparation', category: 'flowchart', keywords: 'setup initialize loop', geometry: 'hexagon', width: 170, height: 72, rotatable: true }),
  shape({ id: 'delay', label: 'Delay', category: 'flowchart', keywords: 'wait pause timer', geometry: 'delay', width: 130, height: 72, rotatable: true }),
  shape({ id: 'off-page', label: 'Off-page link', category: 'flowchart', keywords: 'off-page connector reference continue', geometry: 'off-page', width: 80, height: 80, text: '', rotatable: false }),

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
  shape({ id: 'uml-actor', label: 'Actor', category: 'uml', keywords: 'uml actor user person role stick figure', geometry: 'actor', width: 80, height: 120, rotatable: false }),
  shape({ id: 'uml-use-case', label: 'Use case', category: 'uml', keywords: 'uml use case scenario ellipse', geometry: 'ellipse', width: 170, height: 80, rotatable: false }),
  shape({ id: 'uml-package', label: 'Package', category: 'uml', keywords: 'uml package namespace module', geometry: 'package', width: 200, height: 130, rotatable: false }),
  shape({ id: 'uml-component', label: 'Component', category: 'uml', keywords: 'uml component module', geometry: 'component', width: 180, height: 80, rotatable: false }),

  // Sequence diagrams: lifelines carry a connection point every row, so messages stay horizontal.
  shape({ id: 'seq-lifeline', label: 'Lifeline', category: 'sequence', keywords: 'sequence lifeline participant object timeline', geometry: 'lifeline', width: 120, height: 420, text: 'Participant', passThrough: true, style: { fill: '#1d3557', stroke: '#4c8fd6', textColor: '#ffffff' }, rotatable: false }),
  shape({ id: 'seq-actor', label: 'Actor lifeline', category: 'sequence', keywords: 'sequence actor user lifeline', geometry: 'lifeline', width: 120, height: 420, text: 'User', passThrough: true, icon: 'user', style: { fill: '#1d3557', stroke: '#4c8fd6', textColor: '#ffffff' }, rotatable: false }),
  shape({ id: 'seq-activation', label: 'Activation', category: 'sequence', keywords: 'sequence activation execution bar focus', geometry: 'activation', width: 14, height: 60, text: '', style: { fill: '#5fb3b3', stroke: '#3d8c8c' }, rotatable: false }),
  shape({ id: 'seq-band', label: 'Highlight band', category: 'sequence', keywords: 'sequence rect highlight band background color', geometry: 'rounded', width: 360, height: 120, text: '', style: { fill: 'rgba(63, 185, 107, 0.1)', stroke: 'rgba(63, 185, 107, 0.45)', strokeWidth: 1 }, rotatable: false, passThrough: true }),
  shape({ id: 'seq-loop', label: 'Loop', category: 'sequence', keywords: 'sequence fragment loop repeat combined', geometry: 'fragment', width: 360, height: 160, text: 'loop', subtitle: '[for each item]', style: { fill: 'transparent' }, rotatable: false, passThrough: true }),
  shape({ id: 'seq-alt', label: 'Alt / else', category: 'sequence', keywords: 'sequence fragment alt else alternative if combined', geometry: 'fragment', width: 360, height: 200, text: 'alt', subtitle: '[valid]', style: { fill: 'transparent' }, dividers: [{ y: 100, label: '[else]' }], rotatable: false, passThrough: true }),
  shape({ id: 'seq-opt', label: 'Opt', category: 'sequence', keywords: 'sequence fragment opt optional combined', geometry: 'fragment', width: 360, height: 140, text: 'opt', subtitle: '[condition]', style: { fill: 'transparent' }, rotatable: false, passThrough: true }),

  // Containers
  shape({ id: 'container', label: 'Container', category: 'containers', keywords: 'group frame area region', geometry: 'container', width: 360, height: 240, rotatable: false, container: true }),
  shape({ id: 'swimlane', label: 'Swimlane', category: 'containers', keywords: 'swimlane lane pool role department', geometry: 'container', width: 260, height: 480, rotatable: false, container: true }),
  shape({ id: 'boundary', label: 'System boundary', category: 'containers', keywords: 'boundary bounded context namespace cluster', geometry: 'container', width: 420, height: 280, style: { dashed: true }, rotatable: false, container: true }),

  // Text & notes
  shape({ id: 'text', label: 'Text', category: 'annotations', keywords: 'label caption title free text', geometry: 'text', width: 160, height: 40, rotatable: true }),
  shape({ id: 'note', label: 'Note', category: 'annotations', keywords: 'annotation comment sticky', geometry: 'note', width: 180, height: 110, style: { fill: '#2a2213', stroke: '#d4a03a' }, rotatable: false }),
  shape({ id: 'sticky-yellow', label: 'Sticky · yellow', category: 'annotations', keywords: 'sticky note post-it memo annotation', geometry: 'rectangle', width: 160, height: 140, text: 'Note', style: { fill: '#fde68a', stroke: '#e0c35c', textColor: '#3b3108', strokeWidth: 1 }, rotatable: true }),
  shape({ id: 'sticky-pink', label: 'Sticky · pink', category: 'annotations', keywords: 'sticky note post-it memo annotation', geometry: 'rectangle', width: 160, height: 140, text: 'Note', style: { fill: '#fbcfe8', stroke: '#e29cc4', textColor: '#4a1031', strokeWidth: 1 }, rotatable: true }),
  shape({ id: 'sticky-green', label: 'Sticky · green', category: 'annotations', keywords: 'sticky note post-it memo annotation', geometry: 'rectangle', width: 160, height: 140, text: 'Note', style: { fill: '#bbf7d0', stroke: '#7fcf9c', textColor: '#0f3b22', strokeWidth: 1 }, rotatable: true }),
  shape({ id: 'sticky-blue', label: 'Sticky · blue', category: 'annotations', keywords: 'sticky note post-it memo annotation', geometry: 'rectangle', width: 160, height: 140, text: 'Note', style: { fill: '#bfdbfe', stroke: '#86b2e8', textColor: '#0e2a52', strokeWidth: 1 }, rotatable: true }),
  shape({ id: 'legend', label: 'Legend', category: 'annotations', keywords: 'legend key colors symbols explanation', geometry: 'legend', width: 200, height: 150, text: 'Legend', rotatable: false, legend: [
    { color: '#3fb96b', label: 'Success path' }, { color: '#d65a5a', label: 'Failure / compensation', dashed: true }, { color: '#4c8fd6', label: 'Service call' },
  ] }),
  shape({ id: 'image', label: 'Image', category: 'annotations', keywords: 'image picture png icon', geometry: 'image', width: 96, height: 96, text: '', style: { strokeWidth: 0 }, rotatable: true, hidden: true }),
]

const SHAPE_BY_ID = new Map(SHAPES.map((definition) => [definition.id, definition]))

/** The shape of an id; an unknown id (a newer file) falls back to a process box rather than failing. */
export function shapeOf(id: string): ShapeDefinition {
  return SHAPE_BY_ID.get(id) ?? SHAPE_BY_ID.get('process') ?? SHAPES[0]
}

export const isKnownShape = (id: string) => SHAPE_BY_ID.has(id)

/** Shapes matching a free-text query in their label, category or keywords; all of them for an empty one. */
export function searchShapes(query: string, shapes: readonly ShapeDefinition[] = SHAPES): ShapeDefinition[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const listed = shapes.filter((definition) => !definition.hidden)
  if (words.length === 0) return listed
  return listed.filter((definition) => {
    const haystack = `${definition.label} ${definition.category} ${definition.keywords} ${definition.subtitle ?? ''}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

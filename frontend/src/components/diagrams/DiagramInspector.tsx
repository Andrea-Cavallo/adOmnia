/**
 * The properties inspector: the diagram's own settings when nothing is selected, otherwise the
 * text, style and geometry of the selected shapes or the look of the selected connectors.
 * Style edits apply to every selected element at once.
 */
import { useShallow } from 'zustand/react/shallow'
import { Lock, Unlock } from 'lucide-react'
import type { ArrowHead, DiagramEdge, DiagramNode, EdgeRouting, NodeStyle } from '@/lib/diagrams/model'
import { STYLE_PALETTE, shapeOf } from '@/lib/diagrams/shapes'
import { useDiagramStudio } from '@/stores/diagramStudio'
import { ColorField, Field, NumberField, Section, SelectField, TextField, Toggle } from './inspectorFields'
import { SHAPE_ICON_NAMES } from './shapeIcons'

const ROUTING: ReadonlyArray<{ value: EdgeRouting; label: string }> = [
  { value: 'orthogonal', label: 'Orthogonal' }, { value: 'bezier', label: 'Bézier' }, { value: 'straight', label: 'Straight' },
]
const ARROWS: ReadonlyArray<{ value: ArrowHead; label: string }> = [
  { value: 'none', label: 'None' }, { value: 'arrow', label: 'Arrow' }, { value: 'open', label: 'Open arrow' },
  { value: 'diamond', label: 'Diamond' }, { value: 'circle', label: 'Circle' },
]
const fills = STYLE_PALETTE.map((entry) => ({ id: entry.id, label: entry.label, color: entry.fill }))
const strokes = STYLE_PALETTE.map((entry) => ({ id: entry.id, label: entry.label, color: entry.stroke }))
const textColors = [{ id: 'theme', label: 'Theme', color: '' }, { id: 'light', label: 'Light', color: '#e8e6e1' }, { id: 'dark', label: 'Dark', color: '#16171a' }, { id: 'green', label: 'Green', color: '#3fb96b' }]

function DiagramSettingsPanel() {
  const doc = useDiagramStudio((state) => state.doc)
  const rename = useDiagramStudio((state) => state.rename)
  const updateSettings = useDiagramStudio((state) => state.updateSettings)
  if (!doc) return null
  const { settings } = doc
  return (
    <>
      <Section title="Diagram">
        <Field label="Name" wide><TextField key={doc.id} value={doc.name} onCommit={rename} /></Field>
        <p className="diagram-inspector-note">{doc.nodes.length} shapes · {doc.edges.length} connectors</p>
      </Section>
      <Section title="Canvas">
        <Field label="Grid">
          <SelectField value={settings.grid} options={[{ value: 'dots', label: 'Dots' }, { value: 'lines', label: 'Lines' }, { value: 'none', label: 'None' }]} onChange={(grid) => updateSettings({ grid })} />
        </Field>
        <Field label="Grid size"><NumberField key={settings.gridSize} value={settings.gridSize} min={4} max={64} onCommit={(gridSize) => updateSettings({ gridSize })} /></Field>
        <Toggle label="Snap to grid" checked={settings.snapToGrid} onChange={(snapToGrid) => updateSettings({ snapToGrid })} />
        <Field label="New connectors">
          <SelectField value={settings.defaultRouting} options={ROUTING} onChange={(defaultRouting) => updateSettings({ defaultRouting })} />
        </Field>
      </Section>
      <p className="diagram-inspector-note">Select a shape or a connector to edit it. Double-click a shape or a connector to write in it.</p>
    </>
  )
}

function NodeInspector({ nodes }: { nodes: DiagramNode[] }) {
  const updateNodes = useDiagramStudio((state) => state.updateNodes)
  const lock = useDiagramStudio((state) => state.lock)
  const commit = useDiagramStudio((state) => state.commit)
  const first = nodes[0]
  const ids = nodes.map((node) => node.id)
  const single = nodes.length === 1
  const definition = shapeOf(first.data.shape)
  const style = (patch: Partial<NodeStyle>) => updateNodes(ids, { style: { ...first.data.style, ...patch } })
  const resize = (dimension: 'width' | 'height', value: number) =>
    commit((graph) => ({ ...graph, nodes: graph.nodes.map((node) => (ids.includes(node.id) ? { ...node, [dimension]: value } : node)) }))
  const locked = nodes.every((node) => node.data.locked)

  return (
    <div key={ids.join(',')}>
      <Section title={single ? definition.label : `${nodes.length} shapes`}>
        {single && <Field label="Text" wide><TextField value={first.data.label} onCommit={(label) => updateNodes(ids, { label })} multiline /></Field>}
        {single && <Field label="Subtitle" wide><TextField value={first.data.subtitle ?? ''} onCommit={(subtitle) => updateNodes(ids, { subtitle })} placeholder="Technology, port, stereotype…" /></Field>}
        {single && definition.compartments && (
          <>
            <Field label="Attributes" wide><TextField value={first.data.attributes ?? ''} onCommit={(attributes) => updateNodes(ids, { attributes })} multiline mono /></Field>
            <Field label="Operations" wide><TextField value={first.data.operations ?? ''} onCommit={(operations) => updateNodes(ids, { operations })} multiline mono /></Field>
          </>
        )}
        <Field label="Icon">
          <SelectField value={first.data.icon ?? ''} options={[{ value: '', label: 'None' }, ...SHAPE_ICON_NAMES.map((name) => ({ value: name, label: name }))]} onChange={(icon) => updateNodes(ids, { icon: icon || undefined })} />
        </Field>
      </Section>
      <Section title="Style">
        <Field label="Fill" wide><ColorField value={first.data.style.fill} swatches={fills} onChange={(fill) => style({ fill })} /></Field>
        <Field label="Border" wide><ColorField value={first.data.style.stroke} swatches={strokes} onChange={(stroke) => style({ stroke })} /></Field>
        <Field label="Border width"><NumberField key={first.data.style.strokeWidth} value={first.data.style.strokeWidth} min={0} max={8} step={0.5} onCommit={(strokeWidth) => style({ strokeWidth })} /></Field>
        <Toggle label="Dashed border" checked={first.data.style.dashed} onChange={(dashed) => style({ dashed })} />
        <Field label="Text color" wide><ColorField value={first.data.style.textColor} swatches={textColors} onChange={(textColor) => style({ textColor })} /></Field>
        <Field label="Font size"><NumberField key={first.data.style.fontSize} value={first.data.style.fontSize} min={8} max={48} onCommit={(fontSize) => style({ fontSize })} /></Field>
      </Section>
      {single && (
        <Section title="Geometry">
          <Field label="Width"><NumberField key={`w${first.width}`} value={Math.round(first.width ?? definition.width)} min={24} max={4000} onCommit={(value) => resize('width', value)} /></Field>
          <Field label="Height"><NumberField key={`h${first.height}`} value={Math.round(first.height ?? definition.height)} min={24} max={4000} onCommit={(value) => resize('height', value)} /></Field>
          {definition.rotatable && <Field label="Rotation"><NumberField key={`r${first.data.rotation}`} value={first.data.rotation} min={0} max={359} onCommit={(rotation) => updateNodes(ids, { rotation })} /></Field>}
        </Section>
      )}
      <button type="button" className="diagram-inspector-action" onClick={() => lock(!locked)}>
        {locked ? <Unlock size={12} /> : <Lock size={12} />} {locked ? 'Unlock' : 'Lock in place'}
      </button>
    </div>
  )
}

function EdgeInspector({ edges }: { edges: DiagramEdge[] }) {
  const updateEdges = useDiagramStudio((state) => state.updateEdges)
  const ids = edges.map((edge) => edge.id)
  const data = edges[0].data!
  return (
    <div key={ids.join(',')}>
      <Section title={edges.length === 1 ? 'Connector' : `${edges.length} connectors`}>
        {edges.length === 1 && <Field label="Label" wide><TextField value={data.label} onCommit={(label) => updateEdges(ids, { label })} placeholder="Double-click the line to write here" /></Field>}
        <Field label="Routing"><SelectField value={data.routing} options={ROUTING} onChange={(routing) => updateEdges(ids, { routing })} /></Field>
        <Field label="Color" wide><ColorField value={data.color} swatches={strokes} onChange={(color) => updateEdges(ids, { color })} /></Field>
        <Field label="Thickness"><NumberField key={data.thickness} value={data.thickness} min={0.5} max={8} step={0.5} onCommit={(thickness) => updateEdges(ids, { thickness })} /></Field>
        <Toggle label="Dashed" checked={data.dashed} onChange={(dashed) => updateEdges(ids, { dashed })} />
        <Field label="Start"><SelectField value={data.arrowStart} options={ARROWS} onChange={(arrowStart) => updateEdges(ids, { arrowStart })} /></Field>
        <Field label="End"><SelectField value={data.arrowEnd} options={ARROWS} onChange={(arrowEnd) => updateEdges(ids, { arrowEnd })} /></Field>
        <Toggle label="Animated data flow" checked={data.flow} onChange={(flow) => updateEdges(ids, { flow })} />
      </Section>
      {edges.some((edge) => (edge.data?.waypoints.length ?? 0) > 0) && (
        <button type="button" className="diagram-inspector-action" onClick={() => updateEdges(ids, { waypoints: [] })}>Reset bends (route automatically)</button>
      )}
      <p className="diagram-inspector-note">Drag a “+” on the selected connector to add a bend; double-click a bend to remove it. Drag an end to attach it elsewhere.</p>
    </div>
  )
}

export function DiagramInspector() {
  const nodes = useDiagramStudio(useShallow((state) => state.doc?.nodes.filter((node) => node.selected) ?? []))
  const edges = useDiagramStudio(useShallow((state) => state.doc?.edges.filter((edge) => edge.selected) ?? []))
  return (
    <aside className="diagram-inspector" aria-label="Properties">
      {nodes.length > 0 ? <NodeInspector nodes={nodes} /> : edges.length > 0 ? <EdgeInspector edges={edges} /> : <DiagramSettingsPanel />}
    </aside>
  )
}

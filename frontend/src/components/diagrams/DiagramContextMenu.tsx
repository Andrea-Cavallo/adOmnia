/** The right-click menu: the menu actions for the clicked element, plus Paste here and Add here. */
import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ClipboardPaste, Copy, Database, ExternalLink, GitBranch, ListTree, MessageSquare, MousePointerClick, Radio, RefreshCw, Square, StickyNote } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { absoluteRect } from '@/lib/diagrams/graphOps'
import { legendFromGraph } from '@/lib/diagrams/legend'
import type { DiagramNode } from '@/lib/diagrams/model'
import { STYLE_PALETTE } from '@/lib/diagrams/shapes'
import { useDiagramStudio } from '@/stores/diagramStudio'
import { useDiagramUi } from '@/stores/diagramStudioUi'
import { useDiagramCodeGraph } from '@/stores/diagramCodeGraph'
import { handoffToPanel } from '@/lib/entities/dispatch'
import type { EntityRef } from '@/lib/entities/types'
import { routeToModule } from '@/lib/moduleRouting'
import { DIAGRAM_ACTIONS, actionContext, shortcutLabel } from './diagramActions'

const MENU_ACTIONS = DIAGRAM_ACTIONS.filter((action) => action.places.includes('menu') && action.id !== 'paste')
/** Corner radii offered in the menu, as the color swatches are: sharp, soft, round, pill-ish. */
const RADIUS_PRESETS = [0, 4, 10, 20]
/** Gap between a shape and the sticky note created beside it. */
const STICKY_GAP = 32
const ACTION_GROUPS = [
  { label: 'Clipboard', ids: ['cut', 'copy', 'duplicate'] },
  { label: 'Arrange', ids: ['group', 'ungroup', 'front', 'forward', 'backward', 'back'] },
  { label: 'Selection', ids: ['lock', 'unlock', 'delete'] },
]

/** Opens towards the side with more room, so a menu near an edge of the window stays whole. */
function menuPlacement(x: number, y: number): CSSProperties {
  const horizontal = x > window.innerWidth / 2 ? { right: window.innerWidth - x } : { left: x }
  const vertical = y > window.innerHeight / 2 ? { bottom: window.innerHeight - y } : { top: y }
  return { ...horizontal, ...vertical }
}

export function DiagramContextMenu() {
  const menu = useDiagramUi((state) => state.menu)
  const openMenu = useDiagramUi((state) => state.openMenu)
  const editNode = useDiagramUi((state) => state.editNode)
  const editEdge = useDiagramUi((state) => state.editEdge)
  const context = useDiagramStudio(useShallow(actionContext))
  const analysis = useDiagramCodeGraph((state) => state.analysis)
  const nodes = useDiagramStudio((state) => state.doc?.nodes)
  const edges = useDiagramStudio((state) => state.doc?.edges)
  const legendRows = useMemo(() => legendFromGraph(nodes ?? [], edges ?? []), [nodes, edges])
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!menu || !element) return
    const box = element.getBoundingClientRect()
    element.style.left = `${Math.max(8, Math.min(box.x, window.innerWidth - box.width - 8))}px`
    element.style.top = `${Math.max(8, Math.min(box.y, window.innerHeight - box.height - 8))}px`
    element.style.right = 'auto'
    element.style.bottom = 'auto'
  }, [menu])

  useEffect(() => {
    if (!menu) return undefined
    const close = (event: Event) => { if (!ref.current?.contains(event.target as Node)) openMenu(null) }
    const previousFocus = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); openMenu(null); previousFocus?.focus() }
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, openMenu])

  if (!menu) return null
  const store = () => useDiagramStudio.getState()
  /** Fill (and, from the palette, the matching border) of every selected unlocked shape. */
  const fillSelection = (fill: string, stroke?: string) => store().commit((graph) => ({
    ...graph,
    nodes: graph.nodes.map((node) => (node.selected && !node.data.locked
      ? { ...node, data: { ...node.data, style: { ...node.data.style, fill, ...(stroke === undefined ? {} : { stroke }) } } }
      : node)),
  }))
  const run = (task: () => void) => { task(); openMenu(null) }
  const target = menu.target
  const actions = target.kind === 'pane' ? [] : MENU_ACTIONS.filter((action) => action.enabled(context))
  const node = target.kind === 'node' ? nodes?.find((candidate) => candidate.id === target.id) : undefined
  const source = node?.data.source
  const entity = source && analysis ? analysis.entities.find((candidate) => candidate.id === source.entityId) : undefined
  const flowEntity = source && ['function', 'method', 'flow', 'subflow', 'endpoint'].includes(source.kind)
  const copy = (value: string | undefined) => { if (value) void navigator.clipboard?.writeText(value) }
  const openWorkspace = (rail: 'database' | 'broker') => {
    if (!entity) return
    const kind = rail === 'database' ? 'table' : 'topic'
    const workspaceRef: EntityRef = { kind, id: `${kind}:${entity.label}`, label: entity.label, attrs: rail === 'broker' && entity.detail ? { broker: entity.detail } : {} }
    handoffToPanel(rail, workspaceRef, rail === 'database' ? 'query' : 'open')
  }
  const openEndpoint = () => {
    if (!source?.file) return
    const match = /^([A-Z]+)\s+(.+)$/.exec(entity?.label ?? '')
    routeToModule('collections', {
      kind: 'api-code-handler', sessionId: source.sessionId, file: source.file, line: source.line ?? 1,
      ...(match ? { fallback: { method: match[1], path: match[2], label: entity?.label } } : {}),
    })
  }
  const refreshNode = () => {
    void useDiagramCodeGraph.getState().generate({ refresh: true, mode: 'refresh' }).then(() => {
      if (node) useDiagramUi.getState().focusNode(node.id)
    })
  }
  /** Corner radius of every selected unlocked shape, in one undo step. */
  const setRadius = (radius: number) => store().commit((graph) => ({
    ...graph,
    nodes: graph.nodes.map((node) => (node.selected && !node.data.locked
      ? { ...node, data: { ...node.data, style: { ...node.data.style, radius } } }
      : node)),
  }))
  /** A sticky note beside the clicked shape, already open for typing. */
  const addStickyBeside = (targetNode: DiagramNode) => {
    const box = absoluteRect(targetNode, new Map((nodes ?? []).map((candidate) => [candidate.id, candidate])))
    const id = store().addShape('sticky-yellow', { x: box.x + box.width + STICKY_GAP, y: box.y })
    if (id) editNode(id)
  }

  const navigate = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || (event.target as HTMLElement).tagName === 'INPUT') return
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    if (!items.length) return
    event.preventDefault()
    event.stopPropagation()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % items.length : (current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length)
    items[index].focus()
  }

  return (
    <div ref={ref} className="diagram-menu diagram-context-menu diagram-no-export" role="menu" aria-label={target.kind === 'node' ? 'Shape actions' : target.kind === 'edge' ? 'Connector actions' : 'Canvas actions'} tabIndex={-1} onKeyDown={navigate} style={menuPlacement(menu.x, menu.y)}>
      <div className="diagram-context-heading"><strong>{target.kind === 'node' ? 'Shape' : target.kind === 'edge' ? 'Connector' : 'Canvas'}</strong><span>{context.nodes + context.edges > 1 ? `${context.nodes + context.edges} selected` : node?.data.label || 'Actions'}</span></div>
      {target.kind === 'node' && (
        <button type="button" role="menuitem" onClick={() => run(() => editNode(target.id))}><MousePointerClick size={12} /> Edit text<kbd>Double-click</kbd></button>
      )}
      {target.kind === 'node' && node && (
        <button type="button" role="menuitem" onClick={() => run(() => addStickyBeside(node))}><StickyNote size={12} /> Add sticky note</button>
      )}
      {target.kind === 'edge' && (
        <button type="button" role="menuitem" onClick={() => run(() => editEdge(target.id))}><MousePointerClick size={12} /> Edit label<kbd>Double-click</kbd></button>
      )}
      {target.kind === 'node' && (
        <>
          <div className="diagram-menu-group">Fill color</div>
          <div className="diagram-menu-swatches" role="group" aria-label="Fill color">
            {STYLE_PALETTE.map((entry) => (
              <button key={entry.id} type="button" className={entry.fill ? 'diagram-swatch' : 'diagram-swatch diagram-swatch--theme'} style={entry.fill ? { background: entry.fill, borderColor: entry.stroke } : undefined}
                title={`Fill: ${entry.label}`} aria-label={`Fill ${entry.label}`} aria-pressed={node?.data.style.fill === entry.fill} onClick={() => run(() => fillSelection(entry.fill, entry.stroke))} />
            ))}
            <input type="color" className="diagram-swatch-custom" title="Custom fill" aria-label="Custom fill" onChange={(event) => fillSelection(event.target.value)} />
          </div>
          <div className="diagram-menu-group">Corner radius <span>px</span></div>
          <div className="diagram-menu-radii" role="group" aria-label="Corner radius">
            {RADIUS_PRESETS.map((radius) => (
              <button
                key={radius}
                type="button"
                className={node?.data.style.radius === radius ? 'is-current' : undefined}
                title={radius === 0 ? 'Sharp corners' : `Corner radius ${radius} px`}
                aria-label={radius === 0 ? 'Sharp corners' : `Corner radius ${radius}`}
                aria-pressed={node?.data.style.radius === radius}
                onClick={() => run(() => setRadius(radius))}
              >
                <span className="diagram-radius-glyph" style={{ borderRadius: Math.min(radius, 8) }} />
                {radius === 0 ? '0' : radius}
              </button>
            ))}
          </div>
          <div className="diagram-menu-divider" role="separator" />
        </>
      )}
      {source && (
        <>
          <div className="diagram-menu-group">Linked source</div>
          <div className="diagram-menu-divider" role="separator" />
          {source.file && (
            <button type="button" role="menuitem" onClick={() => run(() => void useDiagramCodeGraph.getState().openSource(node!.id))}>
              <ExternalLink size={12} /> Open in Code Studio (Split Right)
            </button>
          )}
          {flowEntity && (
            <>
              <button type="button" role="menuitem" onClick={() => run(() => { void useDiagramCodeGraph.getState().expand('callers') })}>
                <GitBranch size={12} /> Show Callers
              </button>
              <button type="button" role="menuitem" onClick={() => run(() => { void useDiagramCodeGraph.getState().expand('callees') })}>
                <GitBranch size={12} /> Show Callees
              </button>
            </>
          )}
          {source.kind === 'endpoint' && (
            <button type="button" role="menuitem" onClick={() => run(openEndpoint)}><MessageSquare size={12} /> Open in API Workspace</button>
          )}
          {source.kind === 'table' && (
            <button type="button" role="menuitem" onClick={() => run(() => openWorkspace('database'))}><Database size={12} /> Open in Database Studio</button>
          )}
          {source.kind === 'topic' && (
            <button type="button" role="menuitem" onClick={() => run(() => openWorkspace('broker'))}><Radio size={12} /> Open in Broker Studio</button>
          )}
          <button type="button" role="menuitem" onClick={() => run(() => copy(source.symbol ?? source.entityId))}><Copy size={12} /> Copy Symbol</button>
          {source.file && <button type="button" role="menuitem" onClick={() => run(() => copy(`${source.file}${source.line ? `:${source.line}` : ''}`))}><Copy size={12} /> Copy Path</button>}
          <button type="button" role="menuitem" onClick={() => run(refreshNode)}><RefreshCw size={12} /> Refresh / Re-resolve</button>
          <div className="diagram-menu-divider" role="separator" />
        </>
      )}
      {ACTION_GROUPS.map((group) => {
        const grouped = actions.filter((action) => group.ids.includes(action.id))
        if (!grouped.length) return null
        return <div key={group.label} role="group" aria-label={group.label} className="diagram-context-section">
          <div className="diagram-menu-group">{group.label}</div>
          {grouped.map((action) => {
            const Icon = action.icon
            return <button key={action.id} type="button" role="menuitem" className={action.id === 'delete' ? 'is-danger' : undefined} onClick={() => run(() => action.run(store()))}>
              <Icon size={14} /><span>{action.label}</span>{action.shortcut && <kbd>{shortcutLabel(action.shortcut)}</kbd>}
            </button>
          })}
        </div>
      })}
      {target.kind === 'pane' && (
        <>
          <button type="button" role="menuitem" disabled={!context.canPaste} onClick={() => run(() => store().paste({ x: menu.flowX, y: menu.flowY }))}>
            <ClipboardPaste size={12} /> Paste here<kbd>{shortcutLabel('Mod+V')}</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => run(() => store().addShape('process', { x: menu.flowX, y: menu.flowY }))}>
            <Square size={12} /> Add a process here
          </button>
          <button type="button" role="menuitem" onClick={() => run(() => store().addShape('sticky-yellow', { x: menu.flowX, y: menu.flowY }))}>
            <StickyNote size={12} /> Add a sticky note here
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={legendRows.length === 0}
            title={legendRows.length ? `Rows for the ${legendRows.length} colors the diagram already uses` : 'Color a shape or a connector first'}
            onClick={() => run(() => { store().addLegend({ x: menu.flowX, y: menu.flowY }) })}
          >
            <ListTree size={12} /> Add legend (colors in use)
          </button>
          <button type="button" role="menuitem" onClick={() => run(() => store().selectAll())}>Select all<kbd>{shortcutLabel('Mod+A')}</kbd></button>
        </>
      )}
    </div>
  )
}

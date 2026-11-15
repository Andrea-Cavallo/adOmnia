import { useState } from 'react'
import { observer } from 'mobx-react-lite'
import { ChevronDown, ChevronRight, Component, EyeOff } from 'lucide-react'
import type { LayerNode } from '@onlook/models'
import type { DesignSession } from '../adapters/design-session'

const MAX_ROWS = 600

interface Row {
  node: LayerNode
  depth: number
  expandable: boolean
}

/** Flattens the visible part of the layer tree, depth first, up to MAX_ROWS rows. */
function visibleRows(root: LayerNode, lookup: (domId: string) => LayerNode | undefined, collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = []
  const stack: Array<{ node: LayerNode; depth: number }> = [{ node: root, depth: 0 }]
  while (stack.length > 0 && rows.length < MAX_ROWS) {
    const item = stack.pop()
    if (!item) break
    const children = item.node.children ?? []
    rows.push({ node: item.node, depth: item.depth, expandable: children.length > 0 })
    if (collapsed.has(item.node.domId)) continue
    for (let index = children.length - 1; index >= 0; index--) {
      const child = lookup(children[index] ?? '')
      if (child) stack.push({ node: child, depth: item.depth + 1 })
    }
  }
  return rows
}

/** Layers of the page: the element tree the in-page script reports, selectable from the list. */
export const DesignLayers = observer(function DesignLayers({ session }: { session: DesignSession }) {
  const { engine, frame } = session
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const root = engine.ast.mappings.getRootLayer(frame.id)
  if (!root) return <p className="px-1 py-2 text-[11px] text-text-4">Waiting for the page…</p>

  const lookup = (domId: string) => engine.ast.mappings.getLayerNode(frame.id, domId)
  const rows = visibleRows(root, lookup, collapsed)
  const selectedIds = new Set(engine.elements.selected.map((element) => element.domId))

  const toggle = (domId: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (!next.delete(domId)) next.add(domId)
    return next
  })

  const act = async (domId: string, action: 'select' | 'hover') => {
    const view = engine.frames.get(frame.id)?.view
    if (!view) return
    const element = await view.getElementByDomId(domId, action === 'select')
    if (!element) return
    if (action === 'select') engine.elements.click([element])
    else engine.elements.mouseover(element)
  }

  return (
    <ul role="tree" aria-label="Layers" className="flex flex-col text-[11.5px]" onMouseLeave={() => engine.overlay.state.removeHoverRect()}>
      {rows.map(({ node, depth, expandable }) => {
        const selected = selectedIds.has(node.domId)
        const mapped = !!node.oid
        return (
          <li key={node.domId} role="treeitem" aria-selected={selected} aria-level={depth + 1} aria-expanded={expandable ? !collapsed.has(node.domId) : undefined}>
            <div
              className={`group flex h-6 items-center gap-1 rounded pr-1 ${selected ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-3'}`}
              style={{ paddingLeft: 4 + depth * 10 }}
              onMouseEnter={() => { void act(node.domId, 'hover') }}
            >
              {expandable ? (
                <button type="button" className="flex h-4 w-4 shrink-0 items-center justify-center text-text-4 hover:text-text-1" aria-label={collapsed.has(node.domId) ? 'Expand' : 'Collapse'} onClick={() => toggle(node.domId)}>
                  {collapsed.has(node.domId) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
              ) : <span className="h-4 w-4 shrink-0" aria-hidden="true" />}
              <button
                type="button" className={`flex min-w-0 flex-1 items-center gap-1 text-left ${mapped ? '' : 'text-text-4'}`}
                title={mapped ? undefined : 'No source mapping: rendered by a library or created at runtime'}
                onClick={() => { void act(node.domId, 'select') }}
                onDoubleClick={() => session.openSource(node.instanceId ?? node.oid)}
              >
                {node.component && <Component size={11} className="shrink-0 text-accent" aria-hidden="true" />}
                <span className="shrink-0 font-mono">{node.component ?? node.tagName}</span>
                {node.textContent && <span className="truncate text-text-4">{node.textContent}</span>}
              </button>
              {!node.isVisible && <EyeOff size={11} className="shrink-0 text-text-4" aria-label="Hidden" />}
            </div>
          </li>
        )
      })}
      {rows.length >= MAX_ROWS && <li className="px-1 py-1 text-[10.5px] text-text-4">Showing the first {MAX_ROWS} layers: collapse a branch to see more.</li>}
    </ul>
  )
})

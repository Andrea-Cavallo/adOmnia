/** The floating toolbar above the selected shapes: a few named actions, with alignment in one menu. */
import { useState } from 'react'
import { NodeToolbar, Position } from '@xyflow/react'
import { AlignHorizontalJustifyCenter, ChevronDown } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useDiagramStudio } from '@/stores/diagramStudio'
import { DIAGRAM_ACTIONS, actionContext, shortcutLabel, type DiagramAction } from './diagramActions'

const TOOLBAR_ACTIONS = DIAGRAM_ACTIONS.filter((action) => action.places.includes('toolbar'))
const isArrange = (action: DiagramAction) => action.id.startsWith('align-') || action.id.startsWith('distribute-')

export function SelectionToolbar() {
  const selected = useDiagramStudio(useShallow((state) => state.doc?.nodes.filter((node) => node.selected && !node.dragging).map((node) => node.id) ?? []))
  const dragging = useDiagramStudio((state) => state.doc?.nodes.some((node) => node.dragging) ?? false)
  const context = useDiagramStudio(useShallow(actionContext))
  const [arrangeOpen, setArrangeOpen] = useState(false)
  if (selected.length === 0 || dragging) return null
  const enabled = TOOLBAR_ACTIONS.filter((action) => action.enabled(context))
  const arrange = enabled.filter((action) => isArrange(action))
  const actions = enabled.filter((action) => !isArrange(action))
  const run = (action: DiagramAction) => { action.run(useDiagramStudio.getState()); setArrangeOpen(false) }
  const button = (action: DiagramAction) => {
    const Icon = action.icon
    return (
      <button
        key={action.id}
        type="button"
        title={action.shortcut ? `${action.label} (${shortcutLabel(action.shortcut)})` : action.label}
        onClick={() => run(action)}
        className={action.id === 'delete' ? 'is-danger' : undefined}
      >
        <Icon size={13} />
        <span>{action.label}</span>
      </button>
    )
  }
  return (
    // Visible for several nodes too: React Flow shows a toolbar only for a single selected node by default.
    <NodeToolbar nodeId={selected} isVisible position={Position.Top} offset={14} className="diagram-toolbar diagram-no-export">
      {actions.filter((action) => action.id !== 'delete').map((action) => button(action))}
      {arrange.length > 0 && (
        <span className="diagram-toolbar-arrange">
          <button type="button" aria-haspopup="menu" aria-expanded={arrangeOpen} onClick={() => setArrangeOpen((open) => !open)}>
            <AlignHorizontalJustifyCenter size={13} />
            <span>Align</span>
            <ChevronDown size={11} />
          </button>
          {arrangeOpen && <div role="menu" className="diagram-menu diagram-menu--dropdown">{arrange.map((action) => button(action))}</div>}
        </span>
      )}
      <span className="diagram-toolbar-divider" aria-hidden="true" />
      {actions.filter((action) => action.id === 'delete').map((action) => button(action))}
    </NodeToolbar>
  )
}

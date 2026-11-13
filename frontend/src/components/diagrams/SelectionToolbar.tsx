/** The minimal floating toolbar above the selected shapes: the toolbar actions that apply now. */
import { NodeToolbar, Position } from '@xyflow/react'
import { useShallow } from 'zustand/react/shallow'
import { useDiagramStudio } from '@/stores/diagramStudio'
import { DIAGRAM_ACTIONS, actionContext, shortcutLabel } from './diagramActions'

const TOOLBAR_ACTIONS = DIAGRAM_ACTIONS.filter((action) => action.places.includes('toolbar'))
/** Actions after which a divider is drawn, to group them by kind. */
const DIVIDE_AFTER = new Set(['ungroup', 'align-bottom', 'distribute-v', 'back', 'unlock'])

export function SelectionToolbar() {
  const selected = useDiagramStudio(useShallow((state) => state.doc?.nodes.filter((node) => node.selected && !node.dragging).map((node) => node.id) ?? []))
  const dragging = useDiagramStudio((state) => state.doc?.nodes.some((node) => node.dragging) ?? false)
  const context = useDiagramStudio(useShallow(actionContext))
  if (selected.length === 0 || dragging) return null
  const actions = TOOLBAR_ACTIONS.filter((action) => action.enabled(context))
  return (
    // Visible for several nodes too: React Flow shows a toolbar only for a single selected node by default.
    <NodeToolbar nodeId={selected} isVisible position={Position.Top} offset={14} className="diagram-toolbar diagram-no-export">
      {actions.map((action, index) => {
        const Icon = action.icon
        const next = actions[index + 1]
        return (
          <span key={action.id} className="diagram-toolbar-item">
            <button
              type="button"
              title={action.shortcut ? `${action.label} (${shortcutLabel(action.shortcut)})` : action.label}
              aria-label={action.label}
              onClick={() => action.run(useDiagramStudio.getState())}
              className={action.id === 'delete' ? 'is-danger' : undefined}
            >
              <Icon size={13} />
            </button>
            {next && DIVIDE_AFTER.has(action.id) && <span className="diagram-toolbar-divider" aria-hidden="true" />}
          </span>
        )
      })}
    </NodeToolbar>
  )
}

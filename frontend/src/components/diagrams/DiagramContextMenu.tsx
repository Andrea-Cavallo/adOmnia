/** The right-click menu: the menu actions for the clicked element, plus Paste here and Add here. */
import { useEffect, useRef } from 'react'
import { ClipboardPaste, MousePointerClick, Square } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useDiagramStudio } from '@/stores/diagramStudio'
import { useDiagramUi } from '@/stores/diagramStudioUi'
import { DIAGRAM_ACTIONS, actionContext, shortcutLabel } from './diagramActions'

const MENU_ACTIONS = DIAGRAM_ACTIONS.filter((action) => action.places.includes('menu') && action.id !== 'paste')

export function DiagramContextMenu() {
  const menu = useDiagramUi((state) => state.menu)
  const openMenu = useDiagramUi((state) => state.openMenu)
  const editNode = useDiagramUi((state) => state.editNode)
  const editEdge = useDiagramUi((state) => state.editEdge)
  const context = useDiagramStudio(useShallow(actionContext))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return undefined
    const close = (event: Event) => { if (!ref.current?.contains(event.target as Node)) openMenu(null) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') openMenu(null) }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, openMenu])

  if (!menu) return null
  const store = () => useDiagramStudio.getState()
  const run = (task: () => void) => { task(); openMenu(null) }
  const target = menu.target
  const actions = target.kind === 'pane' ? [] : MENU_ACTIONS.filter((action) => action.enabled(context))

  return (
    <div ref={ref} className="diagram-menu diagram-no-export" role="menu" style={{ left: menu.x, top: menu.y }}>
      {target.kind === 'node' && (
        <button type="button" role="menuitem" onClick={() => run(() => editNode(target.id))}><MousePointerClick size={12} /> Edit text<kbd>Double-click</kbd></button>
      )}
      {target.kind === 'edge' && (
        <button type="button" role="menuitem" onClick={() => run(() => editEdge(target.id))}><MousePointerClick size={12} /> Edit label<kbd>Double-click</kbd></button>
      )}
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <button key={action.id} type="button" role="menuitem" className={action.id === 'delete' ? 'is-danger' : undefined} onClick={() => run(() => action.run(store()))}>
            <Icon size={12} /> {action.label}{action.shortcut && <kbd>{shortcutLabel(action.shortcut)}</kbd>}
          </button>
        )
      })}
      {target.kind === 'pane' && (
        <>
          <button type="button" role="menuitem" disabled={!context.canPaste} onClick={() => run(() => store().paste({ x: menu.flowX, y: menu.flowY }))}>
            <ClipboardPaste size={12} /> Paste here<kbd>{shortcutLabel('Mod+V')}</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => run(() => store().addShape('process', { x: menu.flowX, y: menu.flowY }))}>
            <Square size={12} /> Add a process here
          </button>
          <button type="button" role="menuitem" onClick={() => run(() => store().selectAll())}>Select all<kbd>{shortcutLabel('Mod+A')}</kbd></button>
        </>
      )}
    </div>
  )
}

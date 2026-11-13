/**
 * Editing actions described once: label, icon, shortcut, when they apply and what they do. The
 * floating toolbar, the context menu and the keyboard all read this list.
 */
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
  ArrowDownToLine, ArrowUpToLine, BringToFront, ClipboardPaste, Copy, CopyPlus, Group, Lock, Scissors, SendToBack,
  StretchHorizontal, StretchVertical, Trash2, Ungroup, Unlock, type LucideIcon,
} from 'lucide-react'
import { shapeOf } from '@/lib/diagrams/shapes'
import type { useDiagramStudio } from '@/stores/diagramStudio'

type Store = ReturnType<typeof useDiagramStudio.getState>

export interface ActionContext {
  nodes: number
  edges: number
  containers: number
  locked: boolean
  canPaste: boolean
}

export interface DiagramAction {
  id: string
  label: string
  icon: LucideIcon
  /** Shown in menus and tooltips; `Mod` is Ctrl, or Cmd on macOS. */
  shortcut?: string
  /** Where the action is offered beyond the keyboard. */
  places: ReadonlyArray<'toolbar' | 'menu'>
  enabled: (context: ActionContext) => boolean
  run: (store: Store) => void
}

const anySelection = (context: ActionContext) => context.nodes + context.edges > 0
const atLeast = (count: number) => (context: ActionContext) => context.nodes >= count

export const DIAGRAM_ACTIONS: readonly DiagramAction[] = [
  { id: 'cut', label: 'Cut', icon: Scissors, shortcut: 'Mod+X', places: ['menu'], enabled: atLeast(1), run: (store) => store.cut() },
  { id: 'copy', label: 'Copy', icon: Copy, shortcut: 'Mod+C', places: ['menu'], enabled: atLeast(1), run: (store) => store.copy() },
  { id: 'paste', label: 'Paste', icon: ClipboardPaste, shortcut: 'Mod+V', places: ['menu'], enabled: (context) => context.canPaste, run: (store) => store.paste() },
  { id: 'duplicate', label: 'Duplicate', icon: CopyPlus, shortcut: 'Mod+D', places: ['toolbar', 'menu'], enabled: atLeast(1), run: (store) => store.duplicate() },
  { id: 'group', label: 'Group', icon: Group, shortcut: 'Mod+G', places: ['toolbar', 'menu'], enabled: atLeast(2), run: (store) => store.group() },
  { id: 'ungroup', label: 'Ungroup', icon: Ungroup, shortcut: 'Mod+Shift+G', places: ['toolbar', 'menu'], enabled: (context) => context.containers > 0, run: (store) => store.ungroupSelection() },
  { id: 'align-left', label: 'Align left', icon: AlignStartVertical, places: ['toolbar'], enabled: atLeast(2), run: (store) => store.align('left') },
  { id: 'align-center', label: 'Align centers', icon: AlignCenterVertical, places: ['toolbar'], enabled: atLeast(2), run: (store) => store.align('center') },
  { id: 'align-right', label: 'Align right', icon: AlignEndVertical, places: ['toolbar'], enabled: atLeast(2), run: (store) => store.align('right') },
  { id: 'align-top', label: 'Align top', icon: AlignStartHorizontal, places: ['toolbar'], enabled: atLeast(2), run: (store) => store.align('top') },
  { id: 'align-middle', label: 'Align middles', icon: AlignCenterHorizontal, places: ['toolbar'], enabled: atLeast(2), run: (store) => store.align('middle') },
  { id: 'align-bottom', label: 'Align bottom', icon: AlignEndHorizontal, places: ['toolbar'], enabled: atLeast(2), run: (store) => store.align('bottom') },
  { id: 'distribute-h', label: 'Distribute horizontally', icon: StretchHorizontal, places: ['toolbar'], enabled: atLeast(3), run: (store) => store.distribute('horizontal') },
  { id: 'distribute-v', label: 'Distribute vertically', icon: StretchVertical, places: ['toolbar'], enabled: atLeast(3), run: (store) => store.distribute('vertical') },
  { id: 'front', label: 'Bring to front', icon: BringToFront, shortcut: 'Mod+Shift+]', places: ['toolbar', 'menu'], enabled: atLeast(1), run: (store) => store.layer('front') },
  { id: 'forward', label: 'Bring forward', icon: ArrowUpToLine, shortcut: 'Mod+]', places: ['menu'], enabled: atLeast(1), run: (store) => store.layer('forward') },
  { id: 'backward', label: 'Send backward', icon: ArrowDownToLine, shortcut: 'Mod+[', places: ['menu'], enabled: atLeast(1), run: (store) => store.layer('backward') },
  { id: 'back', label: 'Send to back', icon: SendToBack, shortcut: 'Mod+Shift+[', places: ['toolbar', 'menu'], enabled: atLeast(1), run: (store) => store.layer('back') },
  { id: 'lock', label: 'Lock', icon: Lock, shortcut: 'Mod+L', places: ['toolbar', 'menu'], enabled: (context) => context.nodes > 0 && !context.locked, run: (store) => store.lock(true) },
  { id: 'unlock', label: 'Unlock', icon: Unlock, shortcut: 'Mod+L', places: ['toolbar', 'menu'], enabled: (context) => context.nodes > 0 && context.locked, run: (store) => store.lock(false) },
  { id: 'delete', label: 'Delete', icon: Trash2, shortcut: 'Del', places: ['toolbar', 'menu'], enabled: anySelection, run: (store) => store.deleteSelection() },
]

export function actionContext(store: Store): ActionContext {
  const nodes = store.doc?.nodes.filter((node) => node.selected) ?? []
  return {
    nodes: nodes.length,
    edges: store.doc?.edges.filter((edge) => edge.selected).length ?? 0,
    containers: nodes.filter((node) => shapeOf(node.data.shape).container).length,
    locked: nodes.length > 0 && nodes.every((node) => node.data.locked),
    canPaste: (store.clipboard?.nodes.length ?? 0) > 0,
  }
}

const isMac = () => typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
export const shortcutLabel = (shortcut: string) => shortcut.replace('Mod', isMac() ? '⌘' : 'Ctrl')

/** True when the key goes to a text field rather than to the canvas. */
export function typingIn(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
}

const NUDGE = 1
const NUDGE_FAR = 10

/**
 * Handles an editor shortcut; returns true when it did something (so the caller prevents the
 * browser default). Arrow keys nudge the selection.
 */
export function handleDiagramKey(event: KeyboardEvent | React.KeyboardEvent, store: Store): boolean {
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  const run = (id: string) => {
    const action = DIAGRAM_ACTIONS.find((candidate) => candidate.id === id)
    if (!action || !action.enabled(actionContext(store))) return true
    action.run(store)
    return true
  }
  if (mod && key === 'z') { if (event.shiftKey) store.redo(); else store.undo(); return true }
  if (mod && key === 'y') { store.redo(); return true }
  if (mod && key === 'a') { store.selectAll(); return true }
  if (mod && key === 'x') return run('cut')
  if (mod && key === 'c') return run('copy')
  if (mod && key === 'v') return run('paste')
  if (mod && key === 'd') return run('duplicate')
  if (mod && key === 'g') return run(event.shiftKey ? 'ungroup' : 'group')
  if (mod && key === 'l') return run(actionContext(store).locked ? 'unlock' : 'lock')
  if (mod && (key === ']' || key === '[')) return run(key === ']' ? (event.shiftKey ? 'front' : 'forward') : (event.shiftKey ? 'back' : 'backward'))
  if (!mod && (key === 'delete' || key === 'backspace')) return run('delete')
  const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }
  if (!mod && arrows[key]) {
    const ids = store.doc?.nodes.filter((node) => node.selected && !node.data.locked).map((node) => node.id) ?? []
    if (ids.length === 0) return false
    const distance = event.shiftKey ? NUDGE_FAR : NUDGE
    const [dx, dy] = arrows[key]
    store.commit((graph) => ({ ...graph, nodes: graph.nodes.map((node) => (ids.includes(node.id) ? { ...node, position: { x: node.position.x + dx * distance, y: node.position.y + dy * distance } } : node)) }))
    return true
  }
  return false
}

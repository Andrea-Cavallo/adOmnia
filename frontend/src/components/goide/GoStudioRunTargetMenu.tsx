import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import type { GoStudioRunTarget } from './goStudioRunTargets'

export type GoStudioRunTargetAction = 'run' | 'debug' | 'coverage'

interface GoStudioRunTargetMenuProps {
  target: GoStudioRunTarget
  x: number
  y: number
  onAction: (target: GoStudioRunTarget, action: GoStudioRunTargetAction) => void
  onClose: () => void
}

function itemsFor(target: GoStudioRunTarget): ContextMenuItem[] {
  const name = target.kind === 'main' ? 'main' : target.name
  const items: ContextMenuItem[] = [
    { id: 'run', label: `Run '${name}'` },
    { id: 'debug', label: `Debug '${name}'`, shortcut: target.kind === 'main' ? 'Shift+F9' : undefined },
  ]
  if (target.kind === 'test' || target.kind === 'fuzz' || target.kind === 'example') items.push({ id: 'coverage', label: `Run '${name}' with Coverage` })
  return items
}

/** Menu del ▶ nel gutter: Run, Debug e, per i test, Run with Coverage. */
export function GoStudioRunTargetMenu({ target, x, y, onAction, onClose }: GoStudioRunTargetMenuProps) {
  return (
    <ContextMenu
      x={x}
      y={y}
      items={itemsFor(target)}
      onSelect={(id) => { onClose(); onAction(target, id as GoStudioRunTargetAction) }}
      onClose={onClose}
    />
  )
}

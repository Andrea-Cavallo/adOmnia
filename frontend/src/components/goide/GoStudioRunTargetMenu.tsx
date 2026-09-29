import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import type { GoStudioRunTarget } from './goStudioRunTargets'

export type GoStudioRunTargetAction = 'run' | 'debug' | 'coverage' | 'build' | 'buildRun' | 'down' | 'save'

interface GoStudioRunTargetMenuProps {
  target: GoStudioRunTarget
  x: number
  y: number
  onAction: (target: GoStudioRunTarget, action: GoStudioRunTargetAction) => void
  onClose: () => void
}

function itemsFor(target: GoStudioRunTarget): ContextMenuItem[] {
  if (target.kind === 'make') {
    return [
      { id: 'run', label: `Run 'make ${target.name}'` },
      { id: 'save', label: 'Save as Run Configuration…' },
    ]
  }
  if (target.kind === 'compose') {
    return target.name
      ? [{ id: 'run', label: `Compose Up '${target.name}'` }, { id: 'save', label: 'Save as Run Configuration…' }]
      : [
          { id: 'run', label: 'Compose Up (all services)' },
          { id: 'down', label: 'Compose Down' },
          { id: 'save', label: 'Save as Run Configuration…' },
        ]
  }
  if (target.kind === 'docker') {
    const stage = target.name ? ` '${target.name}'` : ''
    return [
      { id: 'build', label: `Build image${stage}` },
      { id: 'buildRun', label: `Build & Run container${stage}` },
      { id: 'save', label: 'Save as Run Configuration…' },
    ]
  }
  const name = target.kind === 'main' ? 'main' : target.name
  const items: ContextMenuItem[] = [
    { id: 'run', label: `Run '${name}'` },
    { id: 'debug', label: `Debug '${name}'`, shortcut: target.kind === 'main' ? 'Shift+F9' : undefined },
  ]
  if (target.kind === 'test' || target.kind === 'fuzz' || target.kind === 'example') items.push({ id: 'coverage', label: `Run '${name}' with Coverage` })
  return items
}

/** Menu del ▶ nel gutter: Run, Debug e Coverage per Go; Run/Build/Build & Run per make e Docker. */
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

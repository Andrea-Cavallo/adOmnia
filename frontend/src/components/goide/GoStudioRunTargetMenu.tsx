import { Bug, Container, FlaskConical, FlaskRound, Hammer, Play, Save, Square } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import type { GoStudioRunTarget } from './goStudioRunTargets'

export type GoStudioRunTargetAction = 'run' | 'debug' | 'coverage' | 'fuzz' | 'build' | 'buildRun' | 'down' | 'save'

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
      { id: 'run', label: `Run 'make ${target.name}'`, icon: Play, iconClassName: 'text-success' },
      { id: 'save', label: 'Save as Run Configuration…', icon: Save, separatorBefore: true },
    ]
  }
  if (target.kind === 'compose') {
    return target.name
      ? [{ id: 'run', label: `Compose Up '${target.name}'`, icon: Play, iconClassName: 'text-success' }, { id: 'save', label: 'Save as Run Configuration…', icon: Save, separatorBefore: true }]
      : [
          { id: 'run', label: 'Compose Up (all services)', icon: Play, iconClassName: 'text-success' },
          { id: 'down', label: 'Compose Down', icon: Square, iconClassName: 'text-danger' },
          { id: 'save', label: 'Save as Run Configuration…', icon: Save, separatorBefore: true },
        ]
  }
  if (target.kind === 'docker') {
    const stage = target.name ? ` '${target.name}'` : ''
    return [
      { id: 'build', label: `Build image${stage}`, icon: Hammer },
      { id: 'buildRun', label: `Build & Run container${stage}`, icon: Container, iconClassName: 'text-success' },
      { id: 'save', label: 'Save as Run Configuration…', icon: Save, separatorBefore: true },
    ]
  }
  if (target.kind === 'fuzz') {
    return [
      { id: 'run', label: `Run seed corpus '${target.name}'`, icon: Play, iconClassName: 'text-success' },
      { id: 'fuzz', label: `Fuzz '${target.name}' for 30 seconds`, icon: FlaskConical, iconClassName: 'text-accent' },
      { id: 'debug', label: `Debug seed corpus '${target.name}'`, icon: Bug, iconClassName: 'text-info', separatorBefore: true },
    ]
  }
  const name = target.kind === 'main' ? 'main' : target.name
  const items: ContextMenuItem[] = [
    { id: 'run', label: `Run '${name}'`, icon: Play, iconClassName: 'text-success' },
    { id: 'debug', label: `Debug '${name}'`, icon: Bug, iconClassName: 'text-info', shortcut: target.kind === 'main' ? 'Shift+F9' : undefined },
  ]
  if (target.kind === 'test' || target.kind === 'example') items.push({ id: 'coverage', label: `Run '${name}' with Coverage`, icon: FlaskRound, iconClassName: 'text-accent' })
  return items
}

/** Menu del ▶ nel gutter: Run, Debug e Coverage per Go; Run/Build/Build & Run per make e Docker. */
export function GoStudioRunTargetMenu({ target, x, y, onAction, onClose }: GoStudioRunTargetMenuProps) {
  return (
    <ContextMenu
      appearance="studio"
      x={x}
      y={y}
      items={itemsFor(target)}
      onSelect={(id) => { onClose(); onAction(target, id as GoStudioRunTargetAction) }}
      onClose={onClose}
    />
  )
}

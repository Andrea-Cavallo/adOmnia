import { Play } from 'lucide-react'
import type { GoIDERunTarget } from '@/lib/code-studio-api'
import { CodeStudioModal } from './CodeStudioModal'

interface CodeStudioRunTargetPickerProps {
  open: boolean
  targets: GoIDERunTarget[]
  onChoose: (target: GoIDERunTarget) => void
  onClose: () => void
}

export function CodeStudioRunTargetPicker({ open, targets, onChoose, onClose }: CodeStudioRunTargetPickerProps) {
  return (
    <CodeStudioModal
      open={open}
      onClose={onClose}
      title="Choose a main package"
      subtitle="This project has multiple runnable entry points. Your choice will be saved as the active Run configuration."
      icon={Play}
      size="sm"
      divided
    >
      <div className="gs-list" role="listbox" aria-label="Runnable main packages">
        {targets.map((target, index) => (
          <button
            key={`${target.moduleDir}:${target.package}`}
            type="button"
            role="option"
            aria-selected="false"
            data-autofocus={index === 0 ? true : undefined}
            className="gs-list-row w-full text-left"
            onClick={() => onChoose(target)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-text-1">{target.label}</span>
              <span className="block truncate font-mono text-[11px] text-text-3">{target.package}</span>
            </span>
            <span className="gs-badge">Run</span>
          </button>
        ))}
      </div>
    </CodeStudioModal>
  )
}

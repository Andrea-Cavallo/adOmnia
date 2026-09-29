import { useRef } from 'react'
import { Keyboard, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import { GO_STUDIO_COMMANDS, GO_STUDIO_MENUS, formatBinding } from './goStudioCommands'

interface GoStudioShortcutsDialogProps {
  open: boolean
  onClose: () => void
}

export function GoStudioShortcutsDialog({ open, onClose }: GoStudioShortcutsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center ad-modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Go Studio keyboard shortcuts" tabIndex={-1} className="flex max-h-[80vh] w-[520px] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-1 px-4"><Keyboard size={13} className="text-accent" /><h2 className="text-xs font-semibold text-text-1">Keyboard shortcuts</h2><button type="button" onClick={onClose} title="Close" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button></div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {GO_STUDIO_MENUS.map((menu) => {
            const commands = GO_STUDIO_COMMANDS.filter((command) => command.menu === menu.id && command.binding)
            if (commands.length === 0) return null
            return (
              <section key={menu.id} className="mb-3">
                <h3 className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">{menu.label}</h3>
                {commands.map((command) => (
                  <div key={command.id} className="flex h-6 items-center border-b border-border-1/60 text-[11px] text-text-2">
                    <span>{command.label}</span>
                    <kbd className="ml-auto rounded border border-border-1 bg-surface-0 px-1.5 font-mono text-[10px] text-text-3">{formatBinding(command.binding)}</kbd>
                  </div>
                ))}
              </section>
            )
          })}
          <p className="text-[9px] leading-4 text-text-4">Go Studio shortcuts apply only while this panel is open. Ctrl/Cmd+K still opens the adOmnia command palette.</p>
        </div>
      </div>
    </div>
  )
}

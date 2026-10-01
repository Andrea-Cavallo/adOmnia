import { useMemo, useState } from 'react'
import { AlertTriangle, Keyboard, RotateCcw, Search, X } from 'lucide-react'
import { GoStudioAlert, GoStudioButton, GoStudioModal } from './GoStudioModal'
import { GO_STUDIO_COMMANDS, GO_STUDIO_MENUS, commandShortcut, formatBinding, type GoStudioCommandId } from './goStudioCommands'
import { GO_STUDIO_KEYMAPS, bindingConflicts, bindingFromEvent, bindingSignature, effectiveAltBindings, effectiveBinding, isRebindable, useGoStudioKeymap, type GoStudioKeymapId } from './goStudioKeymap'
import { bindingSearchText } from './goStudioSearchExtras'

interface GoStudioShortcutsDialogProps {
  open: boolean
  onClose: () => void
}

/** Keymap di Go Studio: GoLand o VS Code, scorciatoie personalizzate, conflitti e ricerca per nome o per tasto. */
export function GoStudioShortcutsDialog({ open, onClose }: GoStudioShortcutsDialogProps) {
  const keymap = useGoStudioKeymap((state) => state.keymap)
  const custom = useGoStudioKeymap((state) => state.custom)
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<GoStudioCommandId | null>(null)
  // Mentre si registra un tasto, Esc annulla la registrazione invece di chiudere il dialog.

  const conflicts = useMemo(() => bindingConflicts(GO_STUDIO_COMMANDS, { keymap, custom }), [custom, keymap])
  const conflictCount = [...conflicts.values()].reduce((total, list) => total + list.length, 0)
  if (!open) return null

  const state = useGoStudioKeymap.getState()
  const needle = query.trim().toLowerCase()
  const matches = (id: GoStudioCommandId, label: string, shortcut: string) => !needle || `${label} ${bindingSearchText(shortcut)}`.toLowerCase().includes(needle) || id.includes(needle)

  const onRecordKey = (event: React.KeyboardEvent, id: GoStudioCommandId) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') return setRecording(null)
    const binding = bindingFromEvent(event)
    if (!binding) return
    state.setBinding(id, binding)
    setRecording(null)
  }

  return (
    <GoStudioModal
      open={open}
      onClose={onClose}
      size="lg"
      tall
      divided
      flush
      icon={Keyboard}
      title="Keyboard shortcuts"
      subtitle="Click a shortcut to change it. Shortcuts apply while Go Studio is open and are stored on this machine."
      footerStart="Ctrl/Cmd+K still opens the adOmnia command palette."
      footer={<GoStudioButton variant="ghost" onClick={onClose}>Close</GoStudioButton>}
    >
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-1 px-5 py-3">
          <label className="flex items-center gap-2 text-[12px] text-text-3">
            Keymap
            <select value={keymap} onChange={(event) => state.setKeymap(event.target.value as GoStudioKeymapId)} className="gs-input h-8 w-auto py-0">
              {GO_STUDIO_KEYMAPS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-4" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actions or keys, e.g. ctrl shift f" aria-label="Search shortcuts" className="gs-input pl-8" />
          </div>
          {Object.keys(custom).length > 0 && <GoStudioButton small variant="ghost" icon={RotateCcw} onClick={() => state.resetAll()}>Reset all</GoStudioButton>}
        </div>
        {conflictCount > 0 && (
          <div className="border-b border-border-1 px-5 py-2.5"><GoStudioAlert tone="warning" icon={AlertTriangle}>{conflicts.size} shortcut{conflicts.size === 1 ? ' is' : 's are'} shared by more than one action: the first available action wins.</GoStudioAlert></div>
        )}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {GO_STUDIO_MENUS.map((menu) => {
            const commands = GO_STUDIO_COMMANDS.filter((command) => command.menu === menu.id && matches(command.id, command.label, commandShortcut(command)))
            if (commands.length === 0) return null
            return (
              <section key={menu.id} className="mb-4">
                <h3 className="gs-section-title mb-1.5">{menu.label}</h3>
                {commands.map((command) => {
                  const binding = effectiveBinding(command, { keymap, custom })
                  const conflict = conflicts.get(bindingSignature(binding))
                  const shortcuts = [commandShortcut(command), ...effectiveAltBindings(command, { keymap, custom }).map((alt) => formatBinding(alt))].filter(Boolean)
                  const rebindable = isRebindable(command)
                  return (
                    <div key={command.id} className="group -mx-2 flex h-9 items-center gap-2 rounded-md px-2 text-[13px] text-text-2 hover:bg-surface-2/50">
                      <span className="min-w-0 flex-1 truncate">{command.label}</span>
                      {command.id in custom && <span className="gs-badge h-[18px] text-[10.5px] text-accent">custom</span>}
                      {conflict && <span title={`Also used by: ${conflict.filter((other) => other.id !== command.id).map((other) => other.label).join(', ')}`} className="text-warning"><AlertTriangle size={14} aria-label="Shortcut conflict" /></span>}
                      {recording === command.id ? (
                        <input data-keymap-recorder autoFocus readOnly value="Press keys… (Esc cancels)" onKeyDown={(event) => onRecordKey(event, command.id)} onBlur={() => setRecording(null)} aria-label={`New shortcut for ${command.label}`} className="h-7 w-48 rounded-md border border-accent bg-surface-0 px-2 text-[12px] text-accent outline-none" />
                      ) : (
                        <button type="button" disabled={!rebindable} onClick={() => setRecording(command.id)} title={rebindable ? 'Click to change the shortcut' : 'Double Shift cannot be changed'} className="gs-kbd h-7 cursor-pointer px-2 text-[11.5px] hover:border-accent/60 hover:text-text-1 disabled:cursor-default">
                          {shortcuts.length ? shortcuts.join('  ·  ') : 'Not set'}
                        </button>
                      )}
                      <span className="flex w-14 justify-end gap-0.5 opacity-0 group-hover:opacity-100">
                        {rebindable && binding && <button type="button" onClick={() => state.setBinding(command.id, null)} title="Remove shortcut" aria-label="Remove shortcut" className="gs-btn gs-btn-danger-ghost gs-btn-sm gs-btn-icon"><X size={13} /></button>}
                        {command.id in custom && <button type="button" onClick={() => state.resetBinding(command.id)} title="Reset to the keymap" aria-label="Reset to the keymap" className="gs-btn gs-btn-ghost gs-btn-sm gs-btn-icon"><RotateCcw size={13} /></button>}
                      </span>
                    </div>
                  )
                })}
              </section>
            )
          })}
        </div>
    </GoStudioModal>
  )
}

import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Keyboard, RotateCcw, Search, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import { GO_STUDIO_COMMANDS, GO_STUDIO_MENUS, commandShortcut, formatBinding, type GoStudioCommandId } from './goStudioCommands'
import { GO_STUDIO_KEYMAPS, bindingConflicts, bindingFromEvent, bindingSignature, effectiveAltBindings, effectiveBinding, isRebindable, useGoStudioKeymap, type GoStudioKeymapId } from './goStudioKeymap'
import { bindingSearchText } from './goStudioSearchExtras'

interface GoStudioShortcutsDialogProps {
  open: boolean
  onClose: () => void
}

/** Keymap di Go Studio: GoLand o VS Code, scorciatoie personalizzate, conflitti e ricerca per nome o per tasto. */
export function GoStudioShortcutsDialog({ open, onClose }: GoStudioShortcutsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const keymap = useGoStudioKeymap((state) => state.keymap)
  const custom = useGoStudioKeymap((state) => state.custom)
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<GoStudioCommandId | null>(null)
  // Mentre si registra un tasto, Esc annulla la registrazione invece di chiudere il dialog.
  useModalFocusTrap(open, () => (recording ? setRecording(null) : onClose()), dialogRef)

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
    <div className="fixed inset-0 z-50 flex items-center justify-center ad-modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Go Studio keyboard shortcuts" tabIndex={-1} className="flex max-h-[84vh] w-[640px] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-1 px-4">
          <Keyboard size={13} className="text-accent" />
          <h2 className="text-xs font-semibold text-text-1">Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} title="Close" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-1 px-4 py-2">
          <label className="flex items-center gap-1.5 text-[11px] text-text-3">
            Keymap
            <select value={keymap} onChange={(event) => state.setKeymap(event.target.value as GoStudioKeymapId)} className="h-6 rounded border border-border-1 bg-surface-0 px-1.5 text-[11px] text-text-1">
              {GO_STUDIO_KEYMAPS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <div className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded border border-border-1 bg-surface-0 px-2">
            <Search size={11} className="text-text-4" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by action or shortcut (e.g. ctrl shift f)" aria-label="Search shortcuts" className="min-w-0 flex-1 bg-transparent text-[11px] text-text-1 outline-none placeholder:text-text-4" />
          </div>
          {Object.keys(custom).length > 0 && (
            <button type="button" onClick={() => state.resetAll()} className="flex h-6 items-center gap-1 rounded px-2 text-[11px] text-text-3 hover:bg-surface-3 hover:text-text-1"><RotateCcw size={11} /> Reset all</button>
          )}
        </div>
        {conflictCount > 0 && (
          <p role="status" className="flex shrink-0 items-center gap-1.5 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-[10.5px] text-warning">
            <AlertTriangle size={11} /> {conflicts.size} shortcut{conflicts.size === 1 ? ' is' : 's are'} shared by more than one action: the first available action wins.
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {GO_STUDIO_MENUS.map((menu) => {
            const commands = GO_STUDIO_COMMANDS.filter((command) => command.menu === menu.id && matches(command.id, command.label, commandShortcut(command)))
            if (commands.length === 0) return null
            return (
              <section key={menu.id} className="mb-3">
                <h3 className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">{menu.label}</h3>
                {commands.map((command) => {
                  const binding = effectiveBinding(command, { keymap, custom })
                  const conflict = conflicts.get(bindingSignature(binding))
                  const shortcuts = [commandShortcut(command), ...effectiveAltBindings(command, { keymap, custom }).map((alt) => formatBinding(alt))].filter(Boolean)
                  const rebindable = isRebindable(command)
                  return (
                    <div key={command.id} className="group flex h-7 items-center gap-2 border-b border-border-1/60 text-[11px] text-text-2">
                      <span className="min-w-0 flex-1 truncate">{command.label}</span>
                      {command.id in custom && <span className="rounded bg-accent/15 px-1 text-[9px] text-accent">custom</span>}
                      {conflict && <span title={`Also used by: ${conflict.filter((other) => other.id !== command.id).map((other) => other.label).join(', ')}`} className="text-warning"><AlertTriangle size={11} aria-label="Shortcut conflict" /></span>}
                      {recording === command.id ? (
                        <input data-keymap-recorder autoFocus readOnly value="Press keys… (Esc cancels)" onKeyDown={(event) => onRecordKey(event, command.id)} onBlur={() => setRecording(null)} aria-label={`New shortcut for ${command.label}`} className="h-5 w-40 rounded border border-accent bg-surface-0 px-1.5 text-[10px] text-accent outline-none" />
                      ) : (
                        <button type="button" disabled={!rebindable} onClick={() => setRecording(command.id)} title={rebindable ? 'Click to change the shortcut' : 'Double Shift cannot be changed'} className="rounded border border-border-1 bg-surface-0 px-1.5 font-mono text-[10px] text-text-3 hover:border-accent/60 hover:text-text-1 disabled:hover:border-border-1">
                          {shortcuts.length ? shortcuts.join('  ·  ') : 'Not set'}
                        </button>
                      )}
                      <span className="flex w-10 justify-end gap-0.5 opacity-0 group-hover:opacity-100">
                        {rebindable && binding && <button type="button" onClick={() => state.setBinding(command.id, null)} title="Remove shortcut" className="grid h-5 w-5 place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-danger"><X size={10} /></button>}
                        {command.id in custom && <button type="button" onClick={() => state.resetBinding(command.id)} title="Reset to the keymap" className="grid h-5 w-5 place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-text-1"><RotateCcw size={10} /></button>}
                      </span>
                    </div>
                  )
                })}
              </section>
            )
          })}
          <p className="text-[9px] leading-4 text-text-4">Go Studio shortcuts apply only while this panel is open. Ctrl/Cmd+K still opens the adOmnia command palette. Shortcuts are stored on this machine.</p>
        </div>
      </div>
    </div>
  )
}

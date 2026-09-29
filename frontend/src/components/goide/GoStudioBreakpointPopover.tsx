import { useEffect, useRef, useState } from 'react'
import { ListChecks, Trash2, X } from 'lucide-react'
import { useGoIDEDebugStore } from '@/stores/goideDebug'
import { GoStudioBreakpointFields, canApply } from './GoStudioBreakpointFields'
import { draftFrom, optionsFrom, useGoStudioBreakpointUi, type BreakpointDraft } from './goStudioBreakpoints'

const POPOVER_WIDTH = 340

/** Modifica di un breakpoint dal gutter (tasto destro sul numero di riga), come il popup di GoLand. */
export function GoStudioBreakpointPopover() {
  const target = useGoStudioBreakpointUi((state) => state.popover)
  const existing = useGoIDEDebugStore((state) => (target ? state.breakpoints[target.sessionId]?.[target.relativePath]?.find((item) => item.line === target.line) ?? null : null))
  const [draft, setDraft] = useState<BreakpointDraft>(() => draftFrom(null))
  const ref = useRef<HTMLDivElement>(null)
  const close = () => useGoStudioBreakpointUi.getState().closePopover()

  // Il form riparte dal breakpoint della riga ogni volta che il popover si apre.
  const key = target ? `${target.sessionId}:${target.relativePath}:${target.line}` : ''
  useEffect(() => { if (key) setDraft(draftFrom(existing)) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!target) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    const onPointer = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) close() }
    window.addEventListener('keydown', onKey)
    const timer = window.setTimeout(() => window.addEventListener('mousedown', onPointer), 0)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onPointer); window.clearTimeout(timer) }
  }, [target])

  if (!target) return null
  const debug = useGoIDEDebugStore.getState()
  const apply = () => {
    if (!canApply(draft)) return
    void debug.putBreakpoint(target.sessionId, target.relativePath, { line: target.line, ...optionsFrom(draft) })
    close()
  }
  const remove = () => {
    void debug.updateBreakpoint(target.sessionId, target.relativePath, target.line, null)
    close()
  }
  const left = Math.max(8, Math.min(target.x + 8, window.innerWidth - POPOVER_WIDTH - 8))
  const top = Math.max(8, Math.min(target.y + 8, window.innerHeight - 380))

  return (
    <div ref={ref} role="dialog" aria-label={`Breakpoint at line ${target.line}`} style={{ left, top, width: POPOVER_WIDTH }} className="fixed z-50 overflow-hidden rounded-lg border border-border-2 bg-surface-1 shadow-2xl">
      <div className="flex h-8 items-center gap-2 border-b border-border-1 px-3 text-[10px]">
        <span className="font-semibold text-text-1">{existing ? 'Breakpoint' : 'New breakpoint'}</span>
        <span className="truncate font-mono text-text-4">{target.relativePath}:{target.line}</span>
        <button type="button" onClick={close} title="Close · Esc" aria-label="Close" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={11} /></button>
      </div>
      <div className="p-3">
        <GoStudioBreakpointFields draft={draft} onChange={setDraft} onSubmit={apply} autoFocus />
      </div>
      <div className="flex items-center gap-1 border-t border-border-1 px-2 py-1.5">
        <button type="button" onClick={() => useGoStudioBreakpointUi.getState().setDialogOpen(true)} title="All breakpoints · Ctrl+Shift+F8" className="flex h-7 items-center gap-1.5 rounded px-2 text-[11px] text-text-3 hover:bg-surface-3 hover:text-text-1"><ListChecks size={12} /> All breakpoints</button>
        {existing && <button type="button" onClick={remove} className="flex h-7 items-center gap-1.5 rounded px-2 text-[11px] text-text-3 hover:bg-surface-3 hover:text-danger"><Trash2 size={12} /> Remove</button>}
        <button type="button" onClick={apply} disabled={!canApply(draft)} className="ml-auto h-7 rounded-md bg-accent px-3 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-40">Done</button>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { CircleDot, FunctionSquare, Plus, ShieldAlert, Trash2, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import type { GoIDEBreakpointState, GoIDEFunctionBreakpoint } from '@/lib/goide-debug-api'
import { useGoIDEStore } from '@/stores/goide'
import { breakpointSpec, useGoIDEDebugStore } from '@/stores/goideDebug'
import { GoStudioBreakpointFields, canApply } from './GoStudioBreakpointFields'
import { breakpointSummary, draftFrom, optionsFrom, useGoStudioBreakpointUi, type BreakpointDraft } from './goStudioBreakpoints'

interface GoStudioBreakpointsDialogProps {
  sessionId: string
}

type Selection = { kind: 'line'; relativePath: string; line: number } | { kind: 'function'; name: string } | null

const EMPTY_FILES: Record<string, GoIDEBreakpointState[]> = {}
const ROW = 'group flex h-7 cursor-pointer items-center gap-2 px-3 text-[11px]'

function StatusDot({ verified, disabled, message }: { verified: boolean; disabled?: boolean; message?: string }) {
  const color = disabled ? 'bg-text-4' : verified ? 'bg-danger' : 'border-2 border-danger'
  return <span title={disabled ? 'Disabled' : verified ? 'Verified by Delve' : message || 'Verified when a debug session starts'} className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />
}

/** Tutti i breakpoint del progetto (Ctrl+Shift+F8): riga, funzione e panic, con attivazione e modifica. */
export function GoStudioBreakpointsDialog({ sessionId }: GoStudioBreakpointsDialogProps) {
  const open = useGoStudioBreakpointUi((state) => state.dialogOpen)
  const files = useGoIDEDebugStore((state) => state.breakpoints[sessionId] ?? EMPTY_FILES)
  const functions = useGoIDEDebugStore((state) => state.functionBreakpoints[sessionId])
  const [selection, setSelection] = useState<Selection>(null)
  const [draft, setDraft] = useState<BreakpointDraft>(() => draftFrom(null))
  const [newFunction, setNewFunction] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const close = () => useGoStudioBreakpointUi.getState().setDialogOpen(false)
  useModalFocusTrap(open, close, dialogRef)

  useEffect(() => {
    if (!open) return
    void useGoIDEDebugStore.getState().loadBreakpoints(sessionId)
    void useGoIDEDebugStore.getState().loadFunctionBreakpoints(sessionId)
  }, [open, sessionId])

  if (!open) return null
  const debug = useGoIDEDebugStore.getState()
  const lines = Object.entries(files).sort(([left], [right]) => left.localeCompare(right)).flatMap(([relativePath, states]) => states.map((state) => ({ relativePath, state })))
  const functionList = functions?.functions ?? []
  const settingsWith = (list: GoIDEFunctionBreakpoint[], stopOnPanic = functions?.stopOnPanic ?? false) => ({ functions: list, stopOnPanic })
  const functionSpecs = (): GoIDEFunctionBreakpoint[] => functionList.map(({ name, condition, hitCondition, disabled }) => ({ name, condition, hitCondition, disabled }))

  const selectLine = (relativePath: string, state: GoIDEBreakpointState) => {
    setSelection({ kind: 'line', relativePath, line: state.line })
    setDraft(draftFrom(state))
  }
  const selectFunction = (function_: GoIDEFunctionBreakpoint) => {
    setSelection({ kind: 'function', name: function_.name })
    setDraft(draftFrom(function_))
  }
  const apply = () => {
    if (!selection || !canApply(draft)) return
    const options = optionsFrom(draft)
    if (selection.kind === 'line') void debug.putBreakpoint(sessionId, selection.relativePath, { line: selection.line, ...options })
    else void debug.setFunctionBreakpoints(sessionId, settingsWith(functionSpecs().map((item) => (item.name === selection.name ? { name: item.name, condition: options.condition, hitCondition: options.hitCondition, disabled: options.disabled } : item))))
  }
  const toggleLine = (relativePath: string, state: GoIDEBreakpointState) => void debug.updateBreakpoint(sessionId, relativePath, state.line, { disabled: !state.disabled || undefined })
  const removeLine = (relativePath: string, line: number) => {
    void debug.updateBreakpoint(sessionId, relativePath, line, null)
    if (selection?.kind === 'line' && selection.relativePath === relativePath && selection.line === line) setSelection(null)
  }
  const toggleFunction = (name: string) => void debug.setFunctionBreakpoints(sessionId, settingsWith(functionSpecs().map((item) => (item.name === name ? { ...item, disabled: !item.disabled || undefined } : item))))
  const removeFunction = (name: string) => {
    void debug.setFunctionBreakpoints(sessionId, settingsWith(functionSpecs().filter((item) => item.name !== name)))
    if (selection?.kind === 'function' && selection.name === name) setSelection(null)
  }
  const addFunction = async () => {
    const name = newFunction.trim()
    if (!name || functionList.some((item) => item.name === name)) return
    if (await debug.setFunctionBreakpoints(sessionId, settingsWith([...functionSpecs(), { name }]))) setNewFunction('')
  }
  const reveal = (relativePath: string, line: number) => {
    close()
    void useGoIDEStore.getState().openLocation(relativePath, line, 1)
  }
  const anyEnabled = lines.some(({ state }) => !state.disabled)
  const isSelected = (kind: 'line' | 'function', id: string) => selection !== null && selection.kind === kind && (selection.kind === 'line' ? `${selection.relativePath}:${selection.line}` : selection.name) === id

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] ad-modal-backdrop" onClick={close}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Breakpoints" tabIndex={-1} className="flex max-h-[76vh] w-[min(820px,94vw)] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-1 px-3">
          <CircleDot size={12} className="text-danger" />
          <h2 className="text-xs font-semibold text-text-1">Breakpoints</h2>
          <span className="text-[10px] text-text-4">Right-click a line number to edit · double-click to open</span>
          {lines.length > 0 && <button type="button" onClick={() => void debug.setAllBreakpointsDisabled(sessionId, anyEnabled)} className="ml-auto h-6 rounded px-2 text-[10px] text-text-2 hover:bg-surface-3">{anyEnabled ? 'Disable all' : 'Enable all'}</button>}
          <button type="button" onClick={close} title="Close · Esc" aria-label="Close" className={`${lines.length > 0 ? '' : 'ml-auto '}grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3`}><X size={12} /></button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div role="listbox" aria-label="Breakpoints" className="min-w-0 flex-1 overflow-auto border-r border-border-1 py-1">
            <p className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-text-4">Line breakpoints</p>
            {lines.length === 0 && <p className="px-3 py-1 text-[11px] text-text-4">None. Click a line number in a Go file to add one.</p>}
            {lines.map(({ relativePath, state }) => {
              const id = `${relativePath}:${state.line}`
              return (
                <div key={id} role="option" aria-selected={isSelected('line', id)} tabIndex={0} onClick={() => selectLine(relativePath, state)} onDoubleClick={() => reveal(relativePath, state.line)} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter') reveal(relativePath, state.line); if (event.key === ' ') { event.preventDefault(); selectLine(relativePath, state) } }} className={`${ROW} ${isSelected('line', id) ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-2'}`}>
                  <input type="checkbox" aria-label={`Enable ${id}`} checked={!state.disabled} onClick={(event) => event.stopPropagation()} onChange={() => toggleLine(relativePath, state)} className="accent-accent" />
                  <StatusDot verified={state.verified} disabled={state.disabled} message={state.message} />
                  <span className="shrink-0 font-mono">{id}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-4">{breakpointSummary(breakpointSpec(state))}</span>
                  <button type="button" aria-label={`Remove ${id}`} onClick={(event) => { event.stopPropagation(); removeLine(relativePath, state.line) }} className="grid h-5 w-5 place-items-center rounded text-text-4 opacity-0 hover:text-danger group-hover:opacity-100"><Trash2 size={10} /></button>
                </div>
              )
            })}
            <p className="px-3 pb-1 pt-3 text-[9px] font-semibold uppercase tracking-wider text-text-4">Function breakpoints</p>
            {functionList.map((function_) => (
              <div key={function_.name} role="option" aria-selected={isSelected('function', function_.name)} tabIndex={0} onClick={() => selectFunction(function_)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectFunction(function_) } }} className={`${ROW} ${isSelected('function', function_.name) ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-2'}`}>
                <input type="checkbox" aria-label={`Enable ${function_.name}`} checked={!function_.disabled} onClick={(event) => event.stopPropagation()} onChange={() => toggleFunction(function_.name)} className="accent-accent" />
                <StatusDot verified={function_.verified} disabled={function_.disabled} message={function_.message} />
                <FunctionSquare size={11} className="shrink-0 text-text-4" />
                <span className="shrink-0 font-mono">{function_.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-4">{function_.message && !function_.verified ? function_.message : breakpointSummary(function_)}</span>
                <button type="button" aria-label={`Remove ${function_.name}`} onClick={(event) => { event.stopPropagation(); removeFunction(function_.name) }} className="grid h-5 w-5 place-items-center rounded text-text-4 opacity-0 hover:text-danger group-hover:opacity-100"><Trash2 size={10} /></button>
              </div>
            ))}
            <form className="flex items-center gap-1.5 px-3 py-1.5" onSubmit={(event) => { event.preventDefault(); void addFunction() }}>
              <input value={newFunction} onChange={(event) => setNewFunction(event.target.value)} placeholder="main.handler · (*Server).Serve" spellCheck={false} aria-label="Function name" className="h-7 min-w-0 flex-1 rounded-md border border-border-2 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent" />
              <button type="submit" disabled={!newFunction.trim()} className="flex h-7 items-center gap-1 rounded-md border border-border-2 px-2 text-[11px] text-text-2 hover:border-accent hover:text-text-1 disabled:opacity-40"><Plus size={11} /> Add</button>
            </form>
            <p className="px-3 pb-1 pt-3 text-[9px] font-semibold uppercase tracking-wider text-text-4">Panics</p>
            <label className="flex items-start gap-2 px-3 py-1 text-[11px] text-text-2">
              <input type="checkbox" checked={functions?.stopOnPanic ?? false} onChange={(event) => void debug.setFunctionBreakpoints(sessionId, settingsWith(functionSpecs(), event.target.checked))} className="mt-0.5 accent-accent" />
              <span><span className="flex items-center gap-1.5"><ShieldAlert size={11} className="text-warning" /> Stop on every panic, including recovered ones</span><span className="mt-0.5 block text-[10px] text-text-4">Unrecovered panics always stop the debugger.</span>{functions?.panicMessage && <span className="mt-0.5 block text-[10px] text-danger">{functions.panicMessage}</span>}</span>
            </label>
          </div>
          <div className="w-[300px] shrink-0 overflow-auto p-3">
            {!selection && <p className="text-[11px] text-text-4">Select a breakpoint to set a condition, a hit count or a log message.</p>}
            {selection && (
              <>
                <p className="mb-3 truncate font-mono text-[11px] text-text-1">{selection.kind === 'line' ? `${selection.relativePath}:${selection.line}` : selection.name}</p>
                <GoStudioBreakpointFields draft={draft} onChange={setDraft} onSubmit={apply} allowLog={selection.kind === 'line'} />
                <button type="button" onClick={apply} disabled={!canApply(draft)} className="mt-4 h-7 w-full rounded-md bg-accent text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-40">Apply</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

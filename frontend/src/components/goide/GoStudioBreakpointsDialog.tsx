import { useEffect, useState } from 'react'
import { CircleDot, FunctionSquare, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { GoStudioButton, GoStudioModal } from './GoStudioModal'
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
const ROW = 'group mx-1.5 flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[12.5px]'

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
  const close = () => useGoStudioBreakpointUi.getState().setDialogOpen(false)

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
    <GoStudioModal
      open={open}
      onClose={close}
      size="xl"
      tall
      divided
      flush
      icon={CircleDot}
      tone="danger"
      title="Breakpoints"
      subtitle="Right-click a line number to edit · double-click a breakpoint to open it."
      actions={lines.length > 0 ? <GoStudioButton small variant="ghost" onClick={() => void debug.setAllBreakpointsDisabled(sessionId, anyEnabled)}>{anyEnabled ? 'Disable all' : 'Enable all'}</GoStudioButton> : undefined}
    >
        <div className="flex min-h-0 flex-1">
          <div role="listbox" aria-label="Breakpoints" className="min-w-0 flex-1 overflow-auto border-r border-border-1 py-2">
            <p className="gs-section-title px-4 pb-1.5 pt-2">Line breakpoints</p>
            {lines.length === 0 && <p className="px-4 py-1 text-[12.5px] text-text-4">None yet. Click a line number in a Go file to add one.</p>}
            {lines.map(({ relativePath, state }) => {
              const id = `${relativePath}:${state.line}`
              return (
                <div key={id} role="option" aria-selected={isSelected('line', id)} tabIndex={0} onClick={() => selectLine(relativePath, state)} onDoubleClick={() => reveal(relativePath, state.line)} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter') reveal(relativePath, state.line); if (event.key === ' ') { event.preventDefault(); selectLine(relativePath, state) } }} className={`${ROW} ${isSelected('line', id) ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-2'}`}>
                  <input type="checkbox" aria-label={`Enable ${id}`} checked={!state.disabled} onClick={(event) => event.stopPropagation()} onChange={() => toggleLine(relativePath, state)} className="accent-accent" />
                  <StatusDot verified={state.verified} disabled={state.disabled} message={state.message} />
                  <span className="gs-mono shrink-0">{id}</span>
                  <span className="gs-mono min-w-0 flex-1 truncate text-[11px] text-text-4">{breakpointSummary(breakpointSpec(state))}</span>
                  <button type="button" aria-label={`Remove ${id}`} onClick={(event) => { event.stopPropagation(); removeLine(relativePath, state.line) }} className="gs-btn gs-btn-danger-ghost gs-btn-sm gs-btn-icon opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
                </div>
              )
            })}
            <p className="gs-section-title px-4 pb-1.5 pt-4">Function breakpoints</p>
            {functionList.map((function_) => (
              <div key={function_.name} role="option" aria-selected={isSelected('function', function_.name)} tabIndex={0} onClick={() => selectFunction(function_)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectFunction(function_) } }} className={`${ROW} ${isSelected('function', function_.name) ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-2'}`}>
                <input type="checkbox" aria-label={`Enable ${function_.name}`} checked={!function_.disabled} onClick={(event) => event.stopPropagation()} onChange={() => toggleFunction(function_.name)} className="accent-accent" />
                <StatusDot verified={function_.verified} disabled={function_.disabled} message={function_.message} />
                <FunctionSquare size={11} className="shrink-0 text-text-4" />
                <span className="gs-mono shrink-0">{function_.name}</span>
                <span className="gs-mono min-w-0 flex-1 truncate text-[11px] text-text-4">{function_.message && !function_.verified ? function_.message : breakpointSummary(function_)}</span>
                <button type="button" aria-label={`Remove ${function_.name}`} onClick={(event) => { event.stopPropagation(); removeFunction(function_.name) }} className="gs-btn gs-btn-danger-ghost gs-btn-sm gs-btn-icon opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
              </div>
            ))}
            <form className="flex items-center gap-2 px-4 py-2" onSubmit={(event) => { event.preventDefault(); void addFunction() }}>
              <input value={newFunction} onChange={(event) => setNewFunction(event.target.value)} placeholder="main.handler · (*Server).Serve" spellCheck={false} aria-label="Function name" className="gs-input gs-mono flex-1" />
              <GoStudioButton type="submit" variant="secondary" icon={Plus} disabled={!newFunction.trim()}>Add</GoStudioButton>
            </form>
            <p className="gs-section-title px-4 pb-1.5 pt-4">Panics</p>
            <label className="flex items-start gap-2.5 px-4 py-1 text-[12.5px] text-text-2">
              <input type="checkbox" checked={functions?.stopOnPanic ?? false} onChange={(event) => void debug.setFunctionBreakpoints(sessionId, settingsWith(functionSpecs(), event.target.checked))} className="mt-0.5 accent-accent" />
              <span><span className="flex items-center gap-1.5"><ShieldAlert size={11} className="text-warning" /> Stop on every panic, including recovered ones</span><span className="mt-0.5 block text-[11.5px] text-text-4">Unrecovered panics always stop the debugger.</span>{functions?.panicMessage && <span className="mt-0.5 block text-[10px] text-danger">{functions.panicMessage}</span>}</span>
            </label>
          </div>
          <div className="w-[320px] shrink-0 overflow-auto bg-surface-0/40 p-4">
            {!selection && <p className="gs-hint pt-1">Select a breakpoint to set a condition, a hit count or a log message.</p>}
            {selection && (
              <>
                <p className="gs-mono mb-3 truncate text-[12px] text-text-1">{selection.kind === 'line' ? `${selection.relativePath}:${selection.line}` : selection.name}</p>
                <GoStudioBreakpointFields draft={draft} onChange={setDraft} onSubmit={apply} allowLog={selection.kind === 'line'} />
                <GoStudioButton variant="primary" className="mt-4 w-full" onClick={apply} disabled={!canApply(draft)}>Apply</GoStudioButton>
              </>
            )}
          </div>
        </div>
    </GoStudioModal>
  )
}

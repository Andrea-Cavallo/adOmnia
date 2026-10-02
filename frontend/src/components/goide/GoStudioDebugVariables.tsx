import { Fragment, memo, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, Copy, Cpu, Eye, LoaderCircle, Plus, X } from 'lucide-react'
import { Clipboard as WailsClipboard } from '@wailsio/runtime'
import { evaluateGoIDEDebug, showGoIDEDebugRegisters, type GoIDEDebugVariable } from '@/lib/goide-debug-api'
import { useGoIDEDebugStore, type GoIDEDebugConsoleLine, type GoIDEDebugView, type GoIDEWatchValue } from '@/stores/goideDebug'
import { PaneHeader, valueTone } from './GoStudioDebugUi'
import { goStudioUnwrapCandidates, isNilGoStudioDebugValue } from './goStudioErrorChain'
import { goStudioCollectionExpressions } from './goStudioCollectionInspector'
import { goStudioContextFields } from './goStudioContextInspector'
import { summarizeGoStudioDebugValue } from './goStudioDebugValueInspector'

const EMPTY_WATCHES: string[] = []
const MAX_EVALUATE_HISTORY = 50
const INDENT_PX = 14

interface VariableRowProps {
  debugId: string
  name: string
  value: string
  type?: string
  reference: number
  depth: number
  error?: boolean
  muted?: boolean
  onRemove?: () => void
  expression: string
  onInspect?: (variable: GoIDEDebugVariable, expression: string) => void
}

/** Riga dell'albero variabili: i figli si caricano da Delve solo alla prima espansione. */
const VariableRow = memo(function VariableRow({ debugId, name, value, type, reference, depth, error, muted, onRemove, expression, onInspect }: VariableRowProps) {
  const [expanded, setExpanded] = useState(false)
  const children = useGoIDEDebugStore((state) => (reference > 0 ? state.debuggers[debugId]?.children[reference] : undefined))
  const expandable = reference > 0
  const toggle = () => {
    if (!expandable) return
    if (!expanded) void useGoIDEDebugStore.getState().loadChildren(debugId, reference)
    setExpanded(!expanded)
  }
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Enter' || (event.key === 'ArrowRight' && !expanded) || (event.key === 'ArrowLeft' && expanded)) { event.preventDefault(); toggle() }
  }
  const tone = muted ? 'italic text-text-4' : error ? 'text-danger' : valueTone(value)
  return (
    <>
      <div role="treeitem" aria-expanded={expandable ? expanded : undefined} aria-level={depth + 1} tabIndex={0} onClick={toggle} onKeyDown={onKeyDown}
        className="group flex min-h-7 cursor-default items-center gap-1.5 rounded-md pr-1.5 font-mono text-[12px] outline-none hover:bg-surface-2 focus-visible:bg-accent/10"
        style={{ paddingLeft: 6 + depth * INDENT_PX }} title={type ? `${name} (${type})\n${value}` : value}>
        <span className="grid w-3.5 shrink-0 place-items-center text-text-4">{expandable ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}</span>
        <span className="shrink-0 text-accent-light">{name}</span>
        <span className="shrink-0 text-text-4">=</span>
        <span className={`min-w-0 flex-1 truncate ${tone}`}>{value}</span>
        {type && <span className="hidden max-w-[35%] shrink-0 truncate text-[11px] text-text-4 xl:inline">{type}</span>}
        <button type="button" aria-label={`Copy value of ${name}`} title="Copy value" onClick={(event) => { event.stopPropagation(); void WailsClipboard.SetText(value) }} className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-4 opacity-0 hover:text-text-1 group-hover:opacity-100 focus:opacity-100"><Copy size={11} /></button>
        {onInspect && summarizeGoStudioDebugValue({ type: type ?? '', value }) && <button type="button" aria-label={`Inspect ${name}`} title="Inspect Go runtime value" onClick={(event) => { event.stopPropagation(); onInspect({ name, value, type: type ?? '', variablesReference: reference }, expression) }} className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-4 opacity-0 hover:text-accent group-hover:opacity-100 focus:opacity-100"><Eye size={11} /></button>}
        {onRemove && <button type="button" aria-label={`Remove watch ${name}`} title="Remove watch" onClick={(event) => { event.stopPropagation(); onRemove() }} className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-4 opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100"><X size={11} /></button>}
      </div>
      {expanded && (children ?? []).map((child: GoIDEDebugVariable, index: number) => (
        <VariableRow key={`${child.name}-${index}`} debugId={debugId} name={child.name} value={child.value} type={child.type} reference={child.variablesReference} depth={depth + 1} expression={childExpression(expression, child.name)} onInspect={onInspect} />
      ))}
      {expanded && !children && <div className="py-1 text-[11px] text-text-4" style={{ paddingLeft: 26 + depth * INDENT_PX }}>Loading…</div>}
    </>
  )
})

function childExpression(parent: string, childName: string): string {
  if (/^\[[^\]]+\]$/.test(childName)) return `${parent}${childName}`
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(childName)) return `${parent}.${childName}`
  return parent
}

/** Variabili del frame scelto, watch persistenti per progetto e scope costosi caricati su richiesta. */
/** Sessioni di debug con lo scope Registers attivo: Delve tiene l'impostazione per sessione. */
const registersShown = new Set<string>()

function RegistersToggle({ view }: { view: GoIDEDebugView }) {
  const debugId = view.info.id
  const [shown, setShown] = useState(() => registersShown.has(debugId))
  const [busy, setBusy] = useState(false)
  useEffect(() => setShown(registersShown.has(debugId)), [debugId])
  const toggle = async () => {
    setBusy(true)
    try {
      await showGoIDEDebugRegisters(debugId, !shown)
      if (shown) registersShown.delete(debugId)
      else registersShown.add(debugId)
      setShown(!shown)
      if (view.frameId !== null) await useGoIDEDebugStore.getState().selectFrame(debugId, view.frameId)
    } catch {
      // La sessione può essere terminata nel frattempo: il pulsante resta nello stato precedente.
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={() => void toggle()} disabled={busy || view.info.state !== 'stopped'} aria-pressed={shown} title={shown ? 'Hide CPU registers' : 'Show CPU registers of the selected frame'} className={`go-studio-icon-button h-6 w-6 ${shown ? 'text-accent' : ''}`}>
      <Cpu size={13} aria-hidden="true" />
    </button>
  )
}

export function GoStudioDebugVariables({ view, sessionId }: { view: GoIDEDebugView; sessionId: string }) {
  const watches = useGoIDEDebugStore((state) => state.watches[sessionId] ?? EMPTY_WATCHES)
  const { addWatch, removeWatch, loadChildren } = useGoIDEDebugStore.getState()
  const [draft, setDraft] = useState('')
  const [inspected, setInspected] = useState<{ variable: GoIDEDebugVariable; expression: string } | null>(null)
  const paused = view.info.state === 'stopped'
  const pending: GoIDEWatchValue = { value: paused ? '…' : 'not available while running', reference: 0 }
  return (
    <section aria-label="Variables" className="flex min-h-0 flex-col">
      <PaneHeader title="Variables"><RegistersToggle view={view} /></PaneHeader>
      <form onSubmit={(event) => { event.preventDefault(); addWatch(sessionId, draft); setDraft('') }} className="mx-2 mb-1.5 flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-surface-0 px-2 focus-within:ring-1 focus-within:ring-accent">
        <Plus size={12} className="shrink-0 text-text-4" />
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add watch, e.g. len(items)" aria-label="New watch expression"
          className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-text-1 outline-none" />
      </form>
      <GoStudioDebugValueInspector variable={inspected?.variable ?? null} expression={inspected?.expression ?? ''} debugId={view.info.id} frameId={view.frameId} />
      <div role="tree" aria-label="Variables" className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {watches.length > 0 && <div className="px-2 pb-0.5 pt-1 text-[11px] font-semibold text-text-3">Watches</div>}
        {watches.map((expression) => {
          const watch = view.watchValues[expression] ?? pending
          return <VariableRow key={`watch-${expression}`} debugId={view.info.id} name={expression} value={watch.value} type={watch.type} reference={paused ? watch.reference : 0} depth={0} error={watch.error} muted={watch.outOfScope} onRemove={() => removeWatch(sessionId, expression)} expression={expression} onInspect={(variable, inspectedExpression) => setInspected({ variable, expression: inspectedExpression })} />
        })}
        {!paused && watches.length === 0 && <p className="px-2 py-1 text-[11.5px] text-text-4">Variables appear when the program is paused.</p>}
        {paused && view.loading && view.scopes.length === 0 && <p className="px-2 py-1 text-[11.5px] text-text-4">Reading variables…</p>}
        {paused && view.scopes.map((scope) => {
          const variables = view.children[scope.variablesReference]
          return (
            <div key={scope.variablesReference}>
              <div className="flex items-center gap-2 px-2 pb-0.5 pt-2 text-[11px] font-semibold text-text-3">
                {scope.name}
                {variables && <span className="font-normal text-text-4">{variables.length}</span>}
              </div>
              {(variables ?? []).map((variable, index) => (
                <VariableRow key={`${scope.variablesReference}-${variable.name}-${index}`} debugId={view.info.id} name={variable.name} value={variable.value} type={variable.type} reference={variable.variablesReference} depth={0} expression={variable.name} onInspect={(inspectedVariable, expression) => setInspected({ variable: inspectedVariable, expression })} />
              ))}
              {variables && variables.length === 0 && <p className="px-2 text-[11px] italic text-text-4">No variables in this scope yet: declarations on the paused line are not executed.</p>}
              {!variables && scope.expensive && <button type="button" onClick={() => void loadChildren(view.info.id, scope.variablesReference)} className="mx-2 rounded-md px-2 py-0.5 text-[11px] text-accent hover:bg-accent/10">Load {scope.name.toLowerCase()}</button>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function GoStudioDebugValueInspector({ variable, expression, debugId, frameId }: { variable: GoIDEDebugVariable | null; expression: string; debugId: string; frameId: number | null }) {
  const summary = variable ? summarizeGoStudioDebugValue(variable) : null
  if (!variable || !summary) return null
  const detail = summary.kind === 'interface'
        ? <>Static <b>{variable.type || 'not reported'}</b>{summary.dynamicType ? <> → concrete <b>{summary.dynamicType}</b></> : <> · concrete type not printed by Delve</>}</>
        : summary.kind === 'channel'
          ? <>Queue state from safe builtins; Delve does not expose whether the channel is closed.</>
          : summary.kind === 'slice' || summary.kind === 'map'
            ? <>Reading safe collection metadata…</>
          : summary.kind === 'context'
            ? <>Reading values, deadline and parent context exposed by Delve…</>
            : <GoStudioErrorChainInspector debugId={debugId} frameId={frameId} expression={expression} initial={variable} />
  return (
    <div className="mx-2 mb-1.5 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-2 text-[11px] text-text-2">
      <div className="flex items-center gap-1.5"><Eye size={12} className="text-accent" /><b>{summary.label} inspector</b><span className="min-w-0 truncate font-mono text-text-4">{variable.name}</span></div>
      <div className="mt-1 leading-4">{detail}</div>
      {(summary.kind === 'slice' || summary.kind === 'map' || summary.kind === 'channel') && <GoStudioCollectionInspector kind={summary.kind} debugId={debugId} frameId={frameId} expression={expression} />}
      {summary.kind === 'context' && <GoStudioContextInspector debugId={debugId} variable={variable} />}
      {variable.variablesReference > 0 && <p className="mt-1 text-[10.5px] text-text-4">Use the disclosure arrow on the value to inspect the fields supplied by Delve.</p>}
    </div>
  )
}

function GoStudioContextInspector({ debugId, variable }: { debugId: string; variable: GoIDEDebugVariable }) {
  const reference = variable.variablesReference
  const children = useGoIDEDebugStore((state) => reference > 0 ? state.debuggers[debugId]?.children[reference] : undefined)
  useEffect(() => {
    if (reference > 0 && !children) void useGoIDEDebugStore.getState().loadChildren(debugId, reference)
  }, [children, debugId, reference])
  if (reference <= 0) return <p className="mt-1 text-[10.5px] text-text-4">This adapter did not expose context fields at this stop.</p>
  if (!children) return <p className="mt-1 text-[10.5px] text-text-4">Reading context fields…</p>
  const fields = goStudioContextFields(children)
  if (fields.length === 0) return <p className="mt-1 text-[10.5px] text-text-4">No key/value, deadline, cancellation or parent field was exposed by this adapter.</p>
  return (
    <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 font-mono text-[10.5px]">
      {fields.map((field) => <Fragment key={field.name}><dt className="text-text-4">{field.name}</dt><dd className="min-w-0 truncate text-text-1" title={field.type ? `${field.value} (${field.type})` : field.value}>{field.value}</dd></Fragment>)}
    </dl>
  )
}

function GoStudioCollectionInspector({ kind, debugId, frameId, expression }: { kind: 'slice' | 'map' | 'channel'; debugId: string; frameId: number | null; expression: string }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const checks = goStudioCollectionExpressions(kind, expression)
  useEffect(() => {
    let cancelled = false
    if (frameId === null || !expression) return () => { cancelled = true }
    const requested = goStudioCollectionExpressions(kind, expression)
    setValues({})
    setError(null)
    void Promise.all(requested.map(async (check) => [check.label, (await evaluateGoIDEDebug(debugId, check.expression, frameId, 'watch')).result] as const))
      .then((resolved) => { if (!cancelled) setValues(Object.fromEntries(resolved)) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [kind, debugId, expression, frameId])
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 text-[10.5px]">
      {checks.map((check) => <span key={check.label}>{check.label} <b>{values[check.label] ?? '…'}</b></span>)}
      {error && <span className="text-danger">{error}</span>}
    </div>
  )
}

function GoStudioErrorChainInspector({ debugId, frameId, expression, initial }: { debugId: string; frameId: number | null; expression: string; initial: GoIDEDebugVariable }) {
  const [chain, setChain] = useState<GoIDEDebugVariable[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const resolve = async () => {
    if (loading || frameId === null || !expression) return
    setLoading(true)
    setMessage(null)
    const next = [initial]
    let current = expression
    try {
      for (let depth = 0; depth < 12; depth += 1) {
        let unwrapped: Awaited<ReturnType<typeof evaluateGoIDEDebug>> | null = null
        let lastError: unknown = null
        for (const candidate of goStudioUnwrapCandidates(current)) {
          try {
            unwrapped = await evaluateGoIDEDebug(debugId, candidate, frameId, 'repl')
            current = candidate
            break
          } catch (error) {
            lastError = error
          }
        }
        if (!unwrapped) throw lastError
        if (isNilGoStudioDebugValue(unwrapped.result)) {
          setMessage('End of chain.')
          break
        }
        next.push({ name: `Unwrap #${depth + 1}`, value: unwrapped.result, type: unwrapped.type, variablesReference: unwrapped.variablesReference })
        if (depth === 11) setMessage('Stopped after 12 wrapped errors.')
      }
    } catch (error) {
      setMessage(next.length === 1 ? `No Unwrap() error chain: ${error instanceof Error ? error.message : String(error)}` : 'End of chain.')
    } finally {
      setChain(next)
      setLoading(false)
    }
  }
  return (
    <div>
      <p>Resolve the wrapper chain only on request: <code>fmt.Errorf</code> wrappers are read directly; other error types call <code>Unwrap()</code> in the paused process.</p>
      <button type="button" onClick={() => void resolve()} disabled={loading || frameId === null} className="mt-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-50">
        {loading ? <span className="inline-flex items-center gap-1"><LoaderCircle size={10} className="animate-spin" /> Resolving…</span> : 'Resolve wrapped errors'}
      </button>
      {chain.length > 0 && <ol className="mt-1.5 space-y-0.5 border-l border-accent/30 pl-2 font-mono text-[10.5px]">{chain.map((item, index) => <li key={`${item.value}-${index}`}><span className="text-text-4">{index}.</span> <span className="text-text-1">{item.value}</span>{item.type && <span className="text-text-4"> ({item.type})</span>}</li>)}</ol>}
      {message && <p className="mt-1 text-[10.5px] text-text-4">{message}</p>}
    </div>
  )
}

const LINE_CLASS: Record<GoIDEDebugConsoleLine['category'], string> = {
  stdout: 'text-text-2',
  stderr: 'text-danger',
  console: 'text-text-4',
  input: 'text-accent',
  result: 'text-text-1',
  error: 'text-danger',
}

/** Output del programma e REPL di Delve sul frame scelto, con cronologia. */
export function GoStudioDebugConsole({ view }: { view: GoIDEDebugView }) {
  const [expression, setExpression] = useState('')
  const history = useRef<string[]>([])
  const cursor = useRef(-1)
  const scroller = useRef<HTMLDivElement | null>(null)
  const paused = view.info.state === 'stopped'
  useEffect(() => {
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }, [view.console.length])
  const submit = () => {
    const value = expression.trim()
    if (!value) return
    history.current = [value, ...history.current.filter((item) => item !== value)].slice(0, MAX_EVALUATE_HISTORY)
    cursor.current = -1
    setExpression('')
    void useGoIDEDebugStore.getState().evaluate(view.info.id, value)
  }
  const browseHistory = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const next = Math.max(-1, Math.min(history.current.length - 1, cursor.current + (event.key === 'ArrowUp' ? 1 : -1)))
    cursor.current = next
    setExpression(next < 0 ? '' : history.current[next])
  }
  return (
    <section aria-label="Debug console" className="flex min-h-0 flex-col">
      <PaneHeader title="Console" />
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-3 pb-1 font-mono text-[12px] leading-5">
        {view.console.length === 0 && <p className="font-sans text-[11.5px] text-text-4">Program output and evaluation results appear here.</p>}
        {view.console.map((line) => (
          <div key={line.id} className={`whitespace-pre-wrap break-all ${LINE_CLASS[line.category]}`}>{line.category === 'input' ? `› ${line.text}` : line.text}</div>
        ))}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); submit() }} className="mx-2 mb-2 flex h-8 shrink-0 items-center gap-2 rounded-lg bg-surface-0 px-2.5 focus-within:ring-1 focus-within:ring-accent">
        <span className="font-mono text-[12px] text-accent">›</span>
        <input value={expression} onChange={(event) => setExpression(event.target.value)} onKeyDown={browseHistory} disabled={!paused}
          placeholder={paused ? 'Evaluate in the selected frame, e.g. len(items)' : 'Pause the program to evaluate'} aria-label="Evaluate expression"
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-text-1 outline-none disabled:opacity-50" />
      </form>
    </section>
  )
}

import { memo, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, Copy, Plus, X } from 'lucide-react'
import { Clipboard as WailsClipboard } from '@wailsio/runtime'
import type { GoIDEDebugVariable } from '@/lib/goide-debug-api'
import { useGoIDEDebugStore, type GoIDEDebugConsoleLine, type GoIDEDebugView, type GoIDEWatchValue } from '@/stores/goideDebug'
import { PaneHeader, valueTone } from './GoStudioDebugUi'

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
}

/** Riga dell'albero variabili: i figli si caricano da Delve solo alla prima espansione. */
const VariableRow = memo(function VariableRow({ debugId, name, value, type, reference, depth, error, muted, onRemove }: VariableRowProps) {
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
        {onRemove && <button type="button" aria-label={`Remove watch ${name}`} title="Remove watch" onClick={(event) => { event.stopPropagation(); onRemove() }} className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-4 opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100"><X size={11} /></button>}
      </div>
      {expanded && (children ?? []).map((child: GoIDEDebugVariable, index: number) => (
        <VariableRow key={`${child.name}-${index}`} debugId={debugId} name={child.name} value={child.value} type={child.type} reference={child.variablesReference} depth={depth + 1} />
      ))}
      {expanded && !children && <div className="py-1 text-[11px] text-text-4" style={{ paddingLeft: 26 + depth * INDENT_PX }}>Loading…</div>}
    </>
  )
})

/** Variabili del frame scelto, watch persistenti per progetto e scope costosi caricati su richiesta. */
export function GoStudioDebugVariables({ view, sessionId }: { view: GoIDEDebugView; sessionId: string }) {
  const watches = useGoIDEDebugStore((state) => state.watches[sessionId] ?? EMPTY_WATCHES)
  const { addWatch, removeWatch, loadChildren } = useGoIDEDebugStore.getState()
  const [draft, setDraft] = useState('')
  const paused = view.info.state === 'stopped'
  const pending: GoIDEWatchValue = { value: paused ? '…' : 'not available while running', reference: 0 }
  return (
    <section aria-label="Variables" className="flex min-h-0 flex-col">
      <PaneHeader title="Variables" />
      <form onSubmit={(event) => { event.preventDefault(); addWatch(sessionId, draft); setDraft('') }} className="mx-2 mb-1.5 flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-surface-0 px-2 focus-within:ring-1 focus-within:ring-accent">
        <Plus size={12} className="shrink-0 text-text-4" />
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add watch, e.g. len(items)" aria-label="New watch expression"
          className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-text-1 outline-none" />
      </form>
      <div role="tree" aria-label="Variables" className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {watches.length > 0 && <div className="px-2 pb-0.5 pt-1 text-[11px] font-semibold text-text-3">Watches</div>}
        {watches.map((expression) => {
          const watch = view.watchValues[expression] ?? pending
          return <VariableRow key={`watch-${expression}`} debugId={view.info.id} name={expression} value={watch.value} type={watch.type} reference={paused ? watch.reference : 0} depth={0} error={watch.error} muted={watch.outOfScope} onRemove={() => removeWatch(sessionId, expression)} />
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
                <VariableRow key={`${scope.variablesReference}-${variable.name}-${index}`} debugId={view.info.id} name={variable.name} value={variable.value} type={variable.type} reference={variable.variablesReference} depth={0} />
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

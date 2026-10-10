import { useMemo, useState } from 'react'
import type { GoIDEDebugView } from '@/stores/goideDebug'
import { useGoIDEDebugStore } from '@/stores/goideDebug'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { goroutinesForLine, waitsForLine, isErrorLine } from '@/lib/goide/lineDebugContext'
import { staticConcurrencyDiagnostics } from './goStudioLifecycleInspector'
import { GoStudioErrorChainInspector } from './GoStudioDebugVariables'

export function GoStudioLineDebugContext({ file, line, source, view }: { file: string; line: number; source: string; view: GoIDEDebugView | null }) {
  const [values, setValues] = useState(false)
  const paused = view?.info.state === 'stopped' ? view : null
  const goroutines = paused?.goroutines?.goroutines ?? []
  const related = goroutinesForLine(goroutines, file, line)
  const waits = waitsForLine(goroutines, file, line)
  const staticFindings = useMemo(() => staticConcurrencyDiagnostics(source, file).filter(item => item.line === line), [source, file, line])
  const frame = paused?.frames.find(item => item.id === paused.frameId)
  const sameFrame = frame?.relativePath === file && frame.line === line
  const variables = sameFrame ? paused!.scopes.flatMap(scope => paused!.children[scope.variablesReference] ?? []) : []
  const errors = variables.filter(item => /(^error$|\berror\b|Error\b)/.test(item.type ?? '') || /^err\w*$/i.test(item.name))
  const errorLine = isErrorLine(source.split('\n')[line - 1] ?? '')
  if (!related.length && !staticFindings.length && !errorLine && !sameFrame) return null
  return <section className="space-y-2 border-b border-border-1 px-3 py-2 text-[11px]">
    {(related.length > 0 || staticFindings.length > 0) && <>
      <h3 className="font-semibold text-text-2">Concurrency on this line</h3>
      {related.map(g => <button key={g.id} type="button" className="block text-left text-accent" onClick={() => { useGoIDELspStore.getState().showToolWindow('debug'); if(paused)void useGoIDEDebugStore.getState().selectThread(paused.info.id,g.id) }}>Goroutine {g.id} · {g.state}</button>)}
      {waits.map(wait => <p key={wait.key} className="text-text-3">{wait.state} · {wait.target || 'resource not reported'} · {wait.goroutines.length} waiting at {wait.relativePath}:{wait.line}</p>)}
      {staticFindings.map(item => <p key={item.id} title={item.detail} className="text-warning">STATIC · {item.title}</p>)}
    </>}
    {errorLine && <>
      <h3 className="font-semibold text-text-2">Error / panic context</h3>
      {paused?.info.stopReason && <p className="text-warning">Paused: {paused.info.stopReason}</p>}
      {paused && errors.map(error => <div key={error.name} className="space-y-1"><p className="break-all font-mono text-text-2">{error.name} = {error.value}</p><GoStudioErrorChainInspector key={`${paused.info.id}:${paused.frameId}:${error.name}:${error.value}`} debugId={paused.info.id} frameId={paused.frameId} expression={error.name} initial={error}/></div>)}
      {!errors.length && <p className="text-text-4">Pause on this line to inspect its error values and wrapper chain.</p>}
      <button type="button" className="text-accent" onClick={()=>useGoIDELspStore.getState().showToolWindow('errors')}>Inspect error handling in source ↗</button>
    </>}
    {sameFrame && <><button type="button" aria-expanded={values} className="text-accent" onClick={()=>setValues(!values)}>{values?'Hide':'Show'} runtime values ({variables.length})</button>
      {values && variables.slice(0,50).map(variable=><p key={variable.name} title={variable.type} className="break-all font-mono text-text-2">{variable.name} = {variable.value}</p>)}
    </>}
  </section>
}

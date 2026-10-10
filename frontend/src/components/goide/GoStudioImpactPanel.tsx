import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { Crosshair, Loader2, MessageSquare, Play, RefreshCw } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { caretFor } from '@/lib/goide/goStudioCaretMemory'
import { graphImpactAt, graphImpactOf, impactContext, workspaceGraphSummary, type GraphImpact, type GraphRef, type WorkspaceGraphSummary } from '@/lib/goide/workspaceGraph'
import { activeGoIDEDocument, useGoIDEStore } from '@/stores/goide'
import { isChatPane, useGoStudioAssistantStore } from '@/stores/goStudioAssistant'
import { runGoStudioNamedTests } from './goStudioQuickActions'

/** Bumped by the "Analyze Change Impact" command: the panel re-analyzes the code under the cursor. */
const useImpactRequest = create<{ nonce: number }>(() => ({ nonce: 0 }))
export const requestImpactAtCursor = () => useImpactRequest.setState((state) => ({ nonce: state.nonce + 1 }))

const RISK_STYLE: Record<string, string> = {
  low: 'border-success/40 text-success',
  medium: 'border-warning/40 text-warning',
  high: 'border-danger/40 text-danger',
}

const errorText = (problem: unknown) => (problem instanceof Error ? problem.message : String(problem))

function RefList({ title, refs, onFocus, empty }: { title: string; refs: readonly GraphRef[] | null | undefined; onFocus?: (ref: GraphRef) => void; empty?: string }) {
  if (!refs?.length && !empty) return null
  return (
    <section className="min-w-0">
      <h3 className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">{title}<span className="font-normal normal-case text-text-4">{refs?.length ?? 0}</span></h3>
      {!refs?.length ? <p className="text-[11.5px] text-text-4">{empty}</p> : (
        <ul className="flex flex-col">
          {refs.slice(0, 60).map((ref) => (
            <li key={ref.node.id} className="group flex min-w-0 items-center gap-2 rounded px-1 py-0.5 hover:bg-surface-2">
              <button type="button" disabled={!ref.node.file} onClick={() => ref.node.file && void useGoIDEStore.getState().openLocation(ref.node.file, ref.node.line || 1)} title={ref.via?.length ? `via ${ref.via.join(' → ')}` : ref.node.file || undefined} className="min-w-0 flex-1 truncate text-left font-mono text-[11.5px] text-text-2 hover:text-text-1 disabled:cursor-default">
                {ref.node.label}
              </button>
              {ref.depth > 1 && <span className="shrink-0 text-[10px] text-text-4">{ref.depth} hops</span>}
              {onFocus && <button type="button" onClick={() => onFocus(ref)} className="shrink-0 text-[10px] text-text-4 opacity-0 hover:text-text-1 group-hover:opacity-100 focus:opacity-100">impact</button>}
            </li>
          ))}
          {refs.length > 60 && <li className="px-1 text-[10.5px] text-text-4">… {refs.length - 60} more</li>}
        </ul>
      )}
    </section>
  )
}

/** Change Impact Analysis: what a change to the function under the cursor can break, from the Semantic Workspace Graph. */
export function GoStudioImpactPanel({ session }: { session: GoIDESession }) {
  const nonce = useImpactRequest((state) => state.nonce)
  const [impact, setImpact] = useState<GraphImpact | null>(null)
  const [summary, setSummary] = useState<WorkspaceGraphSummary | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const authorized = session.project.authorization === 'tooling-permitted'

  const run = async (task: () => Promise<GraphImpact>) => {
    setRunning(true)
    setError(null)
    try {
      setImpact(await task())
      setSummary(await workspaceGraphSummary(session.id))
    } catch (problem) { setError(errorText(problem)) } finally { setRunning(false) }
  }

  const analyzeAtCursor = () => {
    const document = activeGoIDEDocument(useGoIDEStore.getState())
    if (!document || document.document.sessionId !== session.id || !document.document.relativePath.endsWith('.go')) {
      setError('Open a Go file and place the cursor inside a function.')
      return
    }
    const path = document.document.relativePath
    void run(() => graphImpactAt(session.id, path, caretFor(session.id, path)?.line ?? 1))
  }

  const rebuild = async () => {
    setRunning(true)
    setError(null)
    try {
      setSummary(await workspaceGraphSummary(session.id, true))
      if (impact) setImpact(await graphImpactOf(session.id, impact.target.id))
    } catch (problem) { setError(errorText(problem)) } finally { setRunning(false) }
  }

  useEffect(() => { if (authorized) analyzeAtCursor() }, [nonce, session.id, authorized])

  const focus = (ref: GraphRef) => void run(() => graphImpactOf(session.id, ref.node.id))

  const askAI = () => {
    if (!impact) return
    const assistant = useGoStudioAssistantStore.getState()
    const draft = `I want to change ${impact.target.label}. Using the workspace graph below, tell me what could break, what to test first and how to make the change safely.\n\n${impactContext(impact)}`
    assistant.openWithDraft(isChatPane(assistant.pane) ? assistant.pane : 'claude', draft)
    useGoIDEStore.getState().updateLayout({ structureOpen: true })
  }

  const tests = (impact?.tests ?? []).filter((ref) => ref.node.file && ref.node.package)
  const runTests = () => void runGoStudioNamedTests(session.id, tests.map((ref) => ({ file: ref.node.file ?? '', packagePath: ref.node.package ?? '', name: ref.node.attrs?.name ?? ref.node.label.split('.').pop() ?? '' })))

  if (!authorized) return <p className="p-3 text-[12px] text-text-3">Trust this project (Go → Trust Project Tools) to build its workspace graph: it loads the packages with the Go toolchain.</p>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-border-1 px-3 py-1.5">
        {impact ? (
          <>
            <button type="button" onClick={() => impact.target.file && void useGoIDEStore.getState().openLocation(impact.target.file, impact.target.line || 1)} className="truncate font-mono text-[12px] font-semibold text-text-1 hover:underline">{impact.target.label}</button>
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${RISK_STYLE[impact.risk] ?? ''}`} title={(impact.riskReasons ?? []).join('\n')}>{impact.risk} risk</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-text-3">{(impact.riskReasons ?? []).join(' · ')}</span>
          </>
        ) : <span className="flex-1 text-[11.5px] text-text-3">{running ? 'Building the workspace graph…' : 'Place the cursor in a function and analyze.'}</span>}
        {running && <Loader2 size={13} className="animate-spin text-text-3" />}
        <button type="button" onClick={analyzeAtCursor} disabled={running} className="gs-btn gs-btn-secondary gs-btn-sm"><Crosshair size={12} />At cursor</button>
        <button type="button" onClick={runTests} disabled={running || tests.length === 0} className="gs-btn gs-btn-secondary gs-btn-sm" title={tests.length ? 'Run the tests that reach this code' : 'No test reaches this code'}><Play size={12} />Run {tests.length} test{tests.length === 1 ? '' : 's'}</button>
        <button type="button" onClick={askAI} disabled={!impact} className="gs-btn gs-btn-secondary gs-btn-sm" title="Open the chat with this impact as context"><MessageSquare size={12} />Ask AI</button>
        <button type="button" onClick={() => void rebuild()} disabled={running} className="go-studio-icon-button h-7 w-7" title="Rebuild the workspace graph" aria-label="Rebuild the workspace graph"><RefreshCw size={13} /></button>
      </header>
      {error && <div role="alert" className="border-b border-border-1 px-3 py-1.5 text-[11.5px] text-danger">{error}</div>}
      {impact && (
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-4 overflow-auto p-3">
          <RefList title="Callers" refs={impact.callers} onFocus={focus} empty="Nothing in the project calls it." />
          <RefList title="Tests" refs={impact.tests} empty="No test reaches this code." />
          <RefList title="HTTP routes" refs={impact.endpoints} />
          <RefList title="gRPC services" refs={impact.rpcs} />
          <RefList title="Consumed topics" refs={impact.consumers} />
          <RefList title="Interface contracts" refs={impact.interfaces} onFocus={focus} />
          <RefList title="Entry points" refs={impact.entries} />
          <RefList title="Calls" refs={impact.callees} onFocus={focus} />
          <RefList title="Produces to" refs={impact.produces} />
          <RefList title="Queries" refs={impact.queries} />
          {!!impact.modules?.length && <section><h3 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">Modules · packages</h3><p className="font-mono text-[11px] text-text-3">{impact.modules.join(', ')}</p><p className="mt-1 font-mono text-[11px] text-text-4">{(impact.packages ?? []).length} packages</p></section>}
        </div>
      )}
      {summary && (
        <footer className="shrink-0 border-t border-border-1 px-3 py-1 text-[10.5px] text-text-4">
          Workspace graph · {Object.entries(summary.stats ?? {}).sort().map(([kind, count]) => `${count} ${kind}`).join(' · ')} · {summary.edges} relations · {summary.cached ? 'from cache' : 'rebuilt'} {new Date(summary.builtAt).toLocaleTimeString()}
          {summary.truncated && ' · truncated (very large project)'}
          {!!summary.problems?.length && ` · ${summary.problems.length} load problem${summary.problems.length === 1 ? '' : 's'}`}
        </footer>
      )}
    </div>
  )
}

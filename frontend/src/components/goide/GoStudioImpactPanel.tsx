import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { Crosshair, Loader2, MessageSquare, Play, RefreshCw } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { caretFor } from '@/lib/goide/goStudioCaretMemory'
import { graphImpactAt, graphImpactOf, impactContext, workspaceGraphSummary, type GraphImpact, type GraphRef, type WorkspaceGraphSummary } from '@/lib/goide/workspaceGraph'
import type { DevEntity } from '@/lib/devcontext-api'
import { activeGoIDEDocument, useGoIDEStore } from '@/stores/goide'
import { isChatPane, useGoStudioAssistantStore } from '@/stores/goStudioAssistant'
import { runGoStudioNamedTests } from './goStudioQuickActions'
import { GoStudioImpactMap } from './GoStudioImpactMap'
import { GoStudioRiskMap } from './GoStudioRiskMap'
import { GoStudioDependencyWhy } from './GoStudioDependencyWhy'
import { getServerPort } from '@/lib/useServerPort'
import { getOtlpLens } from '@/lib/otlp-api'
import { runtimeByNode, runtimeText, type NodeRuntime } from '@/lib/goide/runtimeLens'

/** Bumped by the "Analyze Change Impact" command: the panel re-analyzes the code under the cursor. */
const useImpactRequest = create<{ nonce: number; nodeId: string | null }>(() => ({ nonce: 0, nodeId: null }))
export const requestImpactAtCursor = () => useImpactRequest.setState((state) => ({ nonce: state.nonce + 1, nodeId: null }))
/** From Search Everywhere: the impact of a graph node (route, topic, env var, dependency…). */
export const requestImpactOf = (nodeId: string) => useImpactRequest.setState((state) => ({ nonce: state.nonce + 1, nodeId }))

/** Runtime correlation: what the received OpenTelemetry spans say about the nodes of the impact. */
const useImpactRuntime = create<{ byNode: Map<string, NodeRuntime> }>(() => ({ byNode: new Map() }))

function RuntimeChip({ runtime }: { runtime: NodeRuntime }) {
  return <span title="Observed at runtime (OpenTelemetry spans received by adOmnia)" className={`shrink-0 rounded px-1 font-mono text-[9.5px] ${runtime.errors ? 'bg-danger/12 text-danger' : 'bg-accent/10 text-accent'}`}>{runtimeText(runtime)}</span>
}

async function loadImpactRuntime(impact: GraphImpact, root: string): Promise<void> {
  const port = await getServerPort()
  const stats = port ? await getOtlpLens(port).catch(() => []) : []
  const lists = [impact.callers, impact.tests, impact.endpoints, impact.rpcs, impact.consumers, impact.entries, impact.callees, impact.produces, impact.queries, impact.containers, impact.interfaces]
  const nodes = [impact.target, ...lists.flatMap((list) => (list ?? []).map((ref) => ref.node))]
  useImpactRuntime.setState({ byNode: runtimeByNode(stats ?? [], root, nodes.map((node) => ({ id: node.id, kind: node.kind, label: node.label, file: node.file, line: node.line }))) })
}

/** "POST /orders" (or "/orders") → the route entity the API Workspace actions understand. */
function routeEntity(ref: GraphRef): DevEntity {
  const [first, second] = ref.node.label.split(' ')
  const method = second ? first : 'ANY'
  const path = second ?? first
  return { id: ref.node.id, kind: 'route', label: ref.node.label, attrs: { method, path, declFile: ref.node.file ?? '', declLine: String(ref.node.line ?? 0) }, sources: [], confidence: 'certain' }
}

async function sendImpactRoute(sessionId: string, ref: GraphRef, action: 'open' | 'send'): Promise<void> {
  const { runHandlerAction } = await import('@/lib/devsession/codeToApi')
  await runHandlerAction(sessionId, routeEntity(ref), action)
}

/** Suggested integration calls: every impacted route as a linked request, in one collection. */
async function openImpactRoutes(sessionId: string, refs: readonly GraphRef[]): Promise<void> {
  const [{ serviceApiCollection }, { serviceNameFor }, { routeToModule }] = await Promise.all([import('@/lib/devsession/workspaceFlow'), import('@/lib/devsession-api'), import('@/lib/moduleRouting')])
  const service = await serviceNameFor(sessionId).catch(() => 'service')
  const collection = serviceApiCollection(service || 'service', refs.map(routeEntity))
  routeToModule('collections', { kind: 'import-collections', collections: [{ ...collection, name: `Impact: ${collection.name}` }] }, { reveal: true })
}

/** Suggested services to run: the main package of an entry point, or a compose service. */
function runImpactEntry(ref: GraphRef): void {
  const file = ref.node.file ?? ''
  const directory = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.'
  void useGoIDEStore.getState().startRun('run', { target: directory === '.' ? '.' : `./${directory}` })
}

function runImpactService(ref: GraphRef): void {
  if (!ref.node.file) return
  void useGoIDEStore.getState().startRun('docker-compose', { target: ref.node.file, programArguments: ['up', ref.node.label] })
}

const RISK_STYLE: Record<string, string> = {
  low: 'border-success/40 text-success',
  medium: 'border-warning/40 text-warning',
  high: 'border-danger/40 text-danger',
}

const errorText = (problem: unknown) => (problem instanceof Error ? problem.message : String(problem))

interface RefAction { label: string; title: string; run: (ref: GraphRef) => void }

function RefList({ title, refs, onFocus, empty, action, headerAction }: { title: string; refs: readonly GraphRef[] | null | undefined; onFocus?: (ref: GraphRef) => void; empty?: string; action?: RefAction; headerAction?: { label: string; title: string; run: () => void } }) {
  const runtime = useImpactRuntime((state) => state.byNode)
  if (!refs?.length && !empty) return null
  return (
    <section className="min-w-0">
      <h3 className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">{title}<span className="font-normal normal-case text-text-4">{refs?.length ?? 0}</span>
        {headerAction && !!refs?.length && <button type="button" onClick={headerAction.run} title={headerAction.title} className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-accent hover:bg-accent/10">{headerAction.label}</button>}
      </h3>
      {!refs?.length ? <p className="text-[11.5px] text-text-4">{empty}</p> : (
        <ul className="flex flex-col">
          {refs.slice(0, 60).map((ref) => (
            <li key={ref.node.id} className="group flex min-w-0 items-center gap-2 rounded px-1 py-0.5 hover:bg-surface-2">
              <button type="button" disabled={!ref.node.file} onClick={() => ref.node.file && void useGoIDEStore.getState().openLocation(ref.node.file, ref.node.line || 1)} title={ref.via?.length ? `via ${ref.via.join(' → ')}` : ref.node.file || undefined} className="min-w-0 flex-1 truncate text-left font-mono text-[11.5px] text-text-2 hover:text-text-1 disabled:cursor-default">
                {ref.node.label}
              </button>
              {runtime.has(ref.node.id) && <RuntimeChip runtime={runtime.get(ref.node.id)!} />}
              {ref.depth > 1 && <span className="shrink-0 text-[10px] text-text-4">{ref.depth} hops</span>}
              {action && <button type="button" onClick={() => action.run(ref)} title={action.title} className="shrink-0 rounded px-1 text-[10px] font-medium text-accent hover:bg-accent/10">{action.label}</button>}
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
  const [view, setView] = useState<'list' | 'map' | 'risk'>('list')
  const [impact, setImpact] = useState<GraphImpact | null>(null)
  const targetRuntime = useImpactRuntime((state) => (impact ? state.byNode.get(impact.target.id) : undefined))
  useEffect(() => { if (impact) void loadImpactRuntime(impact, session.project.rootPath) }, [impact, session.project.rootPath])
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
    if (!document || document.document.sessionId !== session.id || !/(\.go|(^|\/)go\.mod)$/.test(document.document.relativePath)) {
      setError('Open a Go file and place the cursor inside a function, or go.mod on a require line.')
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

  useEffect(() => {
    if (!authorized) return
    const nodeId = useImpactRequest.getState().nodeId
    if (nodeId) void run(() => graphImpactOf(session.id, nodeId))
    else analyzeAtCursor()
  }, [nonce, session.id, authorized])

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
            {targetRuntime && <RuntimeChip runtime={targetRuntime} />}
            <span className="min-w-0 flex-1 truncate text-[11px] text-text-3">{(impact.riskReasons ?? []).join(' · ')}</span>
          </>
        ) : <span className="flex-1 text-[11.5px] text-text-3">{running ? 'Building the workspace graph…' : 'Place the cursor in a function and analyze.'}</span>}
        {running && <Loader2 size={13} className="animate-spin text-text-3" />}
        <div role="tablist" aria-label="Impact view" className="flex rounded-md border border-border-1 p-0.5">
          {(['list', 'map', 'risk'] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={view === value} onClick={() => setView(value)} className={`h-6 rounded px-2 text-[11px] capitalize ${view === value ? 'bg-surface-3 font-semibold text-text-1' : 'text-text-3 hover:text-text-1'}`}>{value}</button>
          ))}
        </div>
        <button type="button" onClick={analyzeAtCursor} disabled={running} className="gs-btn gs-btn-secondary gs-btn-sm"><Crosshair size={12} />At cursor</button>
        <button type="button" onClick={runTests} disabled={running || tests.length === 0} className="gs-btn gs-btn-secondary gs-btn-sm" title={tests.length ? 'Run the tests that reach this code' : 'No test reaches this code'}><Play size={12} />Run {tests.length} test{tests.length === 1 ? '' : 's'}</button>
        <button type="button" onClick={askAI} disabled={!impact} className="gs-btn gs-btn-secondary gs-btn-sm" title="Open the chat with this impact as context"><MessageSquare size={12} />Ask AI</button>
        <button type="button" onClick={() => void rebuild()} disabled={running} className="go-studio-icon-button h-7 w-7" title="Rebuild the workspace graph" aria-label="Rebuild the workspace graph"><RefreshCw size={13} /></button>
      </header>
      {error && <div role="alert" className="border-b border-border-1 px-3 py-1.5 text-[11.5px] text-danger">{error}</div>}
      {view === 'risk' && <GoStudioRiskMap sessionId={session.id} onFocus={(ref) => { setView('list'); focus(ref) }} />}
      {impact && view === 'map' && <GoStudioImpactMap impact={impact} onFocus={focus} />}
      {impact && view === 'list' && (
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-4 overflow-auto p-3">
          {impact.target.kind === 'dependency' && <GoStudioDependencyWhy sessionId={session.id} module={impact.target.label} version={impact.target.attrs?.version} packages={impact.packages ?? []} />}
          <RefList title="Callers" refs={impact.callers} onFocus={focus} empty="Nothing in the project calls it." />
          <RefList title="Tests" refs={impact.tests} empty="No test reaches this code." />
          <RefList title="Used by other modules" refs={impact.contracts} onFocus={focus} />
          <RefList title="HTTP routes" refs={impact.endpoints} action={{ label: 'Send', title: 'Open the request for this route in the API Workspace (linked to the running service) and send it', run: (ref) => void sendImpactRoute(session.id, ref, 'send') }} headerAction={{ label: 'Open all in API', title: 'Open a request for every impacted route in the API Workspace', run: () => void openImpactRoutes(session.id, impact.endpoints ?? []) }} />
          {!!impact.containers?.length && <RefList title="Contained in" refs={impact.containers} onFocus={focus} />}
          <RefList title="gRPC services" refs={impact.rpcs} />
          <RefList title="Consumed topics" refs={impact.consumers} />
          <RefList title="Interface contracts" refs={impact.interfaces} onFocus={focus} />
          <RefList title="Entry points" refs={impact.entries} action={{ label: 'Run', title: 'Run this main package', run: runImpactEntry }} />
          <RefList title="Compose services" refs={impact.services} action={{ label: 'Up', title: 'docker compose up this service', run: runImpactService }} />
          <RefList title="Calls" refs={impact.callees} onFocus={focus} />
          <RefList title="Produces to" refs={impact.produces} />
          <RefList title="Queries" refs={impact.queries} />
          <RefList title="Reads env / config" refs={impact.reads} onFocus={focus} />
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

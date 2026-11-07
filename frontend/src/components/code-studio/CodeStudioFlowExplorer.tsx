import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowLeftRight, ArrowUp, CircleDot, FileCode2, Info,
  Loader2, RefreshCw, Search, Workflow, Activity,
} from 'lucide-react'
import { CodeStudioModal } from './CodeStudioModal'
import {
  explainFlow, getFlowImpact, getFlowOverview, getFlowRuntimeEvidence, traceFlow,
} from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import type {
  Explanation as FlowExplanation, FlowEntry, Impact as FlowImpact, Overview as FlowOverview, RuntimeEvidence as FlowRuntimeEvidence, Step as FlowStep, Trace as FlowTrace,
} from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/flowintel/models'

let openRequest: ((sessionId: string) => void) | null = null

/** Apre il Flow Explorer del progetto: flow/subflow, percorso di esecuzione, impatto. */
export function openFlowExplorer(sessionId: string): void {
  openRequest?.(sessionId)
}

const messageOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

type Tab = 'trace' | 'impact' | 'evidence'
type Direction = 'downstream' | 'upstream' | 'both'

const KIND_STYLE: Record<string, string> = {
  flow: 'text-accent',
  subflow: 'text-info',
  method: 'text-text-1',
  type: 'text-text-2',
  bundle: 'text-warning',
  activator: 'text-warning',
  'extension-point': 'text-info',
  service: 'text-success',
  external: 'text-danger',
  endpoint: 'text-success',
}

const CONFIDENCE_STYLE: Record<string, string> = {
  declared: 'text-success',
  derived: 'text-text-2',
  inferred: 'text-warning',
  observed: 'text-accent',
}

function KindDot({ kind }: Readonly<{ kind: string }>) {
  return <CircleDot size={9} className={`shrink-0 ${KIND_STYLE[kind] ?? 'text-text-3'}`} />
}

function ConfidenceBadge({ confidence }: Readonly<{ confidence?: string }>) {
  const value = confidence || 'derived'
  return <span className={`shrink-0 text-[9.5px] uppercase tracking-wide ${CONFIDENCE_STYLE[value] ?? 'text-text-3'}`} title={`${value}: how the link is known`}>{value}</span>
}

function sourceLocation(file?: string, line?: number): string {
  if (!file) return ''
  return line ? `${file}:${line}` : file
}

function FlowRow({ flow, selected, active, onSelect }: Readonly<{ flow: FlowEntry; selected: boolean; active?: boolean; onSelect: () => void }>) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`block w-full border-b border-border-1 px-2.5 py-1.5 text-left hover:bg-surface-3 ${selected ? 'bg-surface-3' : ''}`}
    >
      <div className="flex items-baseline gap-1.5">
        <KindDot kind={flow.kind} />
        {active && <CircleDot size={9} className="shrink-0 text-success" aria-label="Active in the running framework" />}
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-text-1">{flow.label}</span>
        {flow.bundle && <span className="shrink-0 rounded bg-surface-3 px-1 text-[9.5px] text-text-3" title={`Bundle ${flow.bundle}`}>{flow.bundle}</span>}
      </div>
      {(flow.file || flow.method) && (
        <p className="truncate pl-3 text-[10px] text-text-4" title={flow.method || flow.file}>
          {flow.method || sourceLocation(flow.file, flow.line)}
        </p>
      )}
    </button>
  )
}

/** Raggruppa i passi per livello e poi per bundle: è il "grafo per livelli" senza canvas. */
function traceLevels(trace: FlowTrace): Array<{ depth: number; bundles: Array<{ bundle: string; steps: FlowStep[] }> }> {
  const byDepth = new Map<number, Map<string, FlowStep[]>>()
  for (const step of trace.steps ?? []) {
    const depth = step.depth ?? 0
    const bundle = step.node?.attrs?.bundle || 'workspace'
    if (!byDepth.has(depth)) byDepth.set(depth, new Map())
    const bundles = byDepth.get(depth)!
    if (!bundles.has(bundle)) bundles.set(bundle, [])
    bundles.get(bundle)!.push(step)
  }
  return [...byDepth.entries()].sort((left, right) => left[0] - right[0]).map(([depth, bundles]) => ({
    depth,
    bundles: [...bundles.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([bundle, steps]) => ({ bundle, steps })),
  }))
}

function TraceView({ trace, depth, direction, activeBundles, onOpen }: Readonly<{ trace: FlowTrace | null; depth: number; direction: Direction; activeBundles: Set<string>; onOpen: (file: string, line: number) => void }>) {
  if (!trace) return <p className="px-3 py-3 text-[11px] text-text-3">Select a flow to see its execution path.</p>
  const levels = traceLevels(trace)
  const total = trace.steps?.length ?? 0
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-border-1 px-3 py-1.5 text-[10.5px] text-text-3">
        <span className="font-mono text-text-2">{trace.root.label}</span>
        <span> · {direction} · depth {depth} · {total} step(s){trace.truncated ? ' · truncated' : ''}</span>
      </div>
      {levels.map((level) => (
        <section key={level.depth} className="border-b border-border-1/60">
          <h4 className="sticky top-0 z-10 bg-surface-1 px-3 py-1 text-[10px] uppercase tracking-wide text-text-4">Level {level.depth}</h4>
          {level.bundles.map((group) => (
            <div key={`${level.depth}:${group.bundle}`} className="px-3 pb-1">
              <p className="pt-1 text-[10px] text-warning" title="OSGi bundle containing these steps">{group.bundle}{activeBundles.has(group.bundle) && <span className="ml-1 text-success">● active</span>}</p>
              {group.steps.map((step) => (
                <div key={`${step.edge?.from}:${step.edge?.to}:${step.edge?.kind}`} className="flex items-baseline gap-1.5 border-b border-border-1/40 py-0.5">
                  <KindDot kind={step.node?.kind} />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-text-1 hover:text-accent"
                    title={sourceLocation(step.node?.file, step.node?.line)}
                    onClick={() => { if (step.node?.file) onOpen(step.node.file, step.node.line || 1) }}
                  >
                    {step.node?.label}
                  </button>
                  <span className="shrink-0 text-[10px] text-text-3">{step.edge?.kind}</span>
                  <ConfidenceBadge confidence={step.edge?.confidence} />
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
      {levels.length === 0 && <p className="px-3 py-3 text-[11px] text-text-3">No outgoing or incoming path from this node within the depth.</p>}
    </div>
  )
}

function ImpactView({ impact, onOpen }: Readonly<{ impact: FlowImpact | null; onOpen: (file: string, line: number) => void }>) {
  if (!impact) return <p className="px-3 py-3 text-[11px] text-text-3">Select a flow to see what a change can break.</p>
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[11px]">
      <p className="text-text-2">
        {impact.direct?.length ?? 0} direct caller(s), {impact.transitive?.length ?? 0} transitive.
      </p>
      {(impact.direct?.length ?? 0) > 0 && (
        <>
          <h4 className="pt-2 text-[10px] uppercase tracking-wide text-text-4">Direct callers</h4>
          {impact.direct.map((step) => (
            <div key={`${step.edge?.from}:${step.edge?.to}`} className="flex items-baseline gap-1.5 border-b border-border-1/50 py-0.5">
              <KindDot kind={step.node?.kind} />
              <button type="button" className="min-w-0 flex-1 truncate text-left font-mono text-text-1 hover:text-accent" onClick={() => { if (step.node?.file) onOpen(step.node.file, step.node.line || 1) }}>{step.node?.label}</button>
              <span className="text-[10px] text-text-3">{step.edge?.kind}</span>
              <ConfidenceBadge confidence={step.edge?.confidence} />
            </div>
          ))}
        </>
      )}
      {(impact.flows?.length ?? 0) > 0 && (
        <>
          <h4 className="pt-2 text-[10px] uppercase tracking-wide text-text-4">Flows that can break</h4>
          {impact.flows.map((flow) => <p key={flow.id} className="truncate font-mono text-[10.5px] text-accent">{flow.label}</p>)}
        </>
      )}
      {(impact.bundles?.length ?? 0) > 0 && <p className="pt-2 text-text-2"><span className="text-text-4">Bundles:</span> {impact.bundles.join(', ')}</p>}
      {(impact.services?.length ?? 0) > 0 && <p className="pt-1 text-text-2"><span className="text-text-4">Services:</span> {impact.services.join(', ')}</p>}
      {(impact.externals?.length ?? 0) > 0 && (
        <>
          <h4 className="pt-2 text-[10px] uppercase tracking-wide text-text-4">External systems</h4>
          {impact.externals.map((external) => <p key={external.id} className="text-[10.5px] text-danger">{external.label} <span className="text-text-4">{external.attrs?.type}</span></p>)}
        </>
      )}
      {impact.truncated && <p className="pt-2 text-[10px] text-warning">Truncated at the node bound: narrow the depth.</p>}
    </div>
  )
}

function EvidenceView({ explanation, onOpen }: Readonly<{ explanation: FlowExplanation | null; onOpen: (file: string, line: number) => void }>) {
  if (!explanation) return <p className="px-3 py-3 text-[11px] text-text-3">Select a flow to see why it is in the graph.</p>
  const node = explanation.node
  const edges = [...(explanation.incoming ?? []), ...(explanation.outgoing ?? [])]
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[11px]">
      <div className="flex items-baseline gap-1.5">
        <KindDot kind={node?.kind} />
        <span className="min-w-0 flex-1 truncate font-mono text-text-1">{node?.label}</span>
        {node?.file && <button type="button" className="shrink-0 text-[10px] text-accent hover:underline" onClick={() => onOpen(node.file!, node.line || 1)}><FileCode2 size={11} className="inline" /> {sourceLocation(node.file, node.line)}</button>}
      </div>
      {edges.length > 0 ? (
        <div className="pt-2">
          {explanation.incoming?.map((edge) => (
            <p key={`in:${edge.edge?.from}:${edge.edge?.to}:${edge.edge?.kind}`} className="border-b border-border-1/50 py-0.5 text-text-2">
              <span className="text-text-4">in: </span>{edge.why}
            </p>
          ))}
          {explanation.outgoing?.map((edge) => (
            <p key={`out:${edge.edge?.from}:${edge.edge?.to}:${edge.edge?.kind}`} className="border-b border-border-1/50 py-0.5 text-text-2">
              <span className="text-text-4">out: </span>{edge.why}
            </p>
          ))}
        </div>
      ) : <p className="pt-2 text-text-3">No relation recorded: the node is isolated or the adapter could not resolve it.</p>}
      {(explanation.source?.lines?.length ?? 0) > 0 && (
        <pre className="mt-2 overflow-auto rounded bg-surface-2 p-2 font-mono text-[10.5px] leading-relaxed text-text-2">{explanation.source?.lines?.join('\n')}</pre>
      )}
      {(explanation.notes?.length ?? 0) > 0 && explanation.notes.map((note) => <p key={note} className="pt-1 text-[10px] text-warning">{note}</p>)}
    </div>
  )
}

/** Flow Explorer: flow/subflow, percorso di esecuzione per livelli e bundle, impatto, evidenze. */
export function CodeStudioFlowExplorer() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [overview, setOverview] = useState<FlowOverview | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [trace, setTrace] = useState<FlowTrace | null>(null)
  const [impact, setImpact] = useState<FlowImpact | null>(null)
  const [explanation, setExplanation] = useState<FlowExplanation | null>(null)
  const [query, setQuery] = useState('')
  const [bundle, setBundle] = useState('')
  const [kind, setKind] = useState('')
  const [tab, setTab] = useState<Tab>('trace')
  const [direction, setDirection] = useState<Direction>('downstream')
  const [depth, setDepth] = useState(4)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [runtime, setRuntime] = useState<FlowRuntimeEvidence | null>(null)
  const detailEpoch = useRef(0)
  const activeBundles = useMemo(() => new Set(runtime?.activeBundles ?? []), [runtime])

  const openLocation = (file: string, line: number): void => {
    void useCodeStudioStore.getState().openLocation(file, line || 1, 1)
  }

  const load = (id: string, refresh = false): void => {
    setBusy(true)
    setError('')
    getFlowOverview(id, refresh)
      .then((next) => { setOverview(next); setSelected((current) => current ?? next?.flows?.[0]?.id ?? null) })
      .catch((reason: unknown) => setError(messageOf(reason)))
      .finally(() => setBusy(false))
  }

  useEffect(() => {
    openRequest = (next) => {
      setSessionId(next)
      setOverview(null)
      setSelected(null)
      setTrace(null)
      setImpact(null)
      setExplanation(null)
      setQuery('')
      setBundle('')
      setKind('')
      setTab('trace')
      setRuntime(null)
      load(next)
    }
    return () => { openRequest = null }
  }, [])

  useEffect(() => {
    if (!sessionId || !selected) { setTrace(null); setImpact(null); setExplanation(null); return }
    let current = true
    const epoch = ++detailEpoch.current
    setTrace(null)
    Promise.all([
      traceFlow(sessionId, selected, direction, depth),
      getFlowImpact(sessionId, selected, 6),
      explainFlow(sessionId, selected),
    ])
      .then(([nextTrace, nextImpact, nextExplanation]) => {
        if (!current || epoch !== detailEpoch.current) return
        setTrace(nextTrace)
        setImpact(nextImpact)
        setExplanation(nextExplanation)
      })
      .catch((reason: unknown) => { if (current) setError(messageOf(reason)) })
    return () => { current = false }
  }, [sessionId, selected, direction, depth])

  /** Correla il runtime Equinox già avviato con il grafo dei flow. */
  const correlate = (): void => {
    if (!sessionId) return
    setError('')
    getFlowRuntimeEvidence(sessionId)
      .then((next) => setRuntime(next))
      .catch((reason: unknown) => setError(messageOf(reason)))
  }

  const flows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (overview?.flows ?? []).filter((flow) => {
      if (bundle && flow.bundle !== bundle) return false
      if (kind && flow.kind !== kind) return false
      if (!needle) return true
      return `${flow.label} ${flow.id} ${flow.bundle ?? ''}`.toLowerCase().includes(needle)
    })
  }, [overview, query, bundle, kind])

  const bundles = overview?.bundles ?? []
  const subtitle = overview ? `${overview.flows?.length ?? 0} flow/subflow · ${overview.nodes} nodes · ${overview.edges} edges` : ''
  const adapterLabel = (overview?.adapters ?? []).join(' · ')

  return (
    <CodeStudioModal open={!!sessionId} onClose={() => setSessionId(null)} title="Flow Explorer" subtitle={adapterLabel || subtitle} icon={Workflow} size="xl" tall divided flush top>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-1 px-3 py-2">
          <Search size={14} className="text-text-3" />
          <input data-autofocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search flows, subflows, methods or bundles…" className="gs-input min-w-[12rem] flex-1" />
          <select value={bundle} onChange={(event) => setBundle(event.target.value)} className="gs-input w-40" aria-label="Filter by bundle">
            <option value="">All bundles</option>
            {bundles.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select value={kind} onChange={(event) => setKind(event.target.value)} className="gs-input w-32" aria-label="Filter by kind">
            <option value="">All kinds</option>
            <option value="flow">Flow</option>
            <option value="subflow">Subflow</option>
          </select>
          <button type="button" className="gs-btn gs-btn-icon shrink-0" disabled={busy || !sessionId} onClick={() => { if (sessionId) load(sessionId, true) }} title="Re-index the sources" aria-label="Refresh flow index">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
          <button type="button" className="gs-btn shrink-0" disabled={!sessionId} onClick={correlate} title="Correlate with the running Equinox framework (start it from the OSGi Control Center)"><Activity size={13} /> Runtime</button>
        </div>
        {runtime && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border-1 bg-surface-2 px-3 py-1.5 text-[10.5px] text-text-3">
            <CircleDot size={9} className="text-success" />
            <span><span className="text-success">{runtime.activeBundles.length}</span> active bundle(s) · <span className="text-success">{runtime.services.length}</span> service(s) · {runtime.observedEdges} observed edge(s)</span>
            {(runtime.unmatched?.length ?? 0) > 0 && <span className="text-warning">{runtime.unmatched?.length} active bundle(s) are only in the target</span>}
            <span className="text-text-4">bundle/service state is observed; method-level paths keep their static confidence (no instrumentation)</span>
          </div>
        )}
        {error && <p className="whitespace-pre-wrap px-3 py-2 text-[11px] text-danger">{error}</p>}
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
          <div className="min-h-0 overflow-auto border-r border-border-1">
            <p className="px-2.5 pt-2 text-[10px] uppercase tracking-wide text-text-4">{flows.length} entr{flows.length === 1 ? 'y' : 'ies'}</p>
            {flows.slice(0, 400).map((flow) => (
              <FlowRow key={flow.id} flow={flow} selected={selected === flow.id} active={flow.bundle ? activeBundles.has(flow.bundle) : false} onSelect={() => setSelected(flow.id)} />
            ))}
            {flows.length === 0 && !busy && (
              <div className="px-3 py-3 text-[11px] text-text-3">
                <p>No flow found.</p>
                <p className="pt-1 text-[10.5px] text-text-4">
                  Declare them in <span className="font-mono">.adomnia/flows.json</span>, use XML elements <span className="font-mono">&lt;flow id&gt;</span> / <span className="font-mono">&lt;subflow ref&gt;</span>, or annotate Java methods with <span className="font-mono">@Flow</span> / <span className="font-mono">@Subflow</span>.
                </p>
              </div>
            )}
            {flows.length > 400 && <p className="px-3 py-2 text-[10px] text-text-3">{flows.length - 400} more: refine the search.</p>}
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="flex items-center gap-1 border-b border-border-1 px-2">
              {([['trace', 'Execution path'], ['impact', 'Impact'], ['evidence', 'Evidence']] as Array<[Tab, string]>).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setTab(key)} className={`border-b-2 px-2 py-1.5 text-[11px] ${tab === key ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-2'}`}>{label}</button>
              ))}
              <span className="flex-1" />
              {tab === 'trace' && (
                <>
                  <div className="gs-segmented" aria-label="Trace direction">
                    {([['downstream', 'Down', ArrowDown], ['upstream', 'Up', ArrowUp], ['both', 'Both', ArrowLeftRight]] as Array<[Direction, string, typeof ArrowDown]>).map(([value, label, Icon]) => (
                      <button key={value} type="button" className={direction === value ? 'is-active' : ''} onClick={() => setDirection(value)} title={`Trace ${value}`}><Icon size={10} /> {label}</button>
                    ))}
                  </div>
                  <select value={depth} onChange={(event) => setDepth(Number(event.target.value))} className="gs-input h-6 w-16 text-[10px]" aria-label="Depth">
                    {[1, 2, 3, 4, 5, 6, 8].map((value) => <option key={value} value={value}>depth {value}</option>)}
                  </select>
                </>
              )}
            </div>
            {busy && !overview && <p className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" /> Indexing the workspace…</p>}
            {tab === 'trace' && <TraceView trace={trace} depth={depth} direction={direction} activeBundles={activeBundles} onOpen={openLocation} />}
            {tab === 'impact' && <ImpactView impact={impact} onOpen={openLocation} />}
            {tab === 'evidence' && <EvidenceView explanation={explanation} onOpen={openLocation} />}
          </div>
        </div>
        {overview && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border-1 px-3 py-1.5 text-[10px] text-text-4">
            {Object.entries(overview.counts ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([nodeKind, count]) => (
              <span key={nodeKind} className="flex items-center gap-1"><KindDot kind={nodeKind} /> {nodeKind} {count}</span>
            ))}
            <span className="flex items-center gap-1"><Info size={10} /> Confidence: <span className="text-success">declared</span> · <span className="text-text-2">derived</span> · <span className="text-warning">inferred</span></span>
            {(overview.problems?.length ?? 0) > 0 && <span className="flex items-center gap-1 text-warning"><AlertTriangle size={10} /> {overview.problems?.length} problem(s)</span>}
          </div>
        )}
      </div>
    </CodeStudioModal>
  )
}

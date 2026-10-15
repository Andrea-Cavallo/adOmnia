import { useMemo, useState } from 'react'
import { ArrowUpRight, Bug, Loader2, Play, Search } from 'lucide-react'
import { type GoIDEArchitecture, type GoIDEArchitectureResult, type GoIDESession } from '@/lib/goide-api'
import { openEntity } from '@/lib/entities/router'
import { showModule } from '@/lib/moduleRouting'
import { architectureFor, cachedArchitecture } from '@/lib/goide/architectureCache'
import { callNeighbourhood, entityRefsForEntry, groupEntries, kafkaTopics, moduleGraph, packageView, DEFAULT_PACKAGE_VIEW, searchFunctions, shortPackage, type ArchGraph, type ArchNode } from './goStudioArchitecture'
import { GoStudioGraphView } from './GoStudioGraphView'
import { GoStudioArchitectureRules } from './GoStudioArchitectureRules'
import { GoStudioDependencyHeatmap } from './GoStudioDependencyHeatmap'
import { GoStudioApiContract } from './GoStudioApiContract'
import { GoStudioBinaryInspector } from './GoStudioBinaryInspector'
import { GoStudioMemoryModel } from './GoStudioMemoryModel'
import { GoStudioGoroutinesView } from './GoStudioGoroutinesView'
import { GoStudioInterfaceExplorer, SiteLink, openArchSite } from './GoStudioInterfaceExplorer'
import { GoStudioDataAccessView } from './GoStudioDataAccessView'
import { layoutLayered, type LayeredNode } from './goStudioLayeredGraph'

export type ArchitectureTab = 'packages' | 'calls' | 'interfaces' | 'services' | 'data' | 'modules' | 'rules' | 'heatmap' | 'contract' | 'binary' | 'memory' | 'goroutines'

const NODE_COLOR: Record<ArchNode['kind'], string> = {
  package: 'var(--color-accent)',
  group: 'var(--color-warning)',
  std: 'var(--color-text-4)',
  external: 'var(--color-info)',
  function: 'var(--color-info)',
  interface: 'var(--color-accent)',
  implementation: 'var(--color-success)',
  consumer: 'var(--color-info)',
  module: 'var(--color-warning)',
}



function errorText(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem)
}

function Graph({ graph, label, selected, onSelect }: { graph: ArchGraph; label: string; selected: string | null; onSelect: (node: LayeredNode<ArchNode>) => void }) {
  const layout = useMemo(() => layoutLayered(graph.nodes, graph.links), [graph])
  if (!layout.nodes.length) return <p className="p-3 text-text-4">Nothing to draw.</p>
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <GoStudioGraphView layout={layout} label={label} selected={selected}
        look={(node) => ({ title: node.data.title, subtitle: node.data.subtitle, tooltip: node.data.tooltip, color: NODE_COLOR[node.data.kind] })}
        edgeTitle={(from, to, value) => `${from.data.title} → ${to.data.title}${value > 1 ? ` (${value})` : ''}`}
        onSelect={onSelect} onOpen={(node) => openArchSite(node.data.site)} />
      {graph.hidden > 0 && <p className="px-1 pt-1 text-[10px] text-text-4">{graph.hidden} more not shown: select a node to focus on its neighbours.</p>}
    </div>
  )
}

/** Architecture Explorer: grafi di package, chiamate e moduli, interfacce, entry point e servizi. */
export function GoStudioArchitecturePanel({ session, initialTab = 'packages' }: { session: GoIDESession; initialTab?: ArchitectureTab }) {
  const sessionId = session.id
  const authorized = session.project.authorization === 'tooling-permitted'
  const [result, setResult] = useState<GoIDEArchitectureResult | null>(() => cachedArchitecture(session.id))
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<ArchitectureTab>(initialTab)
  const [query, setQuery] = useState('')
  const report = result?.report ?? null

  const analyze = async () => {
    setRunning(true)
    setError(null)
    try {
      setResult(await architectureFor(sessionId, true))
    } catch (problem) { setError(errorText(problem)) } finally { setRunning(false) }
  }

  const tabs: Array<[ArchitectureTab, string]> = [
    ['packages', `Packages${report ? ` (${report.packages.length})` : ''}`],
    ['calls', 'Call graph'],
    ['interfaces', `Interfaces${report ? ` (${report.interfaces.length})` : ''}`],
    ['services', `Entry points & services${report ? ` (${report.entries.length})` : ''}`],
    ['goroutines', `Goroutines${report ? ` (${report.goroutines.length})` : ''}`],
    ['data', `Data access${report ? ` (${report.queries.length})` : ''}`],
    ['modules', `Modules${report ? ` (${report.modules.length})` : ''}`],
    ['heatmap', 'Heatmap'],
    ['contract', 'Contracts'],
    ['binary', 'Binary'],
    ['memory', 'Memory model'],
    ['rules', 'Rules & drift'],
  ]
  return (
    <div className="flex h-full min-h-0 flex-col text-[11px]">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border-1 px-2 py-1">
        <button type="button" disabled={!authorized || running} onClick={() => void analyze()} title={authorized ? 'Load every module with go/packages and build the architecture model' : 'Trust the project to run go list'} className="flex h-6 items-center gap-1 rounded bg-accent px-2 font-semibold text-white hover:opacity-90 disabled:opacity-40">
          {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} aria-hidden="true" />} {report ? 'Analyze again' : 'Analyze'}
        </button>
        {result && <span className="text-text-4">{result.modules} module{result.modules === 1 ? '' : 's'} · {report?.functions.length} functions · {report?.calls.length} calls{report?.truncated ? ' (truncated)' : ''}</span>}
        {result && result.problems.length > 0 && <span className="text-warning" title={result.problems.join('\n')}>{result.problems.length} load problem{result.problems.length === 1 ? '' : 's'}</span>}
        <label className="ml-auto flex h-6 items-center gap-1 rounded border border-border-1 bg-surface-2 px-1.5">
          <Search size={10} className="text-text-4" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'calls' ? 'Find a function' : 'Filter'} aria-label="Filter architecture" className="w-36 bg-transparent text-text-1 outline-none placeholder:text-text-4" />
        </label>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border-1 px-2" role="tablist">
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`border-b-2 px-2 py-1 ${tab === id ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-1'}`}>{label}</button>)}
      </div>
      {error && <div className="shrink-0 border-b border-danger/30 bg-danger/10 px-2 py-1 text-danger">{error}</div>}
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'memory' ? (authorized ? <GoStudioMemoryModel sessionId={sessionId} /> : <p className="p-3 text-text-4">Trust the project to analyze it.</p>)
          : tab === 'binary' ? (authorized ? <GoStudioBinaryInspector sessionId={sessionId} targets={mainTargets(report)} /> : <p className="p-3 text-text-4">Trust the project to build it.</p>)
          : tab === 'contract' ? (authorized ? <GoStudioApiContract sessionId={sessionId} /> : <p className="p-3 text-text-4">Trust the project to compare its API with the contract.</p>)
          : tab === 'heatmap' ? (authorized ? <GoStudioDependencyHeatmap sessionId={sessionId} query={query} /> : <p className="p-3 text-text-4">Trust the project to measure its packages.</p>)
          : tab === 'rules' ? (authorized ? <GoStudioArchitectureRules sessionId={sessionId} /> : <p className="p-3 text-text-4">Trust the project to check its architecture rules.</p>)
          : !report ? <p className="p-3 text-text-4">{running ? 'Loading packages and types…' : 'Analyze builds the package, import, call and module graphs, lists interfaces with their implementations and users, and finds entry points, HTTP routes, gRPC services, Kafka producers and consumers, DB repositories, scheduled jobs and CLI commands. Nothing runs.'}</p>
          : tab === 'packages' ? <PackagesView report={report} query={query} />
            : tab === 'calls' ? <CallsView report={report} query={query} />
              : tab === 'interfaces' ? <GoStudioInterfaceExplorer report={report} query={query} />
                : tab === 'services' ? <ServicesView report={report} query={query} sessionId={sessionId} />
                  : tab === 'goroutines' ? <GoStudioGoroutinesView report={report} query={query} />
                  : tab === 'data' ? <GoStudioDataAccessView report={report} query={query} />
                  : <ModulesView report={report} />}
      </div>
    </div>
  )
}

/** Folders of the main packages, from the entry points of the last analysis ("." first). */
function mainTargets(report: GoIDEArchitecture | null): string[] {
  const folders = (report?.entries ?? []).filter((entry) => entry.kind === 'main' && entry.site.relativePath).map((entry) => {
    const path = entry.site.relativePath
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.'
    return dir === '.' ? '.' : `./${dir}`
  })
  return [...new Set(folders.length ? folders : ['.'])].sort()
}

function Toggle({ label, on, onChange, title }: { label: string; on: boolean; onChange: (value: boolean) => void; title: string }) {
  return (
    <button type="button" aria-pressed={on} title={title} onClick={() => onChange(!on)} className={`rounded px-1.5 py-0.5 ${on ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-surface-3'}`}>{label}</button>
  )
}

function PackagesView({ report, query }: { report: GoIDEArchitecture; query: string }) {
  const [options, setOptions] = useState(DEFAULT_PACKAGE_VIEW)
  const needle = query.trim().toLowerCase()
  const match = needle ? report.packages.find((pkg) => pkg.path.toLowerCase().includes(needle))?.path ?? null : null
  const center = options.focus ?? match
  const view = useMemo(() => packageView(report, { ...options, focus: center }), [center, options, report])
  const selected = report.packages.find((pkg) => pkg.path === center)
  const set = (patch: Partial<typeof options>) => setOptions((current) => ({ ...current, ...patch }))
  const onSelect = (node: LayeredNode<ArchNode>) => {
    if (node.data.kind === 'group') set({ expanded: new Set([...options.expanded, node.id.slice('group:'.length)]) })
    else if (node.data.kind === 'package') set({ focus: node.id === options.focus ? null : node.id })
  }
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-2 py-1 text-text-3">
        {(['imports', 'calls'] as const).map((value) => <button key={value} type="button" onClick={() => set({ mode: value })} className={`rounded px-1.5 py-0.5 ${options.mode === value ? 'bg-accent/15 text-accent' : 'hover:bg-surface-3'}`}>{value === 'imports' ? 'Import graph' : 'Calls between packages'}</button>)}
        <span className="mx-0.5 h-3 w-px bg-border-1" aria-hidden="true" />
        <Toggle label="Reduce" on={options.reduce} onChange={(reduce) => set({ reduce })} title="Hide an edge when the same dependency is already reachable through another package" />
        <Toggle label="Group" on={options.group} onChange={(group) => set({ group, expanded: new Set() })} title="Collapse packages that share a top-level folder; click a group to expand it" />
        <Toggle label="Cycles" on={options.cyclesOnly} onChange={(cyclesOnly) => set({ cyclesOnly })} title="Show only packages that import each other in a loop" />
        <Toggle label="Std" on={options.std} onChange={(std) => set({ std })} title="Show standard library imports" />
        <Toggle label="External" on={options.external} onChange={(external) => set({ external })} title="Show external module imports" />
        {center && (
          <>
            <label className="flex items-center gap-1" title="How many import hops around the focused package to draw">
              Depth
              <select value={options.depth} onChange={(event) => set({ depth: Number(event.target.value) })} className="rounded border border-border-1 bg-surface-2 px-1 py-0.5 text-text-2">
                {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => set({ focus: null })} className="text-accent hover:underline">Show all</button>
          </>
        )}
        <span className="ml-auto tabular-nums text-text-4">{view.shown} of {view.total} packages{view.reduced > 0 ? ` · ${view.reduced} edges reduced` : ''}{view.cycles > 0 ? ` · ${view.cycles} in cycles` : ''}</span>
      </div>
      {selected && <p className="shrink-0 truncate px-2 pb-1 text-text-3">Focus: <SiteLink site={selected.site} label={shortPackage(selected.path, selected.module)} />{selected.external.length > 0 && <span className="text-text-4"> · external: {selected.external.join(', ')}</span>}</p>}
      <Graph graph={view} label="Package graph" selected={center} onSelect={onSelect} />
    </>
  )
}

function CallsView({ report, query }: { report: GoIDEArchitecture; query: string }) {
  const matches = useMemo(() => searchFunctions(report, query), [query, report])
  const [chosen, setChosen] = useState<string | null>(null)
  const center = chosen ?? matches[0]?.id ?? null
  const graph = useMemo(() => center ? callNeighbourhood(report, center) : null, [center, report])
  return (
    <div className="flex min-h-0 flex-1">
      <ul className="w-64 shrink-0 overflow-auto border-r border-border-1 py-1">
        {!query.trim() && <li className="px-2 text-text-4">Type a function name in the filter to see its callers (above) and callees (below).</li>}
        {matches.map((fn) => (
          <li key={fn.id}><button type="button" onClick={() => setChosen(fn.id)} title={fn.id} className={`flex w-full gap-2 px-2 py-0.5 text-left ${center === fn.id ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-3'}`}><span className="min-w-0 flex-1 truncate font-mono">{fn.name}</span><span className="shrink-0 text-[10px] text-text-4">{shortPackage(fn.package)}</span></button></li>
        ))}
      </ul>
      {graph ? <Graph graph={graph} label="Call graph" selected={center} onSelect={(node) => setChosen(node.id)} /> : <p className="p-3 text-text-4">No function selected.</p>}
    </div>
  )
}

const TOPIC_ROLE_STYLE: Record<string, string> = { 'dead-letter': 'bg-error/10 text-error', retry: 'bg-warning/10 text-warning' }
const TOPIC_ROLE_LABEL: Record<string, string> = { 'dead-letter': 'DLQ', retry: 'retry' }

function TopicRole({ role }: { role?: string }) {
  if (!role) return null
  return <span className={`shrink-0 rounded px-1 text-[10px] font-semibold ${TOPIC_ROLE_STYLE[role] ?? ''}`} title={role === 'dead-letter' ? 'Dead-letter topic (recognized by its name)' : 'Retry topic (recognized by its name)'}>{TOPIC_ROLE_LABEL[role] ?? role}</span>
}

/** Breakpoint dove il messaggio è in mano (consumer: dopo la lettura; producer: sull'invio) e avvio sotto Delve. */
function KafkaDebugButton({ entry, sessionId, onStatus }: { entry: GoIDEArchitecture['entries'][number]; sessionId: string; onStatus: (text: string) => void }) {
  const [busy, setBusy] = useState(false)
  const consumer = entry.kind === 'kafka-consumer'
  return (
    <button
      type="button"
      disabled={busy}
      title={consumer ? 'Breakpoint after the message is read, then Debug: replay a message from Broker Studio to stop here' : 'Breakpoint on the send, then Debug'}
      onClick={async () => {
        setBusy(true)
        try {
          const { debugGoAt, kafkaBreakSite } = await import('@/lib/devsession/debugMessage')
          const site = kafkaBreakSite(entry)
          onStatus(`Breakpoint at ${site.relativePath}:${site.line} · starting Delve…`)
          await debugGoAt({ goSessionId: sessionId, ...site })
          onStatus(consumer ? `Debugging ${entry.name}: send or replay a message on ${(entry.topics ?? []).join(', ')} to stop at ${site.relativePath}:${site.line}.` : `Debugging ${entry.name}: it stops at ${site.relativePath}:${site.line} when it sends.`)
        } catch (error) {
          onStatus(`Debug failed: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy(false)
        }
      }}
      className="flex items-center gap-0.5 rounded px-1 text-[10px] text-accent hover:bg-accent/10 disabled:opacity-50"
    >
      <Bug size={10} aria-hidden="true" /> {busy ? 'Starting…' : 'Debug'}
    </button>
  )
}

/** Topic → funzioni che lo producono e lo consumano, con i consumer group. */
function KafkaTopicsSection({ entries, query, sessionId }: { entries: GoIDEArchitecture['entries']; query: string; sessionId: string }) {
  const topics = useMemo(() => kafkaTopics(entries, query), [entries, query])
  const [status, setStatus] = useState('')
  if (!topics.length) return null
  return (
    <section className="mb-2">
      <h4 className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-4">Kafka topics ({topics.length})</h4>
      {status && <p className={`px-2 pb-1 text-[11px] ${status.startsWith('Debug failed') ? 'text-error' : 'text-text-2'}`}>{status}</p>}
      {topics.map((use) => (
        <div key={use.topic} className="border-b border-border-1 px-2 py-1 last:border-b-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-text-1">{use.topic}</span>
            <TopicRole role={use.role} />
            {use.groups.map((group) => <span key={group} className="shrink-0 rounded bg-accent/10 px-1 text-[10px] text-accent" title="Consumer group">group {group}</span>)}
            <button type="button" onClick={() => void openEntity({ sessionId, kind: 'topic', id: `topic:${use.topic}`, label: use.topic, attrs: { broker: 'kafka' } })} title="Open in Broker Studio" className="ml-auto flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-accent hover:bg-accent/10">Broker Studio <ArrowUpRight size={10} aria-hidden="true" /></button>
          </div>
          {([['produced by', use.producers], ['consumed by', use.consumers]] as const).map(([label, list]) => (
            <div key={label} className="flex flex-wrap items-center gap-x-2 pl-3 text-[11px]">
              <span className="w-20 shrink-0 text-[10px] text-text-4">{label}</span>
              {list.length ? list.map((entry, index) => (
                <span key={index} className="inline-flex items-center gap-1">
                  <SiteLink site={entry.site} label={entry.name} />
                  <KafkaDebugButton entry={entry} sessionId={sessionId} onStatus={setStatus} />
                </span>
              )) : <span className="text-[10px] text-text-4">— not in this project</span>}
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}

function ServicesView({ report, query, sessionId }: { report: GoIDEArchitecture; query: string; sessionId: string }) {
  const groups = useMemo(() => groupEntries(report.entries, query), [query, report.entries])
  if (!groups.length) return <p className="p-3 text-text-4">No entry points or services{query ? ' match the filter' : ''}.</p>
  return (
    <div className="min-h-0 flex-1 overflow-auto py-1">
      <KafkaTopicsSection entries={report.entries} query={query} sessionId={sessionId} />
      {groups.map((group) => (
        <section key={group.kind} className="mb-2">
          <h4 className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-4">{group.title} ({group.entries.length})</h4>
          {group.entries.map((entry, index) => {
            const refs = entityRefsForEntry(entry, sessionId)
            return (
              <div key={index} className="flex items-center gap-2 px-2 py-0.5 hover:bg-surface-2">
                <SiteLink site={entry.site} label={entry.kind === 'main' || entry.kind === 'init' ? shortPackage(entry.name) : entry.name} />
                {entry.detail && <span className="truncate text-text-3">{entry.detail}</span>}
                {entry.handler && <span className="truncate text-[10px] text-text-3">→ <SiteLink site={entry.handlerSite ?? undefined} label={entry.handler} /></span>}
                {entry.request && <span className="shrink-0 rounded bg-info/10 px-1 font-mono text-[10px] text-info" title="Request body decoded by the handler">in: {entry.request.array ? '[]' : ''}{entry.request.ref || entry.request.type}</span>}
                {entry.response && <span className="shrink-0 rounded bg-success/10 px-1 font-mono text-[10px] text-success" title="Response body written by the handler">out: {entry.response.array ? '[]' : ''}{entry.response.ref || entry.response.type}</span>}
                {(entry.middleware ?? []).length > 0 && <span className="truncate text-[10px] text-text-4" title="Middleware, outermost first">via {(entry.middleware ?? []).join(' › ')}</span>}
                {!entry.handler && entry.function && entry.function !== entry.name && <span className="truncate font-mono text-[10px] text-text-4">{entry.function}</span>}
                {entry.group && <span className="shrink-0 rounded bg-accent/10 px-1 text-[10px] text-accent" title="Consumer group">group {entry.group}</span>}
                {entry.serializer && <span className="shrink-0 rounded bg-surface-3 px-1 text-[10px] text-text-2" title="Message format, from the encoding calls next to the produce/consume call">{entry.serializer}</span>}
                <span className="ml-auto flex shrink-0 gap-1">
                  {refs.map((ref) => (
                    <button key={ref.id} type="button" onClick={() => void openEntity(ref)} title={ref.kind === 'route' ? 'Send in API Client' : ref.kind === 'grpc' ? 'Call in gRPC client' : ref.kind === 'websocket' ? 'Open in WebSocket client' : 'Open in Broker Studio'} className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-accent hover:bg-accent/10">
                      {ref.kind === 'topic' ? ref.label : ref.kind === 'route' ? 'API Client' : ref.kind === 'websocket' ? 'WebSocket client' : 'gRPC client'}{ref.kind === 'topic' && entry.topicRoles?.[ref.label] && <TopicRole role={entry.topicRoles[ref.label]} />} <ArrowUpRight size={10} aria-hidden="true" />
                    </button>
                  ))}
                  {entry.kind === 'repository' && <button type="button" onClick={() => showModule('database')} className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-accent hover:bg-accent/10">Database Studio <ArrowUpRight size={10} aria-hidden="true" /></button>}
                </span>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

function ModulesView({ report }: { report: GoIDEArchitecture }) {
  const graph = useMemo(() => moduleGraph(report), [report])
  const [selected, setSelected] = useState<string | null>(null)
  const module = report.modules.find((item) => item.path === selected)
  return (
    <>
      <Graph graph={graph} label="Module graph" selected={selected} onSelect={(node) => setSelected(node.id)} />
      {module && (
        <div className="max-h-40 shrink-0 overflow-auto border-t border-border-1 px-2 py-1">
          <SiteLink site={module.site} label={module.path} />
          <ul className="mt-1 columns-2 font-mono text-[10px] text-text-3">{module.external.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
    </>
  )
}

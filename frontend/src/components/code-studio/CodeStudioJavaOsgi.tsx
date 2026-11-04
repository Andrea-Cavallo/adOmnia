import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, Boxes, Bug, ChevronDown, ChevronRight, CircleDot, FileCode2, FolderOpen, FolderPlus, Hammer,
  Info, Layers, Link2, ListTree, Loader2, Package, Play, RefreshCw, Search, Trash2, X,
} from 'lucide-react'
import { CodeStudioModal } from './CodeStudioModal'
import {
  cancelJavaOsgiImport, compareJavaOsgiTarget, getJavaOsgiBundleDetail, getJavaOsgiExplorer,
  importJavaOsgiJars, importJavaOsgiPlugins, javaOsgiTychoTarget, reindexJavaOsgiTarget, refreshJavaOsgiExplorer, removeJavaOsgiPlugin,
  searchJavaOsgiBundles, selectGoIDEFile, selectGoIDEFolder, selectGoIDEFolders, setJavaOsgiTarget,
  startJavaOsgiBuild, startJavaOsgiRun, startJavaOsgiRuntime, stopJavaOsgiRuntime, refreshJavaOsgiRuntime, subscribeGoIDEEvents,
} from '@/lib/code-studio-api'
import { listGoIDEBreakpoints, setGoIDEBreakpoints } from '@/lib/code-studio-debug-api'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { studioToast } from '@/stores/codeStudioToast'
import { CodeStudioJavaOsgiP2 } from './CodeStudioJavaOsgiP2'
import type {
  ActivatorInfo, BundleDetail, BundleRow, Consumer, Diagnostic, ExplorerReport, FocusGraph, RuntimeSnapshot, SearchHit, TargetComparison,
} from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde/models'
import { withContentKeys } from '@/lib/contentKeys'

let openRequest: ((sessionId: string) => void) | null = null
/** Un import richiesto dal menu contestuale: il pannello lo avvia appena è pronto. */
let pendingImport = false

/** Apre l'OSGi Control Center del progetto: bundle, grafo, Activator, diagnosi e target. */
export function openJavaOsgi(sessionId: string): void {
  openRequest?.(sessionId)
}

/**
 * Apre il Control Center e avvia subito l'import di più plug-in OSGi nel workspace:
 * è la voce del menu contestuale del Project view, con la sua barra di avanzamento e Cancel.
 */
export function openJavaOsgiImport(sessionId: string): void {
  pendingImport = true
  openRequest?.(sessionId)
}

const messageOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

const STATE_CLASS: Record<string, string> = {
  INSTALLED: 'text-danger',
  ACTIVE: 'text-success',
  RESOLVED: 'text-success',
  TARGET: 'text-text-3',
}

const SEVERITY_CLASS: Record<string, string> = {
  error: 'text-danger',
  warning: 'text-warning',
  info: 'text-text-3',
}

/**
 * Un bundle importato sta in `plugins/` del workspace: la cartella è ciò che la rimozione cancella.
 * `location` è il percorso assoluto del progetto, quindi serve `root`; senza, resta la forma relativa
 * `plugins/<nome>` che arriva dai test e dalle definizioni scritte a mano.
 */
export function importedPluginName(bundle: Pick<BundleStatusLike, 'location'>, root?: string | null): string | null {
  const location = (bundle.location ?? '').replace(/\\/g, '/')
  if (!root) {
    const parts = location.split('/').filter(Boolean)
    return parts[0] === 'plugins' && parts.length >= 2 ? parts[1] : null
  }
  const prefix = `${root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}/plugins/`
  if (!location.toLowerCase().startsWith(prefix)) return null
  const name = location.slice(prefix.length).split('/')[0]
  return name && name !== '.' && name !== '..' && !name.includes(':') ? name : null
}

/** The two fields importedPluginName reads, so both BundleStatus and BundleRow work. */
interface BundleStatusLike {
  location: string
}

function MissingRow({ missing }: Readonly<{ missing: { kind: string; name: string; range?: string; optional?: boolean; available?: string[] } }>) {
  const available = missing.available ?? []
  return (
    <div className="pb-1 pl-4 text-[11px]">
      <span className={missing.optional ? 'text-text-3' : 'text-danger'}>{missing.kind}: {missing.name}</span>
      {missing.range && <span className="text-text-3"> · required {missing.range}</span>}
      {missing.optional && <span className="text-text-4"> · optional</span>}
      <span className="text-text-3"> · in target: {available.length > 0 ? available.join(', ') : 'none'}</span>
    </div>
  )
}

/** Payload di `osgi.build` (codestudio.OsgiBuildEvent, inviato come evento e non come modello dei binding). */
interface OsgiBuildEvent {
  done: number
  total: number
  bundle: string
  finished: boolean
  stopped: boolean
  errors: number
  problems: string[]
}

/** Payload di `osgi.import.progress` (eclipsepde.ImportProgress). */
interface OsgiImportProgress {
  folder: string
  done: number
  total: number
  file?: string
  finish: boolean
}

/** Avvia una build o una Run dal pannello: l'output è nella console Run, gli errori in Problems. */
export function runOsgiBuild(sessionId: string): void {
  useCodeStudioLspStore.getState().showToolWindow('run')
  startJavaOsgiBuild(sessionId).catch((reason: unknown) => studioToast(messageOf(reason), 'info'))
}

export function runOsgiFramework(sessionId: string): void {
  useCodeStudioLspStore.getState().showToolWindow('run')
  startJavaOsgiRun(sessionId)
    .then((problems) => { if (problems.length > 0) studioToast(`${problems.length} bundle problem(s) at runtime: ${problems[0]}`, 'info') })
    .catch((reason: unknown) => studioToast(messageOf(reason), 'info'))
}

/** Esito di una build: i problemi che non hanno un file e una riga (dipendenze, bytecode) stanno solo qui. */
export function buildOutcomeMessage(outcome: Pick<OsgiBuildEvent, 'done' | 'total' | 'stopped' | 'errors' | 'problems'>): string {
  if (outcome.stopped) return `Build stopped after ${outcome.done} of ${outcome.total} bundle(s)`
  const base = outcome.errors > 0 ? `${outcome.errors} compile error(s) in ${outcome.total} bundle(s): see Problems` : `${outcome.total} bundle(s) compiled`
  const first = outcome.problems?.[0]
  if (!first) return base
  const others = outcome.problems.length > 1 ? ` (+${outcome.problems.length - 1} more)` : ''
  return `${base}. ${first}${others}`
}

function announceBuildOutcome(outcome: OsgiBuildEvent): void {
  const clean = outcome.errors === 0 && !outcome.stopped && (outcome.problems?.length ?? 0) === 0
  studioToast(buildOutcomeMessage(outcome), clean ? 'success' : 'info')
  if (outcome.errors > 0) useCodeStudioLspStore.getState().showToolWindow('problems')
}

type Tab = 'bundles' | 'graph' | 'activators' | 'diagnose' | 'runtime' | 'target'
type Filter = 'all' | 'issues' | 'resolved' | 'lazy' | 'installed' | 'active'

/** Quante righe disegna il navigator: oltre, la ricerca è la strada (500+ bundle restano veloci). */
const MAX_ROWS = 400

function subtitleOf(report: ExplorerReport | null, busy: boolean, importing = false): string {
  if (busy) return importing ? 'Importing plug-in projects…' : 'Reading manifests and index…'
  if (!report) return ''
  const jvm = report.jvm ? `Java ${report.jvm} · ` : ''
  const target = report.hasTarget ? `${report.targetBundles} in target` : 'no target platform'
  const runtime = report.runtime ? ` · ${report.summary.active} active` : ''
  return `${jvm}Equinox · ${report.summary.bundles} workspace bundle(s) · ${target}${runtime}`
}

/** Sommario cliccabile: le card sono filtri del navigator. */
function SummaryCards({ report, filter, onFilter }: Readonly<{ report: ExplorerReport; filter: Filter; onFilter: (filter: Filter) => void }>) {
  const summary = report.summary
  const cards: Array<{ key: Filter; label: string; value: number; tone?: string }> = report.runtime
    ? [
        { key: 'all', label: 'Bundles', value: summary.bundles },
        { key: 'active', label: 'Active', value: summary.active },
        { key: 'resolved', label: 'Resolved', value: summary.resolved },
        { key: 'issues', label: 'Issues', value: summary.issues + summary.runtimeIssues, tone: summary.issues + summary.runtimeIssues > 0 ? 'text-danger' : undefined },
      ]
    : [
        { key: 'all', label: 'Bundles', value: summary.bundles },
        { key: 'resolved', label: 'Resolved', value: summary.resolved },
        { key: 'lazy', label: 'Lazy', value: summary.lazy },
        { key: 'issues', label: 'Issues', value: summary.issues, tone: summary.issues > 0 ? 'text-danger' : undefined },
      ]
  return (
    <div className="grid grid-cols-4 gap-2 px-3 py-2">
      {cards.map((card) => (
        <button
          key={card.key}
          type="button"
          onClick={() => onFilter(filter === card.key ? 'all' : card.key)}
          className={`rounded-md border px-2.5 py-1.5 text-left transition ${filter === card.key ? 'border-accent bg-surface-3' : 'border-border-1 bg-surface-2 hover:bg-surface-3'}`}
          title={`Show ${card.label.toLowerCase()}`}
        >
          <span className={`block text-[17px] font-semibold leading-tight ${card.tone ?? 'text-text-1'}`}>{card.value}</span>
          <span className="block text-[10.5px] uppercase tracking-wide text-text-3">{card.label}</span>
        </button>
      ))}
    </div>
  )
}

function StatePip({ row }: Readonly<{ row: BundleRow }>) {
  const state = row.state || ''
  const label = state === 'TARGET' ? 'target' : state === 'INSTALLED' ? 'INSTALLED' : state === 'ACTIVE' ? 'ACTIVE' : state === 'RESOLVED' ? (row.lazy ? 'RESOLVED · lazy' : 'RESOLVED') : 'not resolved'
  const title = state === 'TARGET' ? 'In the target platform' : state === 'INSTALLED' ? 'Does not resolve: see Diagnose' : state === 'ACTIVE' ? `Active in the running framework${row.activeAtMs ? ` (first ACTIVE at +${row.activeAtMs} ms)` : ''}` : state === 'RESOLVED' ? 'Resolves against the target; not running here' : 'Choose a target platform to resolve this bundle'
  return (
    <span className="flex shrink-0 items-center gap-1" title={title}>
      <CircleDot size={9} className={STATE_CLASS[state] ?? 'text-text-3'} />
      <span className={`text-[10px] ${STATE_CLASS[state] ?? 'text-text-3'}`}>{label}</span>
    </span>
  )
}

function BundleLine({ row, selected, onSelect }: Readonly<{ row: BundleRow; selected: boolean; onSelect: () => void }>) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 border-b border-border-1 px-3 py-1 text-left hover:bg-surface-3 ${selected ? 'bg-surface-3' : ''}`}
      title={row.location}
    >
      <span className="min-w-0 truncate font-mono text-[11.5px] text-text-1">
        {row.source === 'target' && <span className="mr-1 text-[9.5px] uppercase tracking-wide text-text-4">t</span>}
        {row.symbolicName} <span className="text-accent">{row.version}</span>
      </span>
      <span className="max-w-[13rem] truncate text-[10.5px] text-text-3" title={row.activator || 'no Bundle-Activator'}>{row.activator ? row.activator.split('.').pop() : '—'}</span>
      <span className="text-[10px] text-text-3" title={`Declared start level · ${row.dependencies} direct requirement(s)`}>L{row.startLevel} · {row.dependencies}d</span>
      <span className="flex items-center gap-1.5">
        {row.issues > 0 && <span className="rounded bg-danger/15 px-1 text-[10px] text-danger" title={`${row.issues} issue(s)`}>{row.issues}</span>}
        <StatePip row={row} />
      </span>
    </button>
  )
}

function ConsumerLine({ consumer }: Readonly<{ consumer: Consumer }>) {
  return (
    <div className="flex flex-wrap items-baseline gap-1.5 border-b border-border-1/60 py-0.5 text-[11px]">
      <span className="font-mono text-text-1">{consumer.symbolicName}</span>
      <span className="text-text-4">{consumer.version}</span>
      <span className={`text-[10px] ${consumer.kind.includes('incompatible') ? 'text-danger' : 'text-text-3'}`}>{consumer.kind}</span>
      {consumer.optional && <span className="text-[10px] text-text-4">optional</span>}
      <span className="min-w-0 flex-1 truncate text-text-3" title={consumer.requirement}>{consumer.requirement}</span>
      {(consumer.services ?? []).length > 0 && <span className="text-[10px] text-accent" title={(consumer.services ?? []).join(', ')}>service</span>}
      {consumer.test && <span className="text-[10px] text-warning">test</span>}
    </div>
  )
}

function DiagnosticBlock({ diagnostic }: Readonly<{ diagnostic: Diagnostic }>) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-border-1 px-3 py-1.5">
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={11} className="shrink-0 text-text-3" /> : <ChevronRight size={11} className="shrink-0 text-text-3" />}
        <AlertTriangle size={11} className={`shrink-0 ${SEVERITY_CLASS[diagnostic.severity]}`} />
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-text-1">{diagnostic.title}</span>
        {diagnostic.bundle && <span className="shrink-0 font-mono text-[10.5px] text-text-3">{diagnostic.bundle}</span>}
        <span className={`shrink-0 text-[10px] uppercase ${SEVERITY_CLASS[diagnostic.severity]}`}>{diagnostic.kind}</span>
      </button>
      {open && (
        <div className="pl-6 pt-1 text-[11px]">
          <p className="text-text-2">{diagnostic.cause}</p>
          {(diagnostic.evidence ?? []).length > 0 && (
            <ul className="pt-1 text-[10.5px] text-text-3">
              {(diagnostic.evidence ?? []).map((line) => <li key={line} className="font-mono">{line}</li>)}
            </ul>
          )}
          {(diagnostic.actions ?? []).length > 0 && (
            <p className="pt-1 text-text-2"><span className="text-text-3">Fix: </span>{(diagnostic.actions ?? []).join(' · ')}</p>
          )}
          {diagnostic.file && (
            <button type="button" className="pt-1 text-left text-[10.5px] text-accent hover:underline" onClick={() => { if (diagnostic.file) void useCodeStudioStore.getState().openLocation(diagnostic.file, diagnostic.line || 1, 1) }}>
              {diagnostic.file}{diagnostic.line ? `:${diagnostic.line}` : ''}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ImpactSection({ detail }: Readonly<{ detail: BundleDetail }>) {
  const impact = detail.impact
  if (!impact) return null
  const direct = impact.directConsumers ?? []
  const transitive = impact.transitiveConsumers ?? []
  return (
    <section aria-label="Impact" className="border-t border-border-1 px-3 py-2">
      <h3 className="flex items-center gap-1 pb-1 text-[11px] font-medium text-text-2"><Link2 size={11} /> What breaks if I change this bundle</h3>
      <p className="text-[11px] text-text-3">
        {direct.length} direct consumer(s), {transitive.length} transitive.
        {(impact.tests ?? []).length > 0 && ` ${(impact.tests ?? []).length} test bundle(s) depend on it.`}
      </p>
      {direct.length > 0 && (
        <div className="pt-1">
          <h4 className="text-[10px] uppercase tracking-wide text-text-4">Consumers</h4>
          {direct.slice(0, 40).map((consumer) => <ConsumerLine key={`${consumer.symbolicName}:${consumer.requirement}`} consumer={consumer} />)}
          {direct.length > 40 && <p className="text-[10px] text-text-4">and {direct.length - 40} more: refine with the graph.</p>}
        </div>
      )}
      {transitive.length > 0 && (
        <div className="pt-1">
          <h4 className="text-[10px] uppercase tracking-wide text-text-4">Transitive consumers</h4>
          {transitive.slice(0, 20).map((consumer) => <ConsumerLine key={`${consumer.symbolicName}:${consumer.requirement}`} consumer={consumer} />)}
          {transitive.length > 20 && <p className="text-[10px] text-text-4">and {transitive.length - 20} more.</p>}
        </div>
      )}
      {(impact.tests ?? []).length > 0 && (
        <div className="pt-1">
          <h4 className="text-[10px] uppercase tracking-wide text-text-4">Tests affected</h4>
          {(impact.tests ?? []).map((test) => (
            <button key={test.symbolicName} type="button" className="block truncate text-left text-[11px] text-accent hover:underline" onClick={() => { if (test.location) void useCodeStudioStore.getState().openLocation(`${test.location}/`, 1, 1) }} title={test.reason}>
              {test.symbolicName} <span className="text-text-4">· {test.reason}</span>
            </button>
          ))}
        </div>
      )}
      {(impact.providedServices ?? []).length > 0 && (
        <p className="pt-1 text-[11px] text-text-3">Provides: <span className="font-mono text-text-2">{(impact.providedServices ?? []).join(', ')}</span></p>
      )}
      {(impact.checks ?? []).length > 0 && (
        <div className="pt-1">
          <h4 className="text-[10px] uppercase tracking-wide text-text-4">Before you ship</h4>
          <ul className="text-[11px] text-text-2">
            {(impact.checks ?? []).map((check) => <li key={check}>· {check}</li>)}
          </ul>
        </div>
      )}
      <p className="pt-1 text-[10px] text-text-4">Impact of {impact.symbolicName} {impact.version} ({impact.source === 'workspace' ? 'workspace' : 'target platform'}){impact.matchedClass ? ` · from ${impact.matchedClass}` : ''}.</p>
    </section>
  )
}

function DetailPanel({ detail, loading, onDepth, depth, onToggleBreakpoint }: Readonly<{
  detail: BundleDetail | null
  loading: boolean
  depth: number
  onDepth: (depth: number) => void
  onToggleBreakpoint: (path: string, line: number) => void
}>) {
  if (loading) return <p className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" /> Reading the bundle…</p>
  if (!detail) return <p className="px-3 py-3 text-[11px] text-text-3">Select a bundle to see why it is in this state, who uses it and what to check.</p>
  const row = detail.row
  const diagnostics = detail.diagnostics ?? []
  const activator = detail.activator
  const missing = detail.missing ?? []
  const wires = detail.wires ?? []
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <div className="border-b border-border-1 px-3 py-2">
        <div className="flex items-baseline gap-2">
          <h3 className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-text-1">{row.symbolicName} <span className="text-accent">{row.version}</span></h3>
          <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-3">{row.source === 'workspace' ? 'workspace' : 'target'}</span>
        </div>
        <p className="pt-0.5 text-[10.5px] text-text-3">
          {row.state === 'INSTALLED' ? 'INSTALLED: a requirement is missing' : row.state === 'TARGET' ? 'Available in the target platform' : row.state === 'RESOLVED' ? 'RESOLVED: the target satisfies it' : 'Not resolved: choose a target platform'}
          {' · '}start level {row.startLevel}{row.startOnLaunch ? ' (starts)' : ''}
          {' · '}{row.lazy ? 'lazy activation' : 'eager activation'}
          {row.fragmentHost ? ` · fragment of ${row.fragmentHost}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-1 pt-1">
          {detail.manifestFile && <button type="button" className="gs-btn" onClick={() => { if (detail.manifestFile) void useCodeStudioStore.getState().openLocation(detail.manifestFile, 1, 1) }}><FileCode2 size={11} /> Manifest</button>}
          {activator?.file && (activator.startLine ?? 0) > 0 && <button type="button" className="gs-btn" onClick={() => { if (activator?.file) void useCodeStudioStore.getState().openLocation(activator.file, activator.startLine ?? 1, 1) }}><Bug size={11} /> start()</button>}
          {activator?.file && (activator.stopLine ?? 0) > 0 && <button type="button" className="gs-btn" onClick={() => { if (activator?.file) void useCodeStudioStore.getState().openLocation(activator.file, activator.stopLine ?? 1, 1) }}><Bug size={11} /> stop()</button>}
          {activator?.file && (activator.startLine ?? 0) > 0 && <button type="button" className="gs-btn" onClick={() => { if (activator?.file) onToggleBreakpoint(activator.file, activator.startLine ?? 1) }} title="Toggle a breakpoint on start()">Breakpoint</button>}
          <span className="ml-auto text-[10px] text-text-4">graph depth</span>
          <div className="gs-segmented">
            {[1, 2].map((value) => (
              <button key={value} type="button" className={depth === value ? 'is-active' : ''} onClick={() => onDepth(value)}>{value}</button>
            ))}
          </div>
        </div>
      </div>
      {diagnostics.length > 0 && (
        <section aria-label="Diagnostics" className="border-b border-border-1">
          <h3 className="px-3 pt-2 text-[11px] font-medium text-text-2">Why</h3>
          {diagnostics.map((diagnostic) => <DiagnosticBlock key={diagnostic.id} diagnostic={diagnostic} />)}
        </section>
      )}
      {diagnostics.length === 0 && (
        <p className="border-b border-border-1 px-3 py-2 text-[11px] text-text-3">
          {row.state === 'INSTALLED' ? 'No diagnostic matched: reindex the target platform.' : 'Nothing to fix: the bundle resolves and no rule flags it.'}
        </p>
      )}
      {missing.length > 0 && (
        <section aria-label="Missing requirements" className="border-b border-border-1 px-3 py-1.5">
          <h3 className="pb-1 text-[11px] font-medium text-text-2">Missing ({missing.length})</h3>
          {withContentKeys(missing, (item) => `${item.kind}:${item.name}:${item.range}`).map(({ key, item }) => <MissingRow key={key} missing={item} />)}
        </section>
      )}
      {wires.length > 0 && (
        <section aria-label="Wiring" className="border-b border-border-1 px-3 py-1.5">
          <h3 className="pb-1 text-[11px] font-medium text-text-2">Wired to ({wires.length})</h3>
          <div className="max-h-32 overflow-auto">
            {withContentKeys(wires, (wire) => `${wire.kind}:${wire.name}:${wire.provider}`).map(({ key, item }) => (
              <p key={key} className="truncate font-mono text-[10.5px] text-text-3" title={`${item.kind} ${item.name} → ${item.provider} ${item.providerVersion}`}>
                {item.kind} {item.name} → <span className="text-text-2">{item.provider}</span> {item.providerVersion}
              </p>
            ))}
          </div>
        </section>
      )}
      {(detail.serviceComponents ?? []).length > 0 && (
        <section aria-label="Services" className="border-b border-border-1 px-3 py-1.5">
          <h3 className="pb-1 text-[11px] font-medium text-text-2">Declarative Services</h3>
          {(detail.serviceComponents ?? []).map((component) => (
            <p key={component.file} className="text-[10.5px] text-text-3">
              <span className="font-mono text-text-2">{component.name}</span>
              {(component.services ?? []).length > 0 && ` · provides ${(component.services ?? []).join(', ')}`}
              {(component.references ?? []).length > 0 && ` · uses ${(component.references ?? []).join(', ')}`}
            </p>
          ))}
        </section>
      )}
      <ImpactSection detail={detail} />
      {(row.notes ?? []).length > 0 && (
        <section aria-label="Notes" className="border-t border-border-1 px-3 py-1.5">
          {(row.notes ?? []).map((note) => <p key={note} className="text-[10.5px] text-warning">{note}</p>)}
        </section>
      )}
    </div>
  )
}

function GraphPanel({ graph, loading }: Readonly<{ graph: FocusGraph | null; loading: boolean }>) {
  if (loading) return <p className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" /> Building the focused graph…</p>
  if (!graph) return <p className="px-3 py-3 text-[11px] text-text-3">Select a bundle in Bundles: the graph shows only its dependencies and its consumers, never the whole workspace.</p>
  const dependencies = graph.edges.filter((edge) => edge.direction === 'dependency')
  const consumers = graph.edges.filter((edge) => edge.direction === 'consumer')
  const required = dependencies.filter((edge) => edge.satisfied)
  const missingEdges = dependencies.filter((edge) => !edge.satisfied)
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-auto md:grid-cols-2">
      <section aria-label="Dependencies" className="min-h-0 border-b border-border-1 md:border-b-0 md:border-r">
        <h3 className="px-3 pt-2 text-[11px] font-medium text-text-2">Requires ({required.length})</h3>
        <p className="px-3 text-[10px] text-text-4">{graph.root}</p>
        <div className="px-3 pb-2">
          {required.map((edge) => (
            <div key={`${edge.from}|${edge.to}|${edge.kind}|${edge.requirement}`} className="border-b border-border-1/60 py-0.5 text-[11px]">
              <span className="font-mono text-text-2">{edge.to.split(' ')[0]}</span>
              <span className="text-text-4"> {edge.to.split(' ')[1]}</span>
              <span className="text-text-4"> · {edge.kind}</span>
              {edge.optional && <span className="text-[10px] text-text-4"> optional</span>}
              <p className="truncate font-mono text-[10px] text-text-4" title={edge.requirement}>{edge.requirement}</p>
            </div>
          ))}
          {missingEdges.length > 0 && (
            <>
              <h4 className="pt-2 text-[10px] uppercase tracking-wide text-danger">Not satisfied ({missingEdges.length})</h4>
              {missingEdges.map((edge) => (
                <div key={`missing|${edge.to}|${edge.requirement}`} className="py-0.5 text-[11px]">
                  <span className="text-danger">{edge.to}</span>
                  <p className="truncate font-mono text-[10px] text-text-4" title={edge.requirement}>{edge.requirement}</p>
                </div>
              ))}
            </>
          )}
          {required.length === 0 && missingEdges.length === 0 && <p className="py-1 text-[11px] text-text-3">This bundle requires nothing from the index.</p>}
        </div>
      </section>
      <section aria-label="Consumers">
        <h3 className="px-3 pt-2 text-[11px] font-medium text-text-2">Required by ({consumers.length})</h3>
        <div className="px-3 pb-2">
          {consumers.map((edge) => (
            <div key={`${edge.from}|${edge.kind}|${edge.requirement}`} className="border-b border-border-1/60 py-0.5 text-[11px]">
              <span className="font-mono text-text-2">{edge.from.split(' ')[0]}</span>
              <span className="text-text-4"> {edge.from.split(' ')[1]}</span>
              <span className="text-text-4"> · {edge.kind}</span>
              <p className="truncate font-mono text-[10px] text-text-4" title={edge.requirement}>{edge.requirement}</p>
            </div>
          ))}
          {consumers.length === 0 && <p className="py-1 text-[11px] text-text-3">Nothing in the workspace or the target depends on it.</p>}
        </div>
      </section>
      {graph.truncated && <p className="px-3 py-2 text-[10.5px] text-warning md:col-span-2">The graph stopped after {graph.nodes.length} bundles: select a closer bundle or use the search.</p>}
    </div>
  )
}

function ActivatorsPanel({ activators, sessionId, onToggleBreakpoint }: Readonly<{ activators: ActivatorInfo[]; sessionId: string; onToggleBreakpoint: (path: string, line: number) => void }>) {
  if (activators.length === 0) {
    return <p className="px-3 py-3 text-[11px] text-text-3">No Bundle-Activator in the workspace bundles: they are libraries, fragments or menu contributions only.</p>
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {withContentKeys(activators, (activator) => `${activator.bundle}:${activator.class}`).map(({ key, item }) => (
        <div key={key} className="border-b border-border-1 px-3 py-1.5">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-1">{item.bundle}</span>
            <span className={`text-[10px] ${item.lazy ? 'text-warning' : 'text-text-3'}`}>{item.lazy ? 'lazy' : 'eager'}</span>
          </div>
          <p className="truncate font-mono text-[10.5px] text-text-3">{item.class}</p>
          <div className="flex flex-wrap items-center gap-1 pt-1">
            {item.file && (item.startLine ?? 0) > 0 && <button type="button" className="gs-btn" onClick={() => { if (item.file) void useCodeStudioStore.getState().openLocation(item.file, item.startLine ?? 1, 1) }}><Bug size={11} /> start()</button>}
            {item.file && (item.stopLine ?? 0) > 0 && <button type="button" className="gs-btn" onClick={() => { if (item.file) void useCodeStudioStore.getState().openLocation(item.file, item.stopLine ?? 1, 1) }}><Bug size={11} /> stop()</button>}
            {item.file && (item.startLine ?? 0) > 0 && <button type="button" className="gs-btn" onClick={() => { if (item.file) onToggleBreakpoint(item.file, item.startLine ?? 1) }}>Breakpoint on start()</button>}
            {!item.fileExists && <span className="text-[10px] text-warning">source not in the source folders (generated activator or classes in a JAR)</span>}
            <span className="ml-auto text-[10px] text-text-4">{item.location}</span>
          </div>
        </div>
      ))}
      <p className="px-3 py-2 text-[10px] text-text-4">Breakpoints are set on the Java source and used by the Java debugger of Code Studio; the activation policy decides whether the framework calls start() eagerly or on first class load ({sessionId.slice(0, 6)}…).</p>
    </div>
  )
}

function DiagnosePanel({ diagnostics, jvm }: Readonly<{ diagnostics: Diagnostic[]; jvm: number }>) {
  if (diagnostics.length === 0) {
    return <p className="px-3 py-3 text-[11px] text-text-3">No diagnostic: every bundle resolves against the active target platform.</p>
  }
  const groups: Array<{ severity: string; label: string }> = [
    { severity: 'error', label: 'Errors: these bundles will not resolve' },
    { severity: 'warning', label: 'Warnings: they resolve today but will break' },
    { severity: 'info', label: 'Info: healthy states that look broken' },
  ]
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {jvm === 0 && (
        <p className="flex items-center gap-1 px-3 py-1.5 text-[10.5px] text-warning"><Info size={11} /> No project JVM selected: Bundle-RequiredExecutionEnvironment is not checked. Choose it in Java › Select JDK.</p>
      )}
      <p className="px-3 py-1 text-[10px] text-text-4">Static analysis: nothing is compiled or started. Runtime states (ACTIVE, services) belong to the runtime adapter.</p>
      {groups.map((group) => {
        const items = diagnostics.filter((diagnostic) => diagnostic.severity === group.severity)
        if (items.length === 0) return null
        return (
          <section key={group.severity} aria-label={group.label}>
            <h3 className={`px-3 pt-2 text-[11px] font-medium ${SEVERITY_CLASS[group.severity]}`}>{group.label} ({items.length})</h3>
            {items.map((diagnostic) => <DiagnosticBlock key={diagnostic.id} diagnostic={diagnostic} />)}
          </section>
        )
      })}
    </div>
  )
}

function RuntimePanel({ snapshot, diagnostics, busy, onStart, onRefresh, onStop }: Readonly<{
  snapshot: RuntimeSnapshot | null
  diagnostics: Diagnostic[]
  busy: boolean
  onStart: () => void
  onRefresh: () => void
  onStop: () => void
}>) {
  if (!snapshot) {
    return (
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 text-[11px] text-text-3">
        <p>The states above are static: nothing is running. Start the framework to see which bundles are really ACTIVE, the service registry and the activation order.</p>
        <p className="pt-1 text-[10.5px] text-text-4">
          It launches the compiled bundles in Equinox on the project JVM, with the console on a local port. It needs a target platform with <span className="font-mono">org.eclipse.equinox.console</span> (an Eclipse installation) and the bundles already built.
        </p>
        <button type="button" className="gs-btn mt-2" disabled={busy} onClick={onStart}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Start runtime</button>
      </div>
    )
  }
  const bundles = snapshot.bundles ?? []
  const active = bundles.filter((bundle) => bundle.state === 'ACTIVE')
  const activationOrder = active.filter((bundle) => (bundle.activeAtMs ?? 0) > 0).sort((left, right) => (left.activeAtMs ?? 0) - (right.activeAtMs ?? 0))
  const slowest = [...activationOrder].reverse().slice(0, 10)
  const services = snapshot.services ?? []
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-1 px-3 py-2 text-[10.5px] text-text-3">
        <Activity size={12} className="text-success" />
        <span className="font-mono">{snapshot.address}</span>
        <span>· start level {snapshot.frameworkStartLevel}</span>
        <span>· {snapshot.settled ? 'settled' : 'still changing'}</span>
        <span>· first answer at +{snapshot.startupMs} ms</span>
        <span>· {active.length} active / {bundles.length} bundles · {services.length} services</span>
        <span className="flex-1" />
        <button type="button" className="gs-btn" disabled={busy} onClick={onRefresh}>{busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Refresh</button>
        <button type="button" className="gs-btn" disabled={busy} onClick={onStop}><X size={11} /> Stop</button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-auto md:grid-cols-2">
        <section aria-label="Activation order" className="min-h-0 border-b border-border-1 md:border-b-0 md:border-r">
          <h3 className="px-3 pt-2 text-[11px] font-medium text-text-2">Activation order ({activationOrder.length})</h3>
          <p className="px-3 text-[10px] text-text-4">Measured by polling the framework, not inferred: the time each bundle first reported ACTIVE.</p>
          <div className="px-3 pb-2">
            {activationOrder.slice(0, 60).map((bundle) => (
              <div key={bundle.id} className="flex items-baseline gap-2 border-b border-border-1/60 py-0.5 text-[11px]">
                <span className="w-16 shrink-0 text-right font-mono text-text-3">+{bundle.activeAtMs} ms</span>
                <span className="min-w-0 flex-1 truncate font-mono text-text-2">{bundle.symbolicName}</span>
                <span className="shrink-0 text-[10px] text-text-4">{bundle.version}</span>
              </div>
            ))}
            {activationOrder.length === 0 && <p className="py-1 text-[11px] text-text-3">No bundle reported ACTIVE: the framework stopped before activating them.</p>}
          </div>
          {slowest.length > 0 && (
            <div className="px-3 pb-2">
              <h4 className="text-[10px] uppercase tracking-wide text-warning">Slowest activations</h4>
              {slowest.map((bundle) => (
                <p key={`slow-${bundle.id}`} className="truncate text-[10.5px] text-text-2">+{bundle.activeAtMs} ms · {bundle.symbolicName}</p>
              ))}
            </div>
          )}
        </section>
        <section aria-label="Services" className="min-h-0">
          <h3 className="px-3 pt-2 text-[11px] font-medium text-text-2">Service registry ({services.length})</h3>
          <div className="px-3 pb-2">
            {services.slice(0, 120).map((service) => (
              <div key={`${service.interface}:${service.serviceId}`} className="border-b border-border-1/60 py-0.5 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-text-2" title={service.interface}>{service.interface}</span>
                  <span className="shrink-0 text-[10px] text-text-4">id {service.serviceId}</span>
                </div>
                <p className="truncate text-[10px] text-text-3">
                  {service.provider ? <>provider <span className="font-mono text-text-2">{service.provider}</span></> : 'provider unknown'}
                  {(service.consumers ?? []).length > 0 && <> · used by {(service.consumers ?? []).join(', ')}</>}
                </p>
              </div>
            ))}
            {services.length === 0 && <p className="py-1 text-[11px] text-text-3">The registry is empty (or the console `services` command returned nothing).</p>}
            {services.length > 120 && <p className="text-[10px] text-text-4">{services.length - 120} more.</p>}
          </div>
        </section>
      </div>
      {diagnostics.length > 0 && (
        <section aria-label="Runtime diagnostics" className="border-t border-border-1">
          <h3 className="px-3 pt-2 text-[11px] font-medium text-text-2">What only the runtime knows ({diagnostics.length})</h3>
          {diagnostics.map((diagnostic) => <DiagnosticBlock key={diagnostic.id} diagnostic={diagnostic} />)}
        </section>
      )}
      {(snapshot.problems ?? []).length > 0 && (
        <section aria-label="Runtime problems" className="border-t border-border-1 px-3 py-1.5">
          <h3 className="text-[11px] font-medium text-text-2">Console problems</h3>
          {(snapshot.problems ?? []).map((problem) => <p key={problem} className="text-[10.5px] text-warning">{problem}</p>)}
        </section>
      )}
    </div>
  )
}

function TargetPanel({ report, targetPath, onTarget, onReload, sessionId, onCompare, onAddJar }: Readonly<{
  report: ExplorerReport
  targetPath: string
  onTarget: (path: string) => void
  onReload: () => void
  sessionId: string
  onCompare: (path: string) => void
  onAddJar: () => void
}>) {
  const [path, setPath] = useState(report.targetPath ?? '')
  useEffect(() => { setPath(report.targetPath ?? '') }, [report.targetPath])
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
      <h3 className="text-[11px] font-medium text-text-2">Target platform</h3>
      <p className="pb-1 text-[10.5px] text-text-3">
        {report.hasTarget ? `${report.targetBundles} bundles indexed from ${report.targetPath}` : 'No target chosen: the bundles cannot be resolved.'}
      </p>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (path.trim()) onTarget(path.trim()) }}>
        <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="A folder of bundles, an Eclipse installation or a .target file" className="gs-input min-w-[16rem] flex-1 font-mono" aria-label="Target platform path" />
        <button type="button" className="gs-btn" onClick={() => { void selectGoIDEFolder('Target platform: a folder of bundles or an Eclipse installation').then((folder) => { if (folder) { setPath(folder); onTarget(folder) } }) }}><FolderOpen size={12} /> Folder…</button>
        <button type="button" className="gs-btn" onClick={() => { void selectGoIDEFile('Target platform: an Eclipse .target definition', 'Target definitions (*.target)', '*.target').then((file) => { if (file) { setPath(file); onTarget(file) } }) }}><FileCode2 size={12} /> .target…</button>
        <button type="submit" className="gs-btn" disabled={!path.trim()}>Apply</button>
        <button type="button" className="gs-btn" onClick={onReload} title="Read every manifest of the target again"><RefreshCw size={12} /> Reindex</button>
      </form>
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <button type="button" className="gs-btn" onClick={onAddJar} title="Copy a loose JAR into the active target folder (it must be an OSGi bundle)"><Package size={12} /> Add JAR…</button>
        <button type="button" className="gs-btn" onClick={() => { void selectGoIDEFolder('Compare the active target with: a folder of bundles or an Eclipse installation').then((folder) => { if (folder) onCompare(folder) }) }} title="Diff the active target against another one"><Layers size={12} /> Compare…</button>
        <button type="button" className="gs-btn" onClick={() => { void selectGoIDEFile('Compare the active target with an Eclipse .target definition', 'Target definitions (*.target)', '*.target').then((file) => { if (file) onCompare(file) }) }} title="Diff the active target against a .target definition"><FileCode2 size={12} /> Compare .target…</button>
        <span className="text-[10px] text-text-4">Comparing is read-only; adding a JAR writes into the target folder.</span>
      </div>
      <div className="pt-2">
        <h3 className="text-[11px] font-medium text-text-2">Tycho</h3>
        <p className="text-[10.5px] text-text-3">A pom.xml with a Tycho build declares its own target platform: write it from the pom, then download only what the bundles require.</p>
        <button type="button" className="gs-btn mt-1" onClick={() => { void javaOsgiTychoTarget(sessionId, true).then((result) => {
          if (result.report) onReload()
          studioToast(`Target written from ${(result.repositories ?? []).length} p2 repository(ies), ${(result.units ?? []).length} required unit(s).`, 'info')
        }).catch((reason: unknown) => studioToast(messageOf(reason), 'info')) }}><Package size={12} /> Target from pom.xml</button>
      </div>
      {report.hasTarget && <div className="pt-2"><CodeStudioJavaOsgiP2 sessionId={sessionId} targetPath={report.targetPath} onDownloaded={onReload} /></div>}
      {targetPath && <p className="pt-2 text-[10px] text-text-4">Active: {targetPath}</p>}
    </div>
  )
}

function ComparisonPanel({ comparison }: Readonly<{ comparison: TargetComparison }>) {
  return (
    <section aria-label="Target comparison" className="border-t border-border-1 px-3 py-2">
      <h3 className="text-[11px] font-medium text-text-2">Target comparison</h3>
      <p className="text-[10.5px] text-text-3">
        {comparison.leftBundles} → {comparison.rightBundles} bundles · {comparison.common} in common · {comparison.added.length} added · {comparison.removed.length} removed · {comparison.changed.length} version change(s)
      </p>
      <div className="grid gap-2 pt-1 md:grid-cols-3">
        <div>
          <h4 className="text-[10px] uppercase tracking-wide text-success">Added</h4>
          {comparison.added.slice(0, 50).map((bundle) => <p key={bundle.symbolicName} className="truncate font-mono text-[10.5px] text-text-2">{bundle.symbolicName} {bundle.version}</p>)}
          {comparison.added.length === 0 && <p className="text-[10px] text-text-4">none</p>}
        </div>
        <div>
          <h4 className="text-[10px] uppercase tracking-wide text-danger">Removed</h4>
          {comparison.removed.slice(0, 50).map((bundle) => <p key={bundle.symbolicName} className="truncate font-mono text-[10.5px] text-text-2">{bundle.symbolicName} {bundle.version}</p>)}
          {comparison.removed.length === 0 && <p className="text-[10px] text-text-4">none</p>}
        </div>
        <div>
          <h4 className="text-[10px] uppercase tracking-wide text-warning">Version changed</h4>
          {comparison.changed.slice(0, 50).map((change) => <p key={change.symbolicName} className="truncate font-mono text-[10.5px] text-text-2">{change.symbolicName} <span className="text-text-4">{change.left} → {change.right}</span></p>)}
          {comparison.changed.length === 0 && <p className="text-[10px] text-text-4">none</p>}
        </div>
      </div>
      {comparison.problems.length > 0 && <p className="pt-1 text-[10px] text-warning">{comparison.problems.length} problem(s) indexing the targets: {comparison.problems[0].message}</p>}
    </section>
  )
}

/** OSGi Control Center: bundle, Activator, diagnosi, grafo e target platform in un solo pannello. */
export function CodeStudioJavaOsgi() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [report, setReport] = useState<ExplorerReport | null>(null)
  const [detail, setDetail] = useState<BundleDetail | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('bundles')
  const [filter, setFilter] = useState<Filter>('all')
  const [depth, setDepth] = useState(1)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailEpoch, setDetailEpoch] = useState(0)
  const [runtimeBusy, setRuntimeBusy] = useState(false)
  const [comparison, setComparison] = useState<TargetComparison | null>(null)
  const [importProgress, setImportProgress] = useState<OsgiImportProgress | null>(null)
  const [importing, setImporting] = useState<string | null>(null)
  const cancelled = useRef(false)
  /** La funzione di import del render corrente: il menu contestuale la invoca dopo l'apertura. */
  const importRef = useRef<(() => void) | null>(null)

  useEffect(() => subscribeGoIDEEvents((event) => {
    if (event.type === 'osgi.import.progress') {
      const progress = event.payload as OsgiImportProgress
      setImportProgress(progress.finish ? null : progress)
      return
    }
    if (event.type !== 'osgi.build') return
    const outcome = event.payload as OsgiBuildEvent
    if (outcome.finished) announceBuildOutcome(outcome)
  }), [])

  const load = useCallback((id: string): void => {
    setBusy(true)
    setError('')
    getJavaOsgiExplorer(id)
      .then((next) => {
        setReport(next)
        setSelected((current) => current && next?.bundles.some((bundle) => bundle.symbolicName === current) ? current : null)
      })
      .catch((reason: unknown) => setError(messageOf(reason)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => {
    openRequest = (next) => {
      setSessionId(next)
      setReport(null)
      setDetail(null)
      setSelected(null)
      setTab('bundles')
      setFilter('all')
      setQuery('')
      setHits(null)
      setComparison(null)
      setImportProgress(null)
      load(next)
      if (pendingImport) {
        pendingImport = false
        // The panel has to be mounted with its opener registered before the picker opens.
        setTimeout(() => importRef.current?.(), 0)
      }
    }
    return () => { openRequest = null }
  }, [load])

  // Detail of the selected bundle, rebuilt when the depth or the position changes.
  useEffect(() => {
    if (!sessionId || !selected) { setDetail(null); return }
    let current = true
    setDetailLoading(true)
    getJavaOsgiBundleDetail(sessionId, selected, depth)
      .then((next) => { if (current) setDetail(next) })
      .catch((reason: unknown) => { if (current) setError(messageOf(reason)) })
      .finally(() => { if (current) setDetailLoading(false) })
    return () => { current = false }
  }, [sessionId, selected, depth, detailEpoch])

  // Instant search: the backend indexes name, packages, activator and manifest text.
  useEffect(() => {
    const needle = query.trim()
    if (!sessionId || needle === '') { setHits(null); return }
    const handle = setTimeout(() => {
      searchJavaOsgiBundles(sessionId, needle)
        .then((next) => setHits(next))
        .catch(() => setHits([]))
    }, 140)
    return () => clearTimeout(handle)
  }, [sessionId, query])

  const reload = (): void => { if (sessionId) load(sessionId) }

  const refresh = (): void => {
    if (!sessionId) return
    setBusy(true)
    setError('')
    refreshJavaOsgiExplorer(sessionId)
      .then((next) => {
        setReport(next)
        if (selected && !next?.bundles.some((bundle) => bundle.symbolicName === selected)) setSelected(null)
        else if (selected) setDetailEpoch((epoch) => epoch + 1)
      })
      .catch((reason: unknown) => setError(messageOf(reason)))
      .finally(() => setBusy(false))
  }

  const applyTarget = (path: string): void => {
    if (!sessionId) return
    setBusy(true)
    setError('')
    setJavaOsgiTarget(sessionId, path)
      .then(() => { setComparison(null); load(sessionId) })
      .catch((reason: unknown) => { setError(messageOf(reason)); setBusy(false) })
  }

  const reindex = (): void => {
    if (!sessionId) return
    setBusy(true)
    reindexJavaOsgiTarget(sessionId)
      .then(() => load(sessionId))
      .catch((reason: unknown) => { setError(messageOf(reason)); setBusy(false) })
  }

  const toggleBreakpoint = async (path: string, line: number): Promise<void> => {
    if (!sessionId) return
    try {
      const files = await listGoIDEBreakpoints(sessionId)
      const existing = files.find((file) => file.relativePath === path)?.breakpoints ?? []
      const present = existing.some((breakpoint) => breakpoint.line === line)
      const lines = new Set(existing.map((breakpoint) => breakpoint.line))
      if (present) lines.delete(line)
      else lines.add(line)
      await setGoIDEBreakpoints(sessionId, path, [...lines].sort((left, right) => left - right).map((value) => ({ line: value })))
      studioToast(present ? `Breakpoint removed at ${path}:${line}` : `Breakpoint set at ${path}:${line}`, 'success')
    } catch (reason) {
      studioToast(messageOf(reason), 'info')
    }
  }

  // Native pickers choose either files or folders: two buttons, one click each.
  const addJar = async (): Promise<void> => {
    if (!sessionId) return
    const file = await selectGoIDEFile('Add an OSGi bundle JAR to the active target platform', 'Java archive (*.jar)', '*.jar')
    if (!file) return
    try {
      const result = await importJavaOsgiJars(sessionId, [file])
      if (result.skipped.length > 0) setError(`Not added: ${result.skipped.join('\n')}`)
      else studioToast(`${result.imported.length} JAR added to the target platform`, 'success')
      reload()
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  // One dialog, several folders: each plug-in project lands under plugins/ of this workspace.
  const importPlugins = async (): Promise<void> => {
    if (!sessionId) return
    const folders = await selectGoIDEFolders('Import plug-in projects into this workspace (they are copied under plugins/)')
    if (folders.length === 0) return
    cancelled.current = false
    setImporting(sessionId)
    setBusy(true)
    setError('')
    try {
      const result = await importJavaOsgiPlugins(sessionId, folders)
      const first = result.skipped?.[0]
      const skipped = result.skipped?.length ?? 0
      const imported = result.imported?.length ?? 0
      if (imported === 0 && skipped > 0) setError(`Nothing imported.\n${result.skipped.join('\n')}`)
      else if (skipped > 0) studioToast(`${imported} plug-in(s) imported. ${skipped} skipped: ${first}`, 'info')
      else studioToast(`${imported} plug-in(s) imported`, 'success')
      if (imported > 0) void useCodeStudioStore.getState().refreshProject()
      reload()
    } catch (reason) {
      if (cancelled.current) studioToast('Import stopped', 'info')
      else setError(messageOf(reason))
    } finally {
      setImporting(null)
      setImportProgress(null)
      setBusy(false)
    }
  }

  const removePlugin = (name: string): void => {
    if (!sessionId) return
    removeJavaOsgiPlugin(sessionId, name)
      .then(() => reload())
      .catch((reason: unknown) => setError(messageOf(reason)))
  }

  importRef.current = () => { void importPlugins() }

  /** Avvia il framework e poi rilegge l'explorer: gli ACTIVE arrivano solo da qui. */
  const startRuntime = (): void => {
    if (!sessionId) return
    setRuntimeBusy(true)
    setError('')
    startJavaOsgiRuntime(sessionId)
      .then(() => reload())
      .catch((reason: unknown) => setError(messageOf(reason)))
      .finally(() => setRuntimeBusy(false))
  }

  const refreshRuntime = (): void => {
    if (!sessionId) return
    setRuntimeBusy(true)
    setError('')
    refreshJavaOsgiRuntime(sessionId)
      .then(() => reload())
      .catch((reason: unknown) => setError(messageOf(reason)))
      .finally(() => setRuntimeBusy(false))
  }

  const stopRuntime = (): void => {
    if (!sessionId) return
    setRuntimeBusy(true)
    stopJavaOsgiRuntime(sessionId)
      .then(() => reload())
      .catch((reason: unknown) => setError(messageOf(reason)))
      .finally(() => setRuntimeBusy(false))
  }

  const visible = useMemo(() => {
    const rows = report?.bundles ?? []
    let filtered = rows
    switch (filter) {
      case 'issues':
        filtered = rows.filter((row) => (row.issues ?? 0) > 0)
        break
      case 'resolved':
        filtered = rows.filter((row) => row.source === 'workspace' && row.state === 'RESOLVED')
        break
      case 'lazy':
        filtered = rows.filter((row) => row.lazy)
        break
      case 'active':
        filtered = rows.filter((row) => row.runtimeState === 'ACTIVE')
        break
      case 'installed':
        filtered = rows.filter((row) => row.state === 'INSTALLED')
        break
      default:
        break
    }
    return filtered
  }, [report, filter])

  const problems = report?.problems ?? []
  const empty = report && (report.bundles?.length ?? 0) === 0
  const activators = report?.activators ?? []
  const diagnostics = [...(report?.diagnostics ?? []), ...(report?.runtimeDiagnostics ?? [])]
  const graph = detail?.graph ?? null

  return (
    <CodeStudioModal open={!!sessionId} onClose={() => setSessionId(null)} title="OSGi Control Center" subtitle={subtitleOf(report, busy, importing !== null)} icon={Boxes} size="lg" tall divided flush top>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border-1 px-3 py-2">
          <Search size={14} className="text-text-3" />
          <input data-autofocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search bundles, Activators, services, packages, manifest text…" className="gs-input flex-1" />
          <button type="button" className="gs-btn gs-btn-icon shrink-0" disabled={busy} onClick={refresh} title="Re-read manifests, target index and diagnostics" aria-label="Refresh the Control Center"><RefreshCw size={13} /></button>
          <button type="button" className="gs-btn shrink-0" disabled={busy || !report?.hasTarget} onClick={() => { if (sessionId) { runOsgiBuild(sessionId); setSessionId(null) } }} title="Compile with the Eclipse compiler of the target, on the project JVM (Java > Select JDK)"><Hammer size={13} /> Build</button>
          <button type="button" className="gs-btn shrink-0" disabled={busy || !report?.hasTarget} onClick={() => { if (sessionId) { runOsgiFramework(sessionId); setSessionId(null) } }} title="Start the compiled bundles in Equinox, on the project JVM"><Play size={13} /> Run</button>
          <button type="button" className="gs-btn shrink-0" disabled={busy} onClick={() => { void importPlugins() }} title="Import plug-in projects from this machine: they are copied under plugins/ so several repositories compile together"><FolderPlus size={13} /> Import…</button>
        </div>
        {report && <SummaryCards report={report} filter={filter} onFilter={setFilter} />}
        <div className="flex items-center gap-1 border-b border-border-1 px-2">
          {([['bundles', 'Bundles', ListTree], ['graph', 'Graph', Link2], ['activators', 'Activators', Bug], ['diagnose', `Diagnose${diagnostics.length > 0 ? ` (${diagnostics.filter((item) => item.severity !== 'info').length})` : ''}`, AlertTriangle], ['runtime', `Runtime${report?.runtime ? ` · ${report.summary.active}` : ''}`, Activity], ['target', 'Target', Layers]] as Array<[Tab, string, typeof Boxes]>).map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={`flex items-center gap-1 border-b-2 px-2 py-1.5 text-[11px] ${tab === key ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-2'}`}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        {importing !== null ? (
          <div className="flex items-center gap-2 border-b border-border-1 px-3 py-1.5 text-[11px] text-text-3">
            <Loader2 size={11} className="shrink-0 animate-spin" />
            <span className="min-w-0 flex-1 truncate">
              {importProgress
                ? <>Importing {importProgress.folder}{importProgress.total > 0 ? ` ${importProgress.done}/${importProgress.total}` : ''}{importProgress.file ? ` · ${importProgress.file}` : ''}</>
                : 'Copying the plug-in projects…'}
            </span>
            <button type="button" className="gs-btn shrink-0" onClick={() => { cancelled.current = true; void cancelJavaOsgiImport(importing) }}>Cancel</button>
          </div>
        ) : busy && (
          <p className="flex items-center gap-2 px-3 py-2 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" /> A full Eclipse target has about a thousand bundles: this can take a few seconds.</p>
        )}
        {error && <p className="whitespace-pre-wrap px-3 py-2 text-[11px] text-danger">{error}</p>}
        {tab === 'bundles' && (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col border-r border-border-1">
              {hits !== null ? (
                <div className="min-h-0 flex-1 overflow-auto">
                  <p className="px-3 pt-2 text-[10px] uppercase tracking-wide text-text-4">{hits.length} match(es) for “{query.trim()}”</p>
                  {hits.map((hit) => (
                    <button key={`${hit.symbolicName}:${hit.version}:${hit.source}`} type="button" onClick={() => { setSelected(hit.symbolicName); setTab('bundles') }} className={`block w-full border-b border-border-1 px-3 py-1 text-left hover:bg-surface-3 ${selected === hit.symbolicName ? 'bg-surface-3' : ''}`}>
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-1">{hit.symbolicName} <span className="text-accent">{hit.version}</span></span>
                        <span className="shrink-0 text-[10px] text-text-4">{hit.source}</span>
                      </div>
                      <p className="truncate text-[10px] text-text-3">{hit.field}: {hit.match}</p>
                    </button>
                  ))}
                  {hits.length === 0 && <p className="px-3 py-3 text-[11px] text-text-3">Nothing matches.</p>}
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                  {visible.slice(0, MAX_ROWS).map((row) => (
                    <BundleLine key={`${row.source}:${row.symbolicName}:${row.version}`} row={row} selected={selected === row.symbolicName} onSelect={() => setSelected(row.symbolicName)} />
                  ))}
                  {visible.length > MAX_ROWS && <p className="px-3 py-2 text-[10.5px] text-text-3">{visible.length - MAX_ROWS} more not drawn: use the search to narrow the list.</p>}
                  {empty && (
                    <p className="px-3 py-3 text-[11px] text-text-3">
                      No OSGi bundles here: a bundle is an Eclipse project (.project) with META-INF/MANIFEST.MF.
                      {' '}Use Import… to bring the plug-in projects of another repository into plugins/ of this workspace.
                      {report && report.otherProjects > 0 && ` Found ${report.otherProjects} Eclipse project(s) without a manifest; bnd workspaces, which generate it at build time, are not supported yet.`}
                    </p>
                  )}
                  {!empty && visible.length === 0 && <p className="px-3 py-3 text-[11px] text-text-3">Nothing matches this filter.</p>}
                  {problems.length > 0 && (
                    <section aria-label="Problems" className="px-3 py-2">
                      <h3 className="pb-1 text-[11px] font-medium text-text-2">Problems ({problems.length})</h3>
                      {withContentKeys(problems, (problem) => `${problem.severity}:${problem.file}:${problem.message}`).map(({ key, item }) => (
                        <p key={key} className={`text-[11px] ${item.severity === 'error' ? 'text-danger' : 'text-warning'}`}>{item.file ? `${item.file}: ` : ''}{item.message}</p>
                      ))}
                    </section>
                  )}
                </div>
              )}
            </div>
            <div className="min-h-0">
              <DetailPanel detail={detail} loading={detailLoading} depth={depth} onDepth={setDepth} onToggleBreakpoint={(path, line) => { void toggleBreakpoint(path, line) }} />
              {detail && importedPluginName(detail.row, report?.root) && (
                <div className="border-t border-border-1 px-3 py-1.5">
                  <button type="button" className="gs-btn" onClick={() => { const name = importedPluginName(detail.row, report?.root); if (name) removePlugin(name) }}><Trash2 size={11} /> Remove imported plug-in</button>
                </div>
              )}
            </div>
          </div>
        )}
        {tab === 'graph' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <p className="px-3 py-1.5 text-[10.5px] text-text-3">
              {selected ? <>Focused on <span className="font-mono text-text-2">{selected}</span> · depth {depth}</> : 'Select a bundle in Bundles first.'}
            </p>
            <GraphPanel graph={graph} loading={detailLoading} />
            {detail?.impact && (
              <div className="border-t border-border-1 px-3 py-1.5 text-[10.5px] text-text-3">
                {detail.impact.directConsumers.length} direct consumer(s) · {detail.impact.transitiveConsumers.length} transitive · {(detail.impact.checks ?? []).length} check(s) before shipping.
              </div>
            )}
          </div>
        )}
        {tab === 'activators' && <ActivatorsPanel activators={activators} sessionId={sessionId ?? ''} onToggleBreakpoint={(path, line) => { void toggleBreakpoint(path, line) }} />}
        {tab === 'diagnose' && <DiagnosePanel diagnostics={diagnostics} jvm={report?.jvm ?? 0} />}
        {tab === 'runtime' && (
          <RuntimePanel
            snapshot={report?.runtime ?? null}
            diagnostics={report?.runtimeDiagnostics ?? []}
            busy={runtimeBusy}
            onStart={startRuntime}
            onRefresh={refreshRuntime}
            onStop={stopRuntime}
          />
        )}
        {tab === 'target' && report && sessionId && (
          <>
            <TargetPanel report={report} targetPath={report.targetPath} onTarget={applyTarget} onReload={reindex} sessionId={sessionId} onCompare={(path) => { void compareJavaOsgiTarget(sessionId, path).then((next) => { setComparison(next); if (!next) setError('The comparison returned no data') }).catch((reason: unknown) => setError(messageOf(reason))) }} onAddJar={() => { void addJar() }} />
            {comparison && <ComparisonPanel comparison={comparison} />}
          </>
        )}
        {!report && !busy && <p className="px-3 py-3 text-[11px] text-text-3">No data. Check the trust of the project and the target platform.</p>}
        {report && !report.hasTarget && tab === 'bundles' && (
          <p className="flex items-center gap-1 border-t border-border-1 px-3 py-1.5 text-[10.5px] text-warning"><Info size={11} /> No target platform: states stay empty until you choose one in Target.</p>
        )}
        {report && report.diagnostics.length === 0 && report.hasTarget && tab === 'bundles' && (
          <p className="flex items-center gap-1 border-t border-border-1 px-3 py-1.5 text-[10.5px] text-text-3"><Info size={11} /> Every workspace bundle resolves against the active target platform.</p>
        )}
        {tab === 'bundles' && report && report.summary.lazy > 0 && (
          <p className="border-t border-border-1 px-3 py-1.5 text-[10.5px] text-text-4">
            {report.summary.lazy} bundle(s) are RESOLVED with lazy activation: ready, not yet active. That is normal and never reported as a warning.
          </p>
        )}
      </div>
    </CodeStudioModal>
  )
}

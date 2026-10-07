import { useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, Info, GitBranch, Timer, Network, Loader2, RefreshCw } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import type { GoIDEArchitectureResult } from '@/lib/goide-api'
import { cachedArchitecture } from '@/lib/goide/architectureCache'
import { architectureFor } from '@/lib/goide/architectureCache'
import { GoStudioGraphView } from './GoStudioGraphView'
import { SiteLink, openArchSite } from './GoStudioInterfaceExplorer'
import { layoutLayered } from './goStudioLayeredGraph'
import { fileContextGraph, projectContextGraph, type ContextGraph, type ContextNode } from './goStudioContextGraph'
import {
  analyzeContextPropagation,
  contextFindingSummary,
  loadContextTimeoutThreshold,
  saveContextTimeoutThreshold,
  type ContextFinding,
  type ContextSeverity,
} from './goStudioContextAnalysis'

interface GoStudioContextPanelProps {
  sessionId: string
}

const THRESHOLD_OPTIONS = [
  { label: '5s', ms: 5_000 },
  { label: '15s', ms: 15_000 },
  { label: '30s', ms: 30_000 },
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '10m', ms: 600_000 },
  { label: '1h', ms: 3_600_000 },
]

function SeverityIcon({ severity }: { severity: ContextSeverity }) {
  if (severity === 'error') return <AlertCircle size={11} className="shrink-0 text-danger" aria-label="error" />
  if (severity === 'warning') return <AlertTriangle size={11} className="shrink-0 text-warning" aria-label="warning" />
  return <Info size={11} className="shrink-0 text-accent" aria-label="information" />
}

const KIND_LABELS: Record<string, string> = {
  'background': 'Background root',
  'todo': 'TODO placeholder',
  'missing-timeout': 'Missing timeout',
  'wide-timeout': 'Too-wide timeout',
  'context-in-struct': 'Context in struct',
  'leaked-cancel': 'Leaked cancel',
  'ignored-cancellation': 'Ignored cancellation',
  'broken-chain': 'Broken chain',
  'trace-id': 'Trace ID',
}

export function GoStudioContextPanel({ sessionId }: GoStudioContextPanelProps) {
  const documents = useGoIDEStore((state) => state.documents)
  const activeId = useGoIDEStore((state) => state.activeDocumentBySession[sessionId] ?? null)
  const document = documents.find((item) => item.document.id === activeId) ?? null
  const buffer = document?.buffer ?? ''
  const isGo = !!document && document.document.relativePath.endsWith('.go') && !document.document.external
  const [threshold, setThreshold] = useState(loadContextTimeoutThreshold)

  const analysis = useMemo(() => analyzeContextPropagation(buffer, { timeoutThresholdMs: threshold }), [buffer, threshold])
  const summary = useMemo(() => contextFindingSummary(analysis.findings), [analysis.findings])

  const open = (line: number) => {
    if (document) void useGoIDEStore.getState().openLocation(document.document.relativePath, line, 1)
  }

  const onThreshold = (ms: number) => {
    setThreshold(ms)
    saveContextTimeoutThreshold(ms)
  }

  const grouped = useMemo(() => {
    const buckets: Array<{ severity: ContextSeverity; findings: ContextFinding[] }> = [
      { severity: 'error', findings: [] },
      { severity: 'warning', findings: [] },
      { severity: 'info', findings: [] },
    ]
    for (const finding of analysis.findings) buckets.find((bucket) => bucket.severity === finding.severity)?.findings.push(finding)
    return buckets.filter((bucket) => bucket.findings.length > 0)
  }, [analysis.findings])

  const [scope, setScope] = useState<'file' | 'project'>('file')
  const session = useGoIDEStore((state) => state.sessions.find((item) => item.id === sessionId) ?? null)
  const authorized = session?.project.authorization === 'tooling-permitted'
  const [project, setProject] = useState<GoIDEArchitectureResult | null>(() => cachedArchitecture(sessionId))
  const [loadingProject, setLoadingProject] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)
  const loadProject = (fresh: boolean) => {
    setLoadingProject(true)
    setProjectError(null)
    architectureFor(sessionId, fresh).then(setProject, (reason) => setProjectError(reason instanceof Error ? reason.message : String(reason))).finally(() => setLoadingProject(false))
  }
  const graph = useMemo<ContextGraph | null>(() => {
    if (scope === 'file') return isGo ? fileContextGraph(analysis) : null
    return project?.report ? projectContextGraph(project.report) : null
  }, [scope, isGo, analysis, project])

  return (
    <div className="flex h-full min-h-0 flex-col text-[11px]">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-1 px-2">
        <span className="flex items-center gap-1.5 font-medium text-text-2"><GitBranch size={12} className="text-accent" />Context propagation</span>
        {isGo && (
          <span className="rounded-full bg-surface-3 px-1.5 text-[10px] text-text-3">
            {summary.errors} errors · {summary.warnings} warnings · {summary.infos} info
          </span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-[10px] text-text-4">
          <Timer size={11} aria-hidden="true" /> Timeout limit
          <select value={threshold} onChange={(event) => onThreshold(Number(event.target.value))} aria-label="Timeout limit" className="h-6 rounded border-0 bg-[var(--gs-raised)] px-1.5 font-mono text-[10.5px] text-text-2 outline-none focus:ring-1 focus:ring-accent">
            {THRESHOLD_OPTIONS.map((option) => <option key={option.ms} value={option.ms}>{option.label}</option>)}
          </select>
        </label>
      </div>

      {!document && <p className="p-3 text-[10px] text-text-4">Open a Go file to inspect how context.Context flows through it.</p>}
      {document && !isGo && <p className="p-3 text-[10px] text-text-4">The active file is not a Go source file.</p>}

      {isGo && (
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {analysis.findings.length === 0 && <p className="p-3 text-[10px] text-text-4">No context propagation issues found in this file.</p>}
          {grouped.map((bucket) => (
            <div key={bucket.severity} role="treeitem" aria-expanded="true">
              <div className="flex h-6 items-center gap-1.5 px-2 font-medium capitalize text-text-2"><SeverityIcon severity={bucket.severity} />{bucket.severity}s <span className="text-[9px] text-text-4">{bucket.findings.length}</span></div>
              {bucket.findings.map((finding) => (
                <div key={finding.id} className="group flex min-h-6 w-full items-start hover:bg-surface-3 focus-within:bg-surface-3">
                  <button type="button" onClick={() => open(finding.line)} className="flex min-w-0 flex-1 items-start gap-1.5 py-0.5 pl-6 pr-2 text-left text-text-2 focus:outline-none" title={finding.detail}>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                      <span className="mr-1.5 rounded bg-surface-3 px-1 py-px font-mono text-[9px] uppercase tracking-wide text-text-4">{KIND_LABELS[finding.kind] ?? finding.kind}</span>
                      {finding.message}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-text-4">{finding.line}</span>
                  </button>
                </div>
              ))}
            </div>
          ))}

        </div>
      )}

      <div className="flex shrink-0 items-center gap-1.5 border-t border-border-1 px-2 py-1">
        <span className="flex items-center gap-1.5 font-medium text-text-2"><Network size={12} className="text-accent" />Context graph</span>
        {(['file', 'project'] as const).map((value) => (
          <button key={value} type="button" aria-pressed={scope === value} onClick={() => { setScope(value); if (value === 'project' && !project && authorized) loadProject(false) }} className={`h-5 rounded px-1.5 text-[10px] capitalize ${scope === value ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-surface-3'}`}>{value}</button>
        ))}
        {scope === 'project' && authorized && <button type="button" onClick={() => loadProject(true)} disabled={loadingProject} title="Analyze the project again" className="ml-auto rounded p-0.5 text-text-3 hover:bg-surface-3 disabled:opacity-40">{loadingProject ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}</button>}
      </div>
      <div className="max-h-[45%] min-h-[96px] shrink-0 overflow-auto">
        {scope === 'project' && !authorized && <p className="p-2 text-[10px] text-text-4">Trust the project to trace context.Context across packages with typed analysis.</p>}
        {scope === 'project' && projectError && <p className="p-2 text-[10px] text-danger">{projectError}</p>}
        {scope === 'project' && authorized && !project && !projectError && <p className="p-2 text-[10px] text-text-4">{loadingProject ? 'Loading packages…' : 'No analysis yet.'}</p>}
        {graph && graph.breaks.length > 0 && (
          <div className="px-2 py-1">
            {graph.breaks.map((item) => (
              <div key={`${item.site.relativePath}:${item.site.line}`} className="flex items-center gap-1.5 text-[10.5px]">
                <AlertCircle size={11} className="shrink-0 text-danger" />
                <span className="min-w-0 flex-1 truncate text-text-2">{item.from} passes context.Background/TODO to {item.to}{item.crossPackage ? ' (other package)' : ''}</span>
                <SiteLink site={item.site} label={`${item.site.relativePath.split('/').pop()}:${item.site.line}`} />
              </div>
            ))}
          </div>
        )}
        {graph && <ContextGraphView graph={graph} onOpenLine={open} />}
      </div>
    </div>
  )
}

const TONE_COLOR: Record<ContextNode['tone'], string> = {
  broken: 'var(--color-danger)',
  root: 'var(--color-warning)',
  timeout: 'var(--color-success)',
  plain: 'var(--color-info)',
}

const TONE_LABEL: Record<ContextNode['tone'], string> = {
  broken: 'drops the caller context',
  root: 'creates a root context',
  timeout: 'applies a timeout',
  plain: 'propagates the context',
}

function ContextGraphView({ graph, onOpenLine }: { graph: ContextGraph; onOpenLine: (line: number) => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const layout = useMemo(() => layoutLayered(graph.nodes, graph.links), [graph])
  if (!layout.nodes.length) return <p className="p-2 text-[10px] text-text-4">No function passes a context.Context to another one.</p>
  return (
    <div className="p-2">
      <GoStudioGraphView layout={layout} label="Context propagation graph" selected={selected}
        look={(node) => ({ title: node.data.title, subtitle: node.data.subtitle, tooltip: `${node.data.title}: ${TONE_LABEL[node.data.tone]}`, color: TONE_COLOR[node.data.tone] })}
        edgeTitle={(from, to, value) => `${from.data.title} passes a context to ${to.data.title}${value > 1 ? ` (${value} calls)` : ''}`}
        onSelect={(node) => setSelected(node.id === selected ? null : node.id)}
        onOpen={(node) => node.data.site ? openArchSite(node.data.site) : node.data.line && onOpenLine(node.data.line)} />
      {graph.hidden > 0 && <p className="pt-1 text-[10px] text-text-4">{graph.hidden} less connected functions not shown.</p>}
    </div>
  )
}

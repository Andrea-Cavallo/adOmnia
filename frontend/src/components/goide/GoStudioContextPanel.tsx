import { useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, Info, GitBranch, Timer, Network } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
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

  // Catene di propagazione: sorgente → destinazioni, per un "grafo" leggibile senza SVG.
  const chains = useMemo(() => {
    const bySource = new Map<string, Array<{ to: string; via?: string; line: number }>>()
    for (const edge of analysis.edges) {
      const list = bySource.get(edge.from) ?? []
      list.push({ to: edge.to, via: edge.via, line: edge.line })
      bySource.set(edge.from, list)
    }
    return [...bySource.entries()].sort((left, right) => left[0].localeCompare(right[0]))
  }, [analysis.edges])

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

          {analysis.nodes.length > 0 && (
            <div className="mt-1 border-t border-border-1">
              <div className="flex h-6 items-center gap-1.5 px-2 font-medium text-text-2"><Network size={12} className="text-accent" />Context graph <span className="text-[9px] text-text-4">{analysis.nodes.length} functions</span></div>
              {chains.length === 0 && <p className="px-2 py-1 text-[10px] text-text-4">No cross-function propagation detected in this file.</p>}
              {chains.map(([source, targets]) => (
                <div key={source} className="flex flex-wrap items-center gap-1 px-2 py-0.5 font-mono text-[10px]">
                  <span className="text-text-2">{source}</span>
                  {targets.map((target) => (
                    <span key={`${source}-${target.to}-${target.line}`} className="flex items-center gap-1">
                      <span className="text-text-4">→</span>
                      <button type="button" onClick={() => open(target.line)} className="rounded px-1 text-accent hover:bg-surface-3 hover:underline focus:outline-none" title={`${source} passes "${target.via ?? ''}" to ${target.to} at line ${target.line}`}>{target.to}</button>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

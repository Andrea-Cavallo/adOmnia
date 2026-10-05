import { useMemo, useState, type ReactElement } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, CircleAlert, Info, Loader2, Play, Search, Wand2 } from 'lucide-react'
import { analyzeGoIDEErrorHandling, type GoIDEErrorFinding, type GoIDEErrorLocation, type GoIDEErrorReport, type GoIDESession } from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'
import { applyGoStudioWorkspaceChange } from './goStudioWorkspaceEdits'
import { errorFixChange, errorPathsForFile, groupErrorFindings, returnKindCounts } from './goStudioErrorHandling'

type ErrorsTab = 'problems' | 'sentinels' | 'types' | 'paths'

const SEVERITY_ICON = {
  error: <CircleAlert size={11} className="shrink-0 text-danger" aria-label="error" />,
  warning: <AlertTriangle size={11} className="shrink-0 text-warning" aria-label="warning" />,
  info: <Info size={11} className="shrink-0 text-info" aria-label="hint" />,
} as Record<string, ReactElement>

const RETURN_STYLE: Record<string, string> = {
  nil: 'bg-surface-3 text-text-3',
  wrap: 'bg-success/15 text-success',
  new: 'bg-info/15 text-info',
  sentinel: 'bg-accent/15 text-accent',
  typed: 'bg-accent/15 text-accent',
  propagate: 'bg-warning/15 text-warning',
  named: 'bg-surface-3 text-text-3',
  other: 'bg-surface-3 text-text-3',
}

function errorText(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem)
}

function openAt(location: GoIDEErrorLocation): void {
  void useGoIDEStore.getState().openLocation(location.relativePath, location.line, location.column)
}

function LocationLink({ location, label }: { location: GoIDEErrorLocation; label?: string }) {
  return (
    <button type="button" onClick={() => openAt(location)} className="shrink-0 font-mono text-[10px] text-text-3 underline decoration-border-2 underline-offset-2 hover:text-accent">
      {label ?? `${location.relativePath.split('/').pop()}:${location.line}`}
    </button>
  )
}

async function applyFix(finding: GoIDEErrorFinding): Promise<string | null> {
  if (!finding.fix) return null
  const document = await useGoIDEStore.getState().ensureDocumentLoaded(finding.location.relativePath)
  if (!document) return 'The file could not be opened.'
  const change = errorFixChange(finding.fix, finding.location.relativePath, document.buffer)
  if (!change) return 'The code changed since the analysis: run it again before applying this fix.'
  await applyGoStudioWorkspaceChange(change)
  return null
}

/** Error Handling Intelligence: problemi con fix, sentinel, tipi d'errore e percorsi di ritorno. */
export function GoStudioErrorsPanel({ session }: { session: GoIDESession }) {
  const sessionId = session.id
  const authorized = session.project.authorization === 'tooling-permitted'
  const [report, setReport] = useState<GoIDEErrorReport | null>(null)
  const [analyzedAt, setAnalyzedAt] = useState<Date | null>(null)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [tab, setTab] = useState<ErrorsTab>('problems')
  const [query, setQuery] = useState('')
  const [applied, setApplied] = useState<Set<GoIDEErrorFinding>>(new Set())
  const activePath = useGoIDEStore((state) => {
    const id = state.activeDocumentBySession[sessionId]
    return state.documents.find((item) => item.document.id === id)?.document.relativePath ?? ''
  })

  const analyze = async () => {
    setRunning(true)
    setMessage(null)
    try {
      setReport(await analyzeGoIDEErrorHandling(sessionId))
      setAnalyzedAt(new Date())
      setApplied(new Set())
    } catch (problem) {
      setMessage(errorText(problem))
    } finally {
      setRunning(false)
    }
  }
  const fix = async (finding: GoIDEErrorFinding) => {
    const problem = await applyFix(finding)
    setMessage(problem)
    if (!problem) setApplied((current) => new Set(current).add(finding))
  }

  const tabs: Array<[ErrorsTab, string]> = [
    ['problems', `Problems${report ? ` (${report.findings.length})` : ''}`],
    ['sentinels', `Sentinel errors${report ? ` (${report.sentinels.length})` : ''}`],
    ['types', `Error types${report ? ` (${report.types.length})` : ''}`],
    ['paths', 'Error paths'],
  ]

  return (
    <div className="flex h-full min-h-0 flex-col text-[11px]">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border-1 px-2 py-1">
        <button type="button" disabled={!authorized || running} onClick={() => void analyze()} title={authorized ? 'Load every module with go/packages and analyze error handling' : 'Trust the project to run go list'} className="flex h-6 items-center gap-1 rounded bg-accent px-2 font-semibold text-white hover:opacity-90 disabled:opacity-40">
          {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} aria-hidden="true" />} {report ? 'Analyze again' : 'Analyze'}
        </button>
        {report && <span className="text-text-4">{report.modules} module{report.modules === 1 ? '' : 's'}{analyzedAt ? ` · ${analyzedAt.toLocaleTimeString()}` : ''}</span>}
        {report && report.problems.length > 0 && <span className="text-warning" title={report.problems.join('\n')}>{report.problems.length} load problem{report.problems.length === 1 ? '' : 's'}: results may be partial</span>}
        <label className="ml-auto flex h-6 items-center gap-1 rounded border border-border-1 bg-surface-2 px-1.5">
          <Search size={10} className="text-text-4" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter" aria-label="Filter error analysis" className="w-36 bg-transparent text-text-1 outline-none placeholder:text-text-4" />
        </label>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border-1 px-2" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`border-b-2 px-2 py-1 ${tab === id ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-1'}`}>{label}</button>
        ))}
      </div>
      {message && <div className="shrink-0 border-b border-warning/30 bg-warning/10 px-2 py-1 text-warning">{message}</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {!report ? (
          <p className="p-3 text-text-4">{running ? 'Loading packages and types…' : 'Analyze finds ignored, unhandled and shadowed errors, wrapping without %w, comparisons that miss wrapped errors, panic/recover misuse and suspicious nil, nil returns — and maps sentinel errors, error types and how each function returns its errors.'}</p>
        ) : tab === 'problems' ? <ProblemsView report={report} query={query} applied={applied} onFix={(finding) => void fix(finding)} />
          : tab === 'sentinels' ? <SentinelsView report={report} query={query} />
            : tab === 'types' ? <TypesView report={report} query={query} />
              : <PathsView report={report} activePath={activePath} query={query} />}
      </div>
    </div>
  )
}

function ProblemsView({ report, query, applied, onFix }: { report: GoIDEErrorReport; query: string; applied: Set<GoIDEErrorFinding>; onFix: (finding: GoIDEErrorFinding) => void }) {
  const groups = useMemo(() => groupErrorFindings(report.findings, query), [report.findings, query])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['discarded', 'panic', 'lost-context']))
  if (!groups.length) return <p className="p-3 text-success">No error handling problems{query ? ' match the filter' : ''}.</p>
  return (
    <div className="py-1">
      {groups.map((group) => {
        const open = !collapsed.has(group.kind)
        return (
          <section key={group.kind}>
            <button type="button" onClick={() => setCollapsed((current) => { const next = new Set(current); if (open) next.add(group.kind); else next.delete(group.kind); return next })} title={group.hint} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-3">
              {open ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
              {SEVERITY_ICON[group.severity]}
              <span className="font-semibold text-text-1">{group.title}</span>
              <span className="rounded-full bg-surface-3 px-1.5 text-[10px] text-text-3">{group.findings.length}</span>
              <span className="truncate text-[10px] text-text-4">{group.hint}</span>
            </button>
            {open && group.findings.map((finding, index) => (
              <div key={index} className="group flex items-center gap-2 py-0.5 pl-8 pr-2 hover:bg-surface-2">
                <LocationLink location={finding.location} />
                <span className="min-w-0 flex-1 truncate text-text-2" title={finding.message}>{finding.function && <span className="font-mono text-text-3">{finding.function} · </span>}{finding.message}</span>
                {finding.fix && (applied.has(finding)
                  ? <span className="shrink-0 text-[10px] text-success">Applied</span>
                  : <button type="button" onClick={() => onFix(finding)} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-accent hover:bg-accent/10"><Wand2 size={10} aria-hidden="true" /> {finding.fix.label}</button>)}
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

function RefList({ refs }: { refs: GoIDEErrorReport['sentinels'][number]['refs'] }) {
  if (!refs.length) return <p className="pl-8 text-text-4">No uses found.</p>
  return (
    <ul className="pl-8">
      {refs.map((ref, index) => (
        <li key={index} className="flex items-center gap-2 py-0.5">
          <span className="w-14 shrink-0 rounded bg-surface-3 px-1 text-center text-[10px] text-text-3">{ref.kind}</span>
          <LocationLink location={ref.location} label={`${ref.location.relativePath}:${ref.location.line}`} />
          {ref.function && <span className="truncate font-mono text-[10px] text-text-4">{ref.function}</span>}
        </li>
      ))}
    </ul>
  )
}

function matches(query: string, ...values: Array<string | undefined>): boolean {
  const needle = query.trim().toLowerCase()
  return !needle || values.some((value) => value?.toLowerCase().includes(needle))
}

function SentinelsView({ report, query }: { report: GoIDEErrorReport; query: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const sentinels = report.sentinels.filter((item) => matches(query, item.name, item.package, item.message))
  if (!sentinels.length) return <p className="p-3 text-text-4">No package-level error variables{query ? ' match the filter' : ''}.</p>
  return (
    <div className="py-1">
      {sentinels.map((sentinel) => {
        const key = `${sentinel.package}.${sentinel.name}`
        const checks = sentinel.refs.filter((ref) => ref.kind === 'is' || ref.kind === 'compare' || ref.kind === 'case').length
        return (
          <section key={key}>
            <button type="button" onClick={() => setOpen(open === key ? null : key)} className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-surface-3">
              {open === key ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
              <span className="font-mono font-semibold text-text-1">{sentinel.name}</span>
              {sentinel.message && <span className="truncate text-text-3">"{sentinel.message}"</span>}
              <span className="ml-auto shrink-0 text-[10px] text-text-4">{sentinel.refs.length} uses · {checks} checks · {sentinel.package}</span>
              <LocationLink location={sentinel.location} />
            </button>
            {open === key && <RefList refs={sentinel.refs} />}
          </section>
        )
      })}
    </div>
  )
}

function TypesView({ report, query }: { report: GoIDEErrorReport; query: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const types = report.types.filter((item) => matches(query, item.name, item.package, ...item.wraps))
  if (!types.length) return <p className="p-3 text-text-4">No custom error types{query ? ' match the filter' : ''}.</p>
  return (
    <div className="py-1">
      {types.map((type) => {
        const key = `${type.package}.${type.name}`
        return (
          <section key={key}>
            <button type="button" onClick={() => setOpen(open === key ? null : key)} className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-surface-3">
              {open === key ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
              <span className="font-mono font-semibold text-text-1">{type.pointer ? '*' : ''}{type.name}</span>
              {type.unwrap && <span className="rounded bg-success/15 px-1 text-[10px] text-success" title="Has Unwrap: errors.Is/As look inside">Unwrap</span>}
              {type.is && <span className="rounded bg-info/15 px-1 text-[10px] text-info">Is</span>}
              {type.as && <span className="rounded bg-info/15 px-1 text-[10px] text-info">As</span>}
              <span className="ml-auto shrink-0 text-[10px] text-text-4">{type.refs.length} uses · {type.package}</span>
              <LocationLink location={type.location} />
            </button>
            {open === key && (
              <div className="pb-1">
                {type.wraps.length > 0 && <ul className="pl-8">{type.wraps.map((wrap) => <li key={wrap} className="py-0.5 font-mono text-[10px] text-text-2">└ {wrap}</li>)}</ul>}
                {type.wraps.length > 0 && !type.unwrap && <p className="pl-8 text-[10px] text-warning">Holds an error but has no Unwrap method: errors.Is and errors.As stop here.</p>}
                <RefList refs={type.refs} />
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function PathsView({ report, activePath, query }: { report: GoIDEErrorReport; activePath: string; query: string }) {
  const files = useMemo(() => [...new Set(report.paths.map((path) => path.location.relativePath))].sort(), [report.paths])
  const [chosen, setChosen] = useState('')
  const file = chosen || (files.includes(activePath) ? activePath : files[0] ?? '')
  const paths = errorPathsForFile(report, file).filter((path) => matches(query, path.function, ...path.returns.map((ret) => ret.detail)))
  return (
    <div className="py-1">
      <div className="flex items-center gap-2 px-2 pb-1 text-text-3">
        <span>File</span>
        <select value={file} onChange={(event) => setChosen(event.target.value)} className="h-6 min-w-0 max-w-[24rem] rounded border border-border-1 bg-surface-2 px-1 font-mono text-text-1" aria-label="File">
          {files.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        {chosen && chosen !== activePath && files.includes(activePath) && <button type="button" onClick={() => setChosen('')} className="text-accent hover:underline">Follow editor</button>}
      </div>
      {!paths.length && <p className="px-2 text-text-4">No functions returning an error here.</p>}
      {paths.map((path) => (
        <section key={`${path.function}:${path.location.line}`} className="border-t border-border-1 px-2 py-1">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => openAt(path.location)} className="font-mono font-semibold text-text-1 hover:text-accent">{path.function}</button>
            <span className="text-[10px] text-text-4">{returnKindCounts(path).map(([kind, count]) => `${count} ${kind}`).join(' · ')}</span>
          </div>
          <ol className="mt-0.5 border-l border-border-2 pl-3">
            {path.returns.map((ret, index) => (
              <li key={index} className="flex items-center gap-2 py-0.5">
                <span className={`w-16 shrink-0 rounded px-1 text-center text-[10px] ${RETURN_STYLE[ret.kind] ?? RETURN_STYLE.other}`}>{ret.kind}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-text-2">{ret.detail}</span>
                <LocationLink location={ret.location} label={`:${ret.location.line}`} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

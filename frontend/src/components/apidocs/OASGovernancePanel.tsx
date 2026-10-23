import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Filter, Loader2, Play, Settings2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { lintOpenAPI, type OASLintFinding, type OASLintSeverity } from '@/lib/oaslint-api'

const RULESET_KEY = 'adomnia.oaslint.ruleset'
const NO_FINDINGS: OASLintFinding[] = []
const DEFAULT_RULESET = '{\n  "rules": {}\n}'

export function OASGovernancePanel({ rawSpec, onOpenOperation }: { rawSpec: string; onOpenOperation: (finding: OASLintFinding) => void }) {
  const [result, setResult] = useState<{ rawSpec: string; ruleset: string; findings: OASLintFinding[]; error: string } | null>(null)
  const [ruleset, setRuleset] = useState(() => localStorage.getItem(RULESET_KEY) ?? DEFAULT_RULESET)
  const [appliedRuleset, setAppliedRuleset] = useState(ruleset)
  const [severity, setSeverity] = useState<'all' | OASLintSeverity>('all')
  const [query, setQuery] = useState('')
  const [rulesetError, setRulesetError] = useState('')

  useEffect(() => {
    let cancelled = false
    void lintOpenAPI(rawSpec, appliedRuleset)
      .then((items) => { if (!cancelled) setResult({ rawSpec, ruleset: appliedRuleset, findings: items, error: '' }) })
      .catch((reason: unknown) => {
        if (!cancelled) setResult((prev) => ({ rawSpec, ruleset: appliedRuleset, findings: prev?.findings ?? [], error: reason instanceof Error ? reason.message : String(reason) }))
      })
    return () => { cancelled = true }
  }, [rawSpec, appliedRuleset])

  // Derived: a lint run is in flight until the stored result matches the current inputs.
  const settled = result !== null && result.rawSpec === rawSpec && result.ruleset === appliedRuleset
  const loading = !settled
  const findings = result?.findings ?? NO_FINDINGS
  const error = rulesetError || (settled ? result.error : '')

  const counts = useMemo(() => ({
    error: findings.filter((finding) => finding.severity === 'error').length,
    warn: findings.filter((finding) => finding.severity === 'warn').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
  }), [findings])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const seen = new Map<string, number>()
    return findings.flatMap((finding) => {
      if (severity !== 'all' && finding.severity !== severity) return []
      if (needle && ![finding.ruleId, finding.message, finding.path, finding.method, finding.operationId].some((value) => value?.toLowerCase().includes(needle))) return []
      const base = `${finding.ruleId}-${finding.location}`
      const occurrence = seen.get(base) ?? 0
      seen.set(base, occurrence + 1)
      return [{ finding, key: `${base}-${occurrence}` }]
    })
  }, [findings, query, severity])

  const applyRuleset = () => {
    try {
      JSON.parse(ruleset)
      localStorage.setItem(RULESET_KEY, ruleset)
      setAppliedRuleset(ruleset)
      setRulesetError('')
    } catch {
      setRulesetError('Ruleset must be valid JSON.')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 bg-surface-0">
      <aside className="w-72 shrink-0 border-r border-border-1 bg-surface-1 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-text-2"><Settings2 size={13} /> Local ruleset</div>
        <textarea value={ruleset} onChange={(event) => setRuleset(event.target.value)} spellCheck={false} className="h-52 w-full resize-none rounded border border-border-2 bg-surface-0 p-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent" />
        <button onClick={applyRuleset} className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded bg-accent text-xs font-semibold text-white hover:bg-accent-hover">
          <Play size={12} /> Apply and run
        </button>
        <p className="mt-2 text-[10px] leading-relaxed text-text-4">Stored locally. Use rule IDs from the findings list with severity `error`, `warn`, `info`, or `off`.</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border-1 px-4 py-3">
          <StatusBadge label="Errors" count={counts.error} tone="error" />
          <StatusBadge label="Warnings" count={counts.warn} tone="warn" />
          <StatusBadge label="Info" count={counts.info} tone="info" />
          {!loading && findings.length === 0 && !error && <span className="ml-1 flex items-center gap-1.5 text-xs text-success"><CheckCircle2 size={14} /> Governance passed</span>}
          {loading && <Loader2 size={14} className="ml-auto animate-spin text-text-4" />}
        </div>
        <div className="flex items-center gap-2 border-b border-border-1 px-4 py-2">
          <Filter size={13} className="text-text-4" />
          <select value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)} className="h-7 rounded border border-border-2 bg-surface-1 px-2 text-[11px] text-text-2">
            <option value="all">All severities</option><option value="error">Errors</option><option value="warn">Warnings</option><option value="info">Info</option>
          </select>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by rule, path, operation..." className="h-7 min-w-0 flex-1 rounded border border-border-2 bg-surface-1 px-2 text-[11px] text-text-1 outline-none focus:border-accent" />
          <span className="text-[10px] text-text-4">{visible.length} findings</span>
        </div>
        {error && <div className="m-4 flex items-center gap-2 rounded border border-error/30 bg-error/10 p-3 text-xs text-error"><AlertCircle size={14} /> {error}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.map(({ finding, key }) => (
            <button key={key} onClick={() => onOpenOperation(finding)} disabled={!finding.path || !finding.method} className="grid w-full grid-cols-[72px_180px_1fr_180px] items-start gap-3 border-b border-border-1 px-4 py-3 text-left hover:bg-surface-1 disabled:cursor-default">
              <SeverityBadge severity={finding.severity} />
              <span className="font-mono text-[11px] text-text-2">{finding.ruleId}</span>
              <span className="text-[11px] leading-relaxed text-text-2">{finding.message}</span>
              <span className="truncate font-mono text-[10px] text-text-4">{finding.method ? `${finding.method} ` : ''}{finding.path || finding.location}</span>
            </button>
          ))}
          {!loading && !error && visible.length === 0 && findings.length > 0 && <p className="p-8 text-center text-xs text-text-4">No findings match these filters.</p>}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ label, count, tone }: { label: string; count: number; tone: 'error' | 'warn' | 'info' }) {
  const classes = tone === 'error' ? 'border-error/30 bg-error/10 text-error' : tone === 'warn' ? 'border-warning/30 bg-warning/10 text-warning' : 'border-border-2 bg-surface-2 text-text-3'
  return <span className={cn('rounded border px-2 py-1 text-[11px] font-medium', classes)}>{label} {count}</span>
}

function SeverityBadge({ severity }: { severity: OASLintSeverity }) {
  const classes = severity === 'error' ? 'text-error' : severity === 'warn' ? 'text-warning' : 'text-text-3'
  return <span className={cn('flex items-center gap-1 text-[10px] font-semibold uppercase', classes)}><TriangleAlert size={11} /> {severity}</span>
}

import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, BookmarkCheck, Copy, FileCode2, Info, Loader2, Search, ShieldAlert, ShieldCheck, ShieldQuestion, Undo2 } from 'lucide-react'
import {
  clearGoIDESecurityBaseline, saveGoIDESecurityBaseline, scanGoIDESecurity, suppressGoIDESecurityFinding, unsuppressGoIDESecurityFinding,
  type GoIDESecurityFinding, type GoIDESecurityReport, type GoIDESession,
} from '@/lib/goide-api'
import { confirm } from '@/lib/confirmDialog'
import { useGoIDEStore } from '@/stores/goide'
import { GoStudioPerfExport } from './GoStudioPerfExport'
import { VizSegmented } from './GoStudioVizKit'
import {
  DEFAULT_SECURITY_FILTER, SECURITY_SEVERITIES, filterFindings, groupByCategory, inlineSuppressionComment, ruleOf, securityReportToMarkdown, summarize,
  type SecurityFilter, type SecuritySeverity,
} from './goStudioCodeSecurity'

const SECURITY_PROMPT = 'Review these static security findings in my Go project. For each one confirm whether it is real, explain the risk and propose a concrete fix with file:line references.\n\n'

const SEVERITY_STYLE: Record<SecuritySeverity, { tone: string; icon: typeof ShieldAlert; label: string }> = {
  high: { tone: 'bg-danger/12 text-danger', icon: ShieldAlert, label: 'High' },
  medium: { tone: 'bg-warning/15 text-warning', icon: AlertTriangle, label: 'Medium' },
  low: { tone: 'bg-surface-3 text-text-3', icon: ShieldQuestion, label: 'Low' },
}

function SeverityBadge({ severity }: { severity: string }) {
  const style = SEVERITY_STYLE[severity as SecuritySeverity] ?? SEVERITY_STYLE.low
  const Icon = style.icon
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-[10.5px] font-medium ${style.tone}`}><Icon size={11} />{style.label}</span>
}

function openFinding(finding: GoIDESecurityFinding): void {
  void useGoIDEStore.getState().openLocation(finding.file, finding.line || 1, finding.column || 1)
}

/** Analisi statica offline del codice: segreti, TLS, crypto, injection, permessi; soppressioni motivate e baseline. */
export function GoStudioCodeSecurityView({ session, lead }: { session: GoIDESession; lead?: ReactNode }) {
  const [report, setReport] = useState<GoIDESecurityReport | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState<SecurityFilter>(DEFAULT_SECURITY_FILTER)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const visible = useMemo(() => (report ? filterFindings(report.findings, filter) : []), [report, filter])
  const summary = useMemo(() => summarize(report?.findings ?? []), [report])
  const current = visible.find((finding) => finding.fingerprint === selected) ?? visible[0] ?? null

  const scan = async (keepSelection = false) => {
    setScanning(true)
    try {
      const result = await scanGoIDESecurity(session.id)
      setReport(result)
      if (!keepSelection) setSelected(null)
      setError(null)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Security scan failed')
    } finally {
      setScanning(false)
    }
  }

  const act = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action()
      setNotice(message)
      await scan(true)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Action failed')
    }
  }

  const saveBaseline = async () => {
    const accepted = await confirm({ title: 'Accept current findings as baseline?', message: `${summary.active.high + summary.active.medium + summary.active.low} active findings will be hidden until they change; only new ones will show. The baseline is saved in .adomnia/security.json and can be committed.`, confirmLabel: 'Save baseline' })
    if (accepted) await act(async () => saveGoIDESecurityBaseline(session.id), 'Baseline saved: only new findings are shown now.')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="go-studio-tool-header flex-wrap gap-2">
        {lead ?? <span className="go-studio-tool-title">Code security</span>}
        <button type="button" onClick={() => void scan()} disabled={scanning} className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-accent px-3 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60">
          {scanning ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}{scanning ? 'Scanning…' : report ? 'Scan again' : 'Scan code'}
        </button>
        <span className="flex items-center gap-1 text-[11px] text-text-4" title="Reads the project files only: no network, no processes."><Info size={11} />Offline</span>
        {report && (
          <span className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => void saveBaseline()} title="Hide the current findings until they change" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-text-3 hover:bg-surface-3 hover:text-text-1"><BookmarkCheck size={13} />Save baseline</button>
            {summary.baselined > 0 && <button type="button" onClick={() => void act(async () => clearGoIDESecurityBaseline(session.id), 'Baseline cleared: every finding is visible again.')} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-text-3 hover:bg-surface-3 hover:text-text-1"><Undo2 size={13} />Clear baseline</button>}
            <GoStudioPerfExport fileName="security-review.md" prompt={SECURITY_PROMPT} build={() => securityReportToMarkdown(report, session.project.name)} />
          </span>
        )}
      </div>

      {error && <p className="border-b border-danger/30 bg-danger/10 px-3 py-1.5 text-[11.5px] text-danger">{error}</p>}
      {notice && <p className="border-b border-accent/25 bg-accent/10 px-3 py-1.5 text-[11.5px] text-text-2">{notice}</p>}

      {!report && !scanning && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-text-4">
          <ShieldCheck size={24} />
          <p className="max-w-lg text-[12.5px]">Finds hardcoded secrets and private keys, disabled TLS verification, weak crypto, SQL and shell injection, path traversal and zip slip, risky deserialization and world-writable files. It reads your files offline; nothing leaves the machine.</p>
        </div>
      )}

      {report && (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border-1 px-3 py-2">
            {SECURITY_SEVERITIES.map((severity) => {
              const style = SEVERITY_STYLE[severity.id]
              const Icon = style.icon
              return <span key={severity.id} className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] ${style.tone}`}><Icon size={12} />{severity.label}<span className="font-mono font-semibold">{summary.active[severity.id]}</span></span>
            })}
            <span className="text-[11px] text-text-4">{report.filesScanned} files · {summary.suppressed} suppressed · {summary.baselined} in baseline{report.truncated ? ' · truncated' : ''}</span>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <VizSegmented label="Severity" value={filter.severity} onChange={(severity) => setFilter({ ...filter, severity })} segments={[{ id: 'all', label: 'All' }, ...SECURITY_SEVERITIES]} />
              <label className="flex h-7 w-44 items-center gap-2 rounded-lg bg-[var(--gs-ground)] px-2.5 text-text-4 focus-within:ring-1 focus-within:ring-accent">
                <Search size={12} />
                <input value={filter.query} onChange={(event) => setFilter({ ...filter, query: event.target.value })} placeholder="Filter rule or file" aria-label="Filter findings" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-text-2 outline-none" />
              </label>
              <label className="flex items-center gap-1.5 text-[11.5px] text-text-3"><input type="checkbox" checked={filter.showSuppressed} onChange={(event) => setFilter({ ...filter, showSuppressed: event.target.checked })} className="h-[14px] w-[14px] accent-[var(--color-accent)]" />Suppressed</label>
              <label className="flex items-center gap-1.5 text-[11.5px] text-text-3"><input type="checkbox" checked={filter.showBaselined} onChange={(event) => setFilter({ ...filter, showBaselined: event.target.checked })} className="h-[14px] w-[14px] accent-[var(--color-accent)]" />Baseline</label>
            </span>
          </div>

          {visible.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <ShieldCheck size={26} className="text-success" />
              <p className="text-[13px] font-medium text-text-1">{report.findings.length === 0 ? 'No security findings in this project.' : 'No findings match the filters.'}</p>
              {report.findings.length > 0 && <p className="text-[11.5px] text-text-4">Reviewed findings are hidden: tick Suppressed or Baseline to see them.</p>}
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.95fr)_minmax(0,1.5fr)] max-lg:grid-cols-1">
              <div role="listbox" aria-label="Security findings" className="min-h-0 overflow-auto border-r border-border-1 p-1.5">
                {groupByCategory(visible).map((group) => (
                  <section key={group.category} className="mb-2">
                    <h4 className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">{group.category} · {group.findings.length}</h4>
                    {group.findings.map((finding) => (
                      <button key={finding.fingerprint + finding.line} type="button" role="option" aria-selected={current?.fingerprint === finding.fingerprint} onClick={() => setSelected(finding.fingerprint)} className={`mb-1 block w-full rounded-lg px-2.5 py-1.5 text-left ${current?.fingerprint === finding.fingerprint ? 'bg-accent/10 shadow-[inset_0_0_0_1px_var(--color-border-2)]' : 'hover:bg-surface-2/60'} ${finding.suppressed || finding.baselined ? 'opacity-60' : ''}`}>
                        <span className="flex items-center gap-2"><span className="min-w-0 truncate text-[12px] font-medium text-text-1">{finding.title}</span><span className="ml-auto"><SeverityBadge severity={finding.severity} /></span></span>
                        <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-text-4"><span className="truncate">{finding.file}:{finding.line}</span>{finding.suppressed && <span className="shrink-0 rounded bg-surface-3 px-1 text-[9.5px]">suppressed</span>}{finding.baselined && !finding.suppressed && <span className="shrink-0 rounded bg-surface-3 px-1 text-[9.5px]">baseline</span>}</span>
                      </button>
                    ))}
                  </section>
                ))}
              </div>
              {current && <FindingDetail key={current.fingerprint} report={report} finding={current}
                onSuppress={(reason) => void act(async () => suppressGoIDESecurityFinding(session.id, current, reason), 'Finding suppressed: the reason is saved in .adomnia/security.json.')}
                onUnsuppress={() => void act(async () => unsuppressGoIDESecurityFinding(session.id, current.fingerprint), 'Suppression removed.')} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FindingDetail({ report, finding, onSuppress, onUnsuppress }: { report: GoIDESecurityReport; finding: GoIDESecurityFinding; onSuppress: (reason: string) => void; onUnsuppress: () => void }) {
  const [reason, setReason] = useState('')
  const rule = ruleOf(report, finding.rule)
  return (
    <div className="min-h-0 overflow-auto p-4 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-semibold text-text-1">{finding.title}</h3>
        <SeverityBadge severity={finding.severity} />
        <span className="rounded-md bg-surface-3 px-1.5 py-px font-mono text-[10.5px] text-text-3">{finding.rule}</span>
      </div>
      <p className="mt-1.5 text-[12.5px] text-text-2">{finding.message}</p>
      <button type="button" onClick={() => openFinding(finding)} className="mt-3 flex w-full items-center gap-2 rounded-lg bg-[var(--gs-ground)] px-2.5 py-2 text-left hover:bg-surface-2/70" title="Open in the editor">
        <FileCode2 size={13} className="shrink-0 text-accent" />
        <span className="shrink-0 font-mono text-[11px] text-text-3">{finding.file}:{finding.line}</span>
        {finding.snippet && <code className="min-w-0 truncate font-mono text-[11.5px] text-text-1">{finding.snippet}</code>}
      </button>
      {rule && (
        <>
          <Section title="Why it matters"><p className="text-[12px] leading-5 text-text-2">{rule.description}</p></Section>
          <Section title="How to fix"><p className="text-[12px] leading-5 text-text-2">{rule.remediation}</p></Section>
        </>
      )}
      <Section title="Suppression">
        {finding.suppressed ? (
          <div className="rounded-lg bg-[var(--gs-ground)] p-2.5">
            <p className="text-[11.5px] text-text-2"><span className="text-text-4">Reason:</span> {finding.suppressionReason}</p>
            {finding.suppressedInline
              ? <p className="mt-1 text-[11px] text-text-4">Suppressed by a comment in the code: remove the comment to bring it back.</p>
              : <button type="button" onClick={onUnsuppress} className="mt-2 inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-text-3 hover:bg-surface-3 hover:text-text-1"><Undo2 size={12} />Remove suppression</button>}
          </div>
        ) : (
          <div className="rounded-lg bg-[var(--gs-ground)] p-2.5">
            <label className="text-[11px] text-text-4" htmlFor="security-reason">Why is this acceptable? The reason is required and is saved with the project.</label>
            <textarea id="security-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} placeholder="e.g. MD5 is only a cache key, not used for passwords or signatures" className="mt-1.5 w-full resize-y rounded-md border border-border-1 bg-[var(--gs-island)] px-2 py-1.5 text-[12px] text-text-1 outline-none focus:border-accent" />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <button type="button" disabled={!reason.trim()} onClick={() => onSuppress(reason)} className="inline-flex h-7 items-center rounded-md bg-accent/15 px-2.5 text-[11.5px] font-medium text-accent hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-50">Suppress with reason</button>
              <button type="button" onClick={() => void navigator.clipboard.writeText(inlineSuppressionComment(finding.rule, reason))} title="Copy a comment to put on the line above, to suppress it in the code" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-text-3 hover:bg-surface-3 hover:text-text-1"><Copy size={12} />Copy inline comment</button>
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h4 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">{title}</h4>
      {children}
    </section>
  )
}

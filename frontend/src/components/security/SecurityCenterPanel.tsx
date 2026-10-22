import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Ban, Download, Search } from 'lucide-react'
import './securityCenter.css'
import { cn } from '@/lib/utils'
import { saveTextFile } from '@/lib/fileUtils'
import { confirm } from '@/lib/confirmDialog'
import { govulncheckInstallPlan, installGovulncheck, isStrixActive, strixStatus } from '@/lib/strix-api'
import {
  exportSecurityReport,
  scanWorkspaceSecurity,
  type SecurityBand,
  type SecurityEcosystem,
  type SecurityExportFormatId,
  type SecurityFinding,
  type SecurityScanReport,
} from '@/lib/securityIntel-api'
import { SecurityFindingInspector } from './SecurityFindingInspector'
import { SecurityProjectPicker } from './SecurityProjectPicker'
import { SecurityStrixPanel } from './SecurityStrixPanel'

/**
 * Security Center: adOmnia Security Intelligence per tutto il workspace.
 *
 * La dashboard non mostra solo le CVE: mostra quanto il progetto è realmente esposto,
 * quanto è urgente intervenire e come correggere senza rompere il codice. Ogni priorità
 * è spiegata: nessun numero magico, i segnali restano separati.
 */

const BAND_STYLES: Record<SecurityBand, { label: string; chip: string; dot: string }> = {
  critical: {
    label: 'CRITICAL',
    chip: 'bg-error/15 text-error border-error/30',
    dot: 'bg-error',
  },
  high: {
    label: 'HIGH',
    chip: 'bg-warning/15 text-warning border-warning/30',
    dot: 'bg-warning',
  },
  medium: {
    label: 'MEDIUM',
    chip: 'bg-info/15 text-info border-info/30',
    dot: 'bg-info',
  },
  low: {
    label: 'LOW',
    chip: 'bg-success/15 text-success border-success/30',
    dot: 'bg-success',
  },
  informational: {
    label: 'INFO',
    chip: 'bg-surface-3 text-text-3 border-border-2',
    dot: 'bg-text-3',
  },
}

const REACHABILITY_LABELS: Record<string, string> = {
  called: 'Called',
  potentiallyReachable: 'Potentially reachable',
  imported: 'Imported',
  required: 'Required only',
  notReachable: 'Not reachable',
  unknown: 'Not analyzed',
}

const ECOSYSTEM_META: Record<SecurityEcosystem, { title: string; subtitle: string }> = {
  Maven: { title: 'Java / Maven', subtitle: 'pom.xml · effective dependencies' },
  Go: { title: 'Go Modules', subtitle: 'go.mod / go.work · minimal version selection' },
  PyPI: { title: 'Python / PyPI', subtitle: 'pyproject.toml · requirements · poetry/uv lock' },
}

const EXPORTS: Array<{ id: SecurityExportFormatId; label: string; mime: string }> = [
  { id: 'markdown', label: 'Markdown report', mime: 'text/markdown' },
  { id: 'json', label: 'JSON report', mime: 'application/json' },
  { id: 'html', label: 'HTML report', mime: 'text/html' },
  { id: 'sarif', label: 'SARIF 2.1.0', mime: 'application/json' },
  { id: 'cyclonedx', label: 'CycloneDX SBOM', mime: 'application/json' },
  { id: 'spdx', label: 'SPDX SBOM', mime: 'application/json' },
  { id: 'vex', label: 'CycloneDX VEX', mime: 'application/json' },
]

const BAND_ORDER: SecurityBand[] = ['critical', 'high', 'medium', 'low', 'informational']

export function SecurityCenterPanel() {
  const [report, setReport] = useState<SecurityScanReport | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState('')
  const [offline, setOffline] = useState(false)
  const [allowProcesses, setAllowProcesses] = useState(false)
  const [query, setQuery] = useState('')
  const [band, setBand] = useState<SecurityBand | 'all'>('all')
  const [ecosystem, setEcosystem] = useState<SecurityEcosystem | 'all'>('all')
  const [hideIgnored, setHideIgnored] = useState(true)
  const [selected, setSelected] = useState<SecurityFinding | null>(null)
  const [view, setView] = useState<'dependencies' | 'strix'>('dependencies')
  const [exportOpen, setExportOpen] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const exportMenu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Il Security Center analizza una cartella di progetto: si propone la cartella di
    // lavoro corrente e la si può cambiare incollando un percorso.
    setWorkspace((current) => current || '')
  }, [])

  useEffect(() => {
    if (!exportOpen) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) { if (event.key === 'Escape') setExportOpen(false); return }
      if (!exportMenu.current?.contains(event.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [exportOpen])

  const runScan = useCallback(async (forceDeep: boolean) => {
    if (!workspace.trim()) {
      setError('Select the project folder to scan.')
      return
    }
    setScanning(true)
    setError(null)
    try {
      const result = await scanWorkspaceSecurity(workspace.trim(), {
        offline,
        allowProcesses: allowProcesses || forceDeep,
        includePluginDependencies: true,
      })
      setReport(result)
      setSelected(null)
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause))
    } finally {
      setScanning(false)
    }
  }, [workspace, offline, allowProcesses])

  const scan = useCallback(() => runScan(false), [runScan])

  // govulncheck compilato con un Go più vecchio di quello del progetto non legge i package: si ricompila (con consenso)
  // e la scansione riparte con l'analisi approfondita.
  const rebuildGovulncheck = useCallback(async () => {
    try {
      const plan = await govulncheckInstallPlan()
      const approved = await confirm({ title: 'Rebuild govulncheck?', message: `${plan.note}

Command: ${plan.command}`, confirmLabel: 'Rebuild' })
      if (!approved) return
      setRebuilding(true); setError(null)
      let run = await installGovulncheck()
      while (isStrixActive(run.state) || run.state === 'running') {
        await new Promise((resolve) => window.setTimeout(resolve, 1500))
        run = await strixStatus(run.id, 0)
        if (run.state !== 'running' && run.state !== 'preparing') break
      }
      if (run.state !== 'finished') throw new Error(run.error || run.output.slice(-3).join(' ') || 'govulncheck could not be rebuilt')
      setAllowProcesses(true)
      await runScan(true)
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause))
    } finally {
      setRebuilding(false)
    }
  }, [runScan])

  const reachabilityErrors = useMemo(
    () => (report?.units ?? []).flatMap((unit) => (unit.errors ?? []).filter((text) => text.startsWith('Reachability analysis failed'))),
    [report],
  )

  const exportReport = useCallback(
    async (format: SecurityExportFormatId, mime: string) => {
      if (!report) return
      try {
        const content = await exportSecurityReport(report, format)
        const stamp = report.scannedAt.slice(0, 10) || 'report'
        const extension = format === 'html' ? '.html' : format === 'sarif' ? '.sarif' : format === 'markdown' ? '.md' : '.json'
        await saveTextFile(`adomnia-security-${stamp}${extension}`, content, mime)
      } catch (cause) {
        setError(String(cause instanceof Error ? cause.message : cause))
      }
    },
    [report],
  )

  const filtered = useMemo(() => {
    if (!report) return []
    const needle = query.trim().toLowerCase()
    return report.findings.filter((finding) => {
      if (hideIgnored && finding.ignored) return false
      if (band !== 'all' && finding.risk.band !== band) return false
      if (ecosystem !== 'all' && finding.component.ecosystem !== ecosystem) return false
      if (!needle) return true
      return (
        finding.advisory.id.toLowerCase().includes(needle) ||
        (finding.advisory.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle)) ||
        finding.component.name.toLowerCase().includes(needle) ||
        (finding.advisory.summary ?? '').toLowerCase().includes(needle)
      )
    })
  }, [report, query, band, ecosystem, hideIgnored])

  const byEcosystem = useMemo(() => {
    const counts = new Map<SecurityEcosystem, { total: number; critical: number; high: number }>()
    for (const finding of report?.findings ?? []) {
      const key = finding.component.ecosystem
      const entry = counts.get(key) ?? { total: 0, critical: 0, high: 0 }
      entry.total += finding.ignored ? 0 : 1
      if (finding.risk.band === 'critical') entry.critical += 1
      if (finding.risk.band === 'high') entry.high += 1
      counts.set(key, entry)
    }
    return counts
  }, [report])

  const summary = report?.summary
  const dependencyView = view === 'dependencies'
  const everyUnknown = !!report && report.findings.length > 0 && report.findings.every((finding) => finding.reachability === 'unknown')

  return (
    <div className="sec">
      <header className="sec-head sec-tabs-rule">
        <h1 className="sec-title">Security</h1>
        <div role="tablist" aria-label="Security tools" className="sec-tabs">
          <button type="button" role="tab" className="sec-tab" aria-selected={dependencyView} onClick={() => setView('dependencies')}>Dependencies</button>
          <button type="button" role="tab" className="sec-tab" aria-selected={!dependencyView} onClick={() => setView('strix')}>Pentest · Strix</button>
        </div>
      </header>

      {dependencyView && (
        <div className="sec-bar">
          <SecurityProjectPicker value={workspace} onChange={setWorkspace} className="min-w-[340px] flex-1" />
          <button type="button" className="sec-switch" aria-pressed={offline} onClick={() => setOffline((value) => !value)} title="Offline: only the local advisory database is consulted">Offline</button>
          <button type="button" className="sec-switch" aria-pressed={allowProcesses} onClick={() => setAllowProcesses((value) => !value)} title="Deep analysis lets adOmnia run govulncheck (and mvn) on this machine to find out which vulnerable code your project really calls">Deep analysis</button>
          <label className="sec-field">
            <Search size={13} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter" aria-label="Filter findings" className="w-32" />
          </label>
          <div ref={exportMenu} className="relative">
            <button type="button" className="sec-btn" disabled={!report} aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((open) => !open)}>
              <Download size={13} aria-hidden="true" /> Export
            </button>
            {exportOpen && (
              <div role="menu" className="sec-menu">
                {EXPORTS.map((entry) => (
                  <button key={entry.id} type="button" role="menuitem" onClick={() => { setExportOpen(false); void exportReport(entry.id, entry.mime) }}>{entry.label}</button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="sec-scan" onClick={scan} disabled={scanning} data-running={scanning}>
            <span className="sec-scan-label">{scanning ? 'Scanning' : 'Scan'}</span>
            <span className="sec-scan-dot" aria-hidden="true" />
          </button>
        </div>
      )}

      {error && (
        <div className="sec-error" role="alert">
          <AlertCircle size={13} aria-hidden="true" /><span>{error}</span>
          <button type="button" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      <div className={cn('min-h-0 flex-1', dependencyView && 'hidden')}>
        <SecurityStrixPanel initialProject={workspace} />
      </div>

      <div className={cn('sec-body', !dependencyView && 'hidden')}>
        {!report && !scanning && (
          <div className="sec-hero">
            <span className="sec-hero-mark" aria-hidden="true">···</span>
            <h2 className="sec-label">Know what you actually run</h2>
            <p>
              Scans pom.xml and go.mod against OSV and the Go Vulnerability Database, then tells you which vulnerable code your project
              really calls and how to fix it without breaking the build. Turn on Deep analysis for the reachability part.
            </p>
            <button type="button" className="sec-scan" onClick={scan}><span className="sec-scan-label">Scan</span><span className="sec-scan-dot" /></button>
          </div>
        )}

        {report && (
          <>
            {reachabilityErrors.map((text) => (
              <div key={text} className="sec-note" data-tone="warn">
                <span>{text}</span>
                {/govulncheck/i.test(text) && /mismatch|Go version|Loading packages/i.test(text) && (
                  <button type="button" className="sec-btn" disabled={rebuilding || scanning} onClick={() => void rebuildGovulncheck()}>
                    {rebuilding ? 'Rebuilding…' : 'Rebuild govulncheck'}
                  </button>
                )}
              </div>
            ))}
            {everyUnknown && reachabilityErrors.length === 0 && (
              <div className="sec-note" data-tone="accent">
                <span>
                  <b>Reachability not analyzed.</b>{' '}
                  {allowProcesses
                    ? 'Deep analysis is on: scan again to find out which vulnerable code your project really calls.'
                    : 'Deep analysis is off, so adOmnia could not check which vulnerable code your project really calls.'}
                </span>
                <button type="button" className="sec-btn" disabled={scanning} onClick={() => { setAllowProcesses(true); void runScan(true) }}>
                  {allowProcesses ? 'Scan again' : 'Enable and scan'}
                </button>
              </div>
            )}

            <section className="sec-stats" aria-label="Summary">
              <Stat label="Findings" value={summary?.findings ?? 0} />
              <Stat label="Critical" value={summary?.critical ?? 0} tone="error" />
              <Stat label="High" value={summary?.high ?? 0} tone="warning" />
              <Stat label="Other" value={(summary?.medium ?? 0) + (summary?.low ?? 0) + (summary?.other ?? 0)} />
              <Stat label="Exploited" value={summary?.activelyExploited ?? 0} tone="error" />
              <Stat label="Reachable" value={summary?.reachable ?? 0} tone="warning" />
            </section>

            <section className="sec-section">
              <div className="sec-section-head">
                <h2 className="sec-label">Ecosystems</h2>
                <div className="sec-segs">
                  {(['Maven', 'Go', 'PyPI'] as SecurityEcosystem[]).map((ecosystemId) => (
                    <button key={ecosystemId} type="button" className="sec-seg" aria-pressed={ecosystem === ecosystemId}
                      title={ECOSYSTEM_META[ecosystemId].subtitle}
                      onClick={() => setEcosystem(ecosystem === ecosystemId ? 'all' : ecosystemId)}>
                      {ECOSYSTEM_META[ecosystemId].title}<b>{(byEcosystem.get(ecosystemId) ?? { total: 0 }).total}</b>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="sec-section">
              <div className="sec-section-head">
                <h2 className="sec-label">Findings</h2>
                <BandFilter active={band} onSelect={setBand} />
                <label className="sec-check">
                  <input type="checkbox" checked={hideIgnored} onChange={(event) => setHideIgnored(event.target.checked)} />
                  Hide suppressed
                </label>
              </div>
              <table className="sec-table">
                <thead>
                  <tr><th>Priority</th><th>Vulnerability</th><th>Component</th><th>Reachability</th><th>Signals</th><th>Fix</th></tr>
                </thead>
                <tbody>
                  {filtered.map((finding) => (
                    <FindingRow key={finding.id} finding={finding} onSelect={() => setSelected(finding)} active={selected?.id === finding.id} />
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={6} className="sec-empty">No findings match the current filters.</td></tr>}
                </tbody>
              </table>
            </section>

            {(report.sources ?? []).length > 0 && (
              <section className="sec-section">
                <div className="sec-section-head"><h2 className="sec-label">Sources</h2></div>
                <div className="sec-sources">
                  {(report.sources ?? []).map((source) => (
                    <span key={source.name} style={source.error ? { color: 'var(--color-error, #ff453a)' } : undefined}>
                      <b>{source.name}</b>
                      {source.lastUpdated && `updated ${source.lastUpdated.slice(0, 10)}`}
                      {source.offline && ' · local database'}
                      {source.error && ` · ${source.error}`}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {selected && report && (
        <SecurityFindingInspector
          finding={selected}
          report={report}
          workspace={report.workspace || workspace}
          scanOptions={{ offline, allowProcesses }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'error' | 'warning' }) {
  return (
    <div className="sec-stat" data-tone={tone}>
      <div className="sec-stat-value" data-nonzero={value > 0}>{value}</div>
      <div className="sec-stat-label">{label}</div>
    </div>
  )
}

function BandFilter({ active, onSelect }: { active: SecurityBand | 'all'; onSelect: (band: SecurityBand | 'all') => void }) {
  return (
    <div className="sec-segs">
      {(['all', ...BAND_ORDER] as Array<SecurityBand | 'all'>).map((value) => (
        <button key={value} type="button" className="sec-seg" aria-pressed={active === value} onClick={() => onSelect(value)}>
          {value === 'all' ? 'All' : BAND_STYLES[value].label}
        </button>
      ))}
    </div>
  )
}

function FindingRow({ finding, onSelect, active }: { finding: SecurityFinding; onSelect: () => void; active: boolean }) {
  const band = BAND_STYLES[finding.risk.band] ?? BAND_STYLES.informational
  const severity = finding.advisory.severity
  const cvss = severity.cvss40Score || severity.cvss31Score || 0
  const epss = (severity.epss ?? 0) * 100
  return (
    <tr
      role="row"
      tabIndex={0}
      aria-selected={active}
      data-ignored={!!finding.ignored}
      onClick={onSelect}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() } }}
      className="sec-row"
    >
      <td className="whitespace-nowrap">
        <span className="sec-dot" data-band={finding.risk.band} title={band.label} />
        <span className="sec-prio">{finding.risk.priority}</span>
      </td>
      <td>
        <span className="sec-id">{finding.advisory.id}</span>
        <span className="sec-tag">{band.label}</span>
        {severity.kev && <span className="sec-tag" data-kind="kev">KEV</span>}
        {finding.ignored && <Ban size={11} className="ml-2 inline text-text-4" aria-label="Suppressed" />}
        <div className="sec-sub">{finding.advisory.summary}</div>
      </td>
      <td>
        <div className="sec-mono max-w-[220px] truncate">{finding.component.name}</div>
        <div className="sec-sub">{finding.component.version} · {finding.component.direct ? 'direct' : 'transitive'}</div>
      </td>
      <td>
        <div className="sec-reach" data-level={finding.reachability}>{REACHABILITY_LABELS[finding.reachability] ?? 'Not analyzed'}</div>
        {finding.evidence.why && <div className="sec-why">{finding.evidence.why}</div>}
      </td>
      <td className="sec-mono sec-muted whitespace-nowrap">CVSS {cvss || '–'}<br />EPSS {epss.toFixed(1)}%</td>
      <td>
        {finding.remediation.fixedVersion
          ? <span className="sec-fix">→ {finding.remediation.fixedVersion}</span>
          : <span className="sec-fix" data-none="true">no fix published</span>}
      </td>
    </tr>
  )
}

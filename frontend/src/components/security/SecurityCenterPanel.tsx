import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  Download,
  FileSearch,
  Info,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Skull,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  downloadTextFile,
  exportSecurityReport,
  scanWorkspaceSecurity,
  type SecurityBand,
  type SecurityEcosystem,
  type SecurityExportFormatId,
  type SecurityFinding,
  type SecurityScanReport,
} from '@/lib/securityIntel-api'
import { SecurityFindingInspector } from './SecurityFindingInspector'

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

const REACHABILITY_STYLES: Record<string, string> = {
  called: 'text-error',
  potentiallyReachable: 'text-warning',
  imported: 'text-text-2',
  required: 'text-text-3',
  notReachable: 'text-text-3',
  unknown: 'text-text-3',
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
}

const EXPORTS: Array<{ id: SecurityExportFormatId; label: string; mime: string }> = [
  { id: 'json', label: 'JSON report', mime: 'application/json' },
  { id: 'html', label: 'HTML report', mime: 'text/html' },
  { id: 'sarif', label: 'SARIF 2.1.0', mime: 'application/json' },
  { id: 'cyclonedx', label: 'CycloneDX SBOM', mime: 'application/json' },
  { id: 'spdx', label: 'SPDX SBOM', mime: 'application/json' },
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

  useEffect(() => {
    // Il Security Center analizza una cartella di progetto: si propone la cartella di
    // lavoro corrente e la si può cambiare incollando un percorso.
    setWorkspace((current) => current || '')
  }, [])

  const scan = useCallback(async () => {
    if (!workspace.trim()) {
      setError('Select the project folder to scan.')
      return
    }
    setScanning(true)
    setError(null)
    try {
      const result = await scanWorkspaceSecurity(workspace.trim(), {
        offline,
        allowProcesses,
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

  const exportReport = useCallback(
    async (format: SecurityExportFormatId, mime: string) => {
      if (!report) return
      try {
        const content = await exportSecurityReport(report, format)
        const stamp = report.scannedAt.slice(0, 10) || 'report'
        const extension = format === 'html' ? '.html' : format === 'sarif' ? '.sarif' : '.json'
        downloadTextFile(`adomnia-security-${stamp}${extension}`, content, mime)
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-0 text-text-1">
      <header className="flex flex-wrap items-center gap-3 border-b border-border-1 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md border border-border-2 bg-surface-2 text-accent">
            <ShieldAlert size={16} />
          </span>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Security Intelligence</h1>
            <p className="text-[11px] leading-tight text-text-3">
              Dependency risk across Maven and Go — reachability, exploitation signals, safe remediation
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex h-8 items-center gap-2 rounded-md border border-border-2 bg-surface-1 px-2.5">
            <Search size={13} className="text-text-3" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter findings"
              className="w-44 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-3"
            />
          </label>

          <label className="flex h-8 items-center gap-2 rounded-md border border-border-2 bg-surface-1 px-2.5">
            <input
              value={workspace}
              onChange={(event) => setWorkspace(event.target.value)}
              placeholder="/path/to/project"
              spellCheck={false}
              className="w-56 bg-transparent font-mono text-[11px] text-text-1 outline-none placeholder:text-text-3"
            />
          </label>

          <button
            type="button"
            onClick={() => setOffline((value) => !value)}
            className={cn(
              'h-8 rounded-md border px-2.5 text-[11px] transition-colors',
              offline
                ? 'border-accent/40 bg-accent/15 text-accent'
                : 'border-border-2 bg-surface-1 text-text-2 hover:border-border-2 hover:text-text-1',
            )}
            title="Offline mode: only the local advisory database is consulted"
          >
            Offline
          </button>

          <button
            type="button"
            onClick={() => setAllowProcesses((value) => !value)}
            className={cn(
              'h-8 rounded-md border px-2.5 text-[11px] transition-colors',
              allowProcesses
                ? 'border-accent/40 bg-accent/15 text-accent'
                : 'border-border-2 bg-surface-1 text-text-2 hover:text-text-1',
            )}
            title="Authorize mvn and govulncheck to resolve the effective dependency graph and reachability"
          >
            Deep analysis
          </button>

          <div className="group relative">
            <button
              type="button"
              disabled={!report}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border-2 bg-surface-1 px-2.5 text-[11px] text-text-2 transition-colors hover:text-text-1 disabled:opacity-40"
            >
              <Download size={13} /> Export
            </button>
            <div className="invisible absolute right-0 top-full z-20 mt-1 w-48 rounded-md border border-border-2 bg-surface-2 p-1 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100">
              {EXPORTS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => exportReport(entry.id, entry.mime)}
                  className="block w-full rounded px-2.5 py-1.5 text-left text-[11px] text-text-2 hover:bg-surface-3 hover:text-text-1"
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={scan}
            disabled={scanning}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw size={13} className={cn(scanning && 'animate-spin')} />
            {scanning ? 'Scanning…' : 'Scan workspace'}
          </button>
        </div>
      </header>

      {error && (
        <div className="flex items-center gap-2 border-b border-border-1 bg-error/10 px-5 py-2 text-[11px] text-error">
          <AlertCircle size={13} />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-error/70 hover:text-error">
            dismiss
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {!report && !scanning && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-xl border border-border-2 bg-surface-1 text-text-3">
              <FileSearch size={22} />
            </span>
            <h2 className="text-sm font-semibold">Know what you actually run</h2>
            <p className="max-w-md text-xs leading-relaxed text-text-3">
              Scans pom.xml and go.mod, matches OSV, GitHub Advisory and the Go Vulnerability Database,
              then tells you which vulnerable code is actually reachable and how to fix it without breaking the build.
            </p>
            <button
              type="button"
              onClick={scan}
              className="mt-1 h-8 rounded-md bg-accent px-3 text-[11px] font-medium text-white hover:opacity-90"
            >
              Scan workspace
            </button>
          </div>
        )}

        {report && (
          <div className="flex flex-col gap-5 p-5">
            <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Findings" value={summary?.findings ?? 0} icon={<ShieldAlert size={14} />} />
              <StatCard label="Critical" value={summary?.critical ?? 0} tone="error" icon={<Skull size={14} />} />
              <StatCard label="High" value={summary?.high ?? 0} tone="warning" icon={<AlertTriangle size={14} />} />
              <StatCard
                label="Other"
                value={(summary?.medium ?? 0) + (summary?.low ?? 0) + (summary?.other ?? 0)}
                tone="info"
                icon={<Info size={14} />}
              />
              <StatCard
                label="Exploited in the wild"
                value={summary?.activelyExploited ?? 0}
                tone="error"
                icon={<Skull size={14} />}
              />
              <StatCard
                label="Reachable code"
                value={summary?.reachable ?? 0}
                tone="warning"
                icon={<AlertTriangle size={14} />}
              />
            </section>

            <section>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-3">
                Workspace security
              </h2>
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {(['Maven', 'Go'] as SecurityEcosystem[]).map((ecosystemId) => {
                  const counts = byEcosystem.get(ecosystemId) ?? { total: 0, critical: 0, high: 0 }
                  return (
                    <button
                      key={ecosystemId}
                      type="button"
                      onClick={() => setEcosystem(ecosystem === ecosystemId ? 'all' : ecosystemId)}
                      className={cn(
                        'rounded-lg border p-3.5 text-left transition-colors',
                        ecosystem === ecosystemId
                          ? 'border-accent/40 bg-accent/[0.07]'
                          : 'border-border-1 bg-surface-1 hover:border-border-2',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">{ECOSYSTEM_META[ecosystemId].title}</span>
                        <span className="ml-auto text-lg font-semibold leading-none">{counts.total}</span>
                        <span className="text-[10px] text-text-3">findings</span>
                      </div>
                      <p className="mt-1 text-[10px] text-text-3">{ECOSYSTEM_META[ecosystemId].subtitle}</p>
                      <div className="mt-2.5 flex items-center gap-1.5">
                        {counts.critical > 0 && <Chip tone="error">{counts.critical} critical</Chip>}
                        {counts.high > 0 && <Chip tone="warning">{counts.high} high</Chip>}
                        {counts.total === 0 && (
                          <span className="flex items-center gap-1 text-[10px] text-success">
                            <ShieldCheck size={12} /> no open findings
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <h2 className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-text-3">
                  Vulnerability findings
                </h2>
                <BandFilter active={band} onSelect={setBand} />
                <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-text-3">
                  <input
                    type="checkbox"
                    checked={hideIgnored}
                    onChange={(event) => setHideIgnored(event.target.checked)}
                    className="accent-[var(--color-accent)]"
                  />
                  Hide suppressed
                </label>
              </div>

              <div className="overflow-hidden rounded-lg border border-border-1">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border-1 bg-surface-1 text-left text-[10px] uppercase tracking-wider text-text-3">
                      <th className="px-3 py-2">Priority</th>
                      <th className="px-3 py-2">Vulnerability</th>
                      <th className="px-3 py-2">Component</th>
                      <th className="px-3 py-2">Reachability</th>
                      <th className="px-3 py-2">Signals</th>
                      <th className="px-3 py-2">Fix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((finding) => (
                      <FindingRow
                        key={finding.id}
                        finding={finding}
                        onSelect={() => setSelected(finding)}
                        active={selected?.id === finding.id}
                      />
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-text-3">
                          No findings match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-3">Data sources</h2>
              <div className="flex flex-wrap gap-2">
                {(report.sources ?? []).map((source) => (
                  <div
                    key={source.name}
                    className={cn(
                      'rounded-md border px-2.5 py-1.5 text-[10px]',
                      source.error ? 'border-error/30 bg-error/10 text-error' : 'border-border-1 bg-surface-1 text-text-3',
                    )}
                  >
                    <span className="font-medium text-text-2">{source.name}</span>
                    {source.lastUpdated && <span className="ml-1.5">updated {source.lastUpdated.slice(0, 10)}</span>}
                    {source.offline && <span className="ml-1.5">· local database</span>}
                    {source.error && <span className="ml-1.5">· {source.error}</span>}
                  </div>
                ))}
              </div>
            </section>
          </div>
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

function StatCard({
  label,
  value,
  tone = 'default',
  icon,
}: {
  label: string
  value: number
  tone?: 'default' | 'error' | 'warning' | 'info'
  icon: React.ReactNode
}) {
  const toneClass =
    tone === 'error'
      ? 'text-error'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'info'
          ? 'text-info'
          : 'text-text-1'
  return (
    <div className="rounded-lg border border-border-1 bg-surface-1 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-3">
        <span className={toneClass}>{icon}</span>
        {label}
      </div>
      <div className={cn('mt-1 text-2xl font-semibold leading-none', toneClass)}>{value}</div>
    </div>
  )
}

function Chip({ tone, children }: { tone: 'error' | 'warning'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-full border px-1.5 py-0.5 text-[9px] font-medium',
        tone === 'error' ? 'border-error/30 bg-error/15 text-error' : 'border-warning/30 bg-warning/15 text-warning',
      )}
    >
      {children}
    </span>
  )
}

function BandFilter({
  active,
  onSelect,
}: {
  active: SecurityBand | 'all'
  onSelect: (band: SecurityBand | 'all') => void
}) {
  return (
    <>
      {(['all', ...BAND_ORDER] as Array<SecurityBand | 'all'>).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onSelect(value)}
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
            active === value
              ? 'border-accent/40 bg-accent/15 text-accent'
              : 'border-border-2 bg-surface-1 text-text-3 hover:text-text-1',
          )}
        >
          {value === 'all' ? 'All' : BAND_STYLES[value].label}
        </button>
      ))}
    </>
  )
}

function FindingRow({
  finding,
  onSelect,
  active,
}: {
  finding: SecurityFinding
  onSelect: () => void
  active: boolean
}) {
  const style = BAND_STYLES[finding.risk.band] ?? BAND_STYLES.informational
  const severity = finding.advisory.severity
  return (
    <tr
      onClick={onSelect}
      className={cn(
        'cursor-pointer border-b border-border-1 transition-colors last:border-b-0',
        active ? 'bg-accent/[0.08]' : 'hover:bg-surface-1',
        finding.ignored && 'opacity-55',
      )}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
          <span className="text-[10px] font-semibold text-text-2">{finding.risk.priority}</span>
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] font-medium">{finding.advisory.id}</span>
          <span className={cn('rounded-full border px-1.5 py-px text-[9px] font-semibold', style.chip)}>
            {style.label}
          </span>
          {severity.kev && (
            <span className="rounded-full border border-error/30 bg-error/15 px-1.5 py-px text-[9px] font-semibold text-error">
              KEV
            </span>
          )}
          {finding.ignored && <Ban size={11} className="text-text-3" />}
        </div>
        <div className="mt-0.5 max-w-md truncate text-[10px] text-text-3">{finding.advisory.summary}</div>
      </td>
      <td className="px-3 py-2">
        <div className="max-w-[200px] truncate font-mono text-[11px]">{finding.component.name}</div>
        <div className="text-[10px] text-text-3">
          {finding.component.version} · {finding.component.direct ? 'direct' : 'transitive'}
        </div>
      </td>
      <td className={cn('px-3 py-2 text-[10px]', REACHABILITY_STYLES[finding.reachability] ?? 'text-text-3')}>
        {REACHABILITY_LABELS[finding.reachability] ?? 'Not analyzed'}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5 text-[10px] text-text-3">
          <span>CVSS {severity.cvss40Score || severity.cvss31Score || 0}</span>
          <span>·</span>
          <span>EPSS {((severity.epss ?? 0) * 100).toFixed(1)}%</span>
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-[10px]">
        {finding.remediation.fixedVersion ? (
          <span className="text-success">→ {finding.remediation.fixedVersion}</span>
        ) : (
          <span className="text-warning">no fix published</span>
        )}
      </td>
    </tr>
  )
}

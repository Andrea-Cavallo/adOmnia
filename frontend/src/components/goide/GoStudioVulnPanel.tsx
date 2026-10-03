import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Copy, ExternalLink, Info, Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { scanGoIDEVulnerabilities, startGoIDEDependencyAction, type GoIDESession, type GoIDEVulnFinding, type GoIDEVulnFrame, type GoIDEVulnReport } from '@/lib/goide-api'
import { goModules } from '@/lib/goide/goProject'
import { confirm } from '@/lib/confirmDialog'
import { openExternal } from '@/lib/openExternal'
import { useGoIDEStore } from '@/stores/goide'
import { GoStudioPerfExport } from './GoStudioPerfExport'
import { VULN_LEVELS, countByLevel, frameLabel, frameLocation, isGoToolchainModule, upgradePreview, vulnLevel, vulnReportToMarkdown, type VulnLevel } from './goStudioVulns'

const VULN_PROMPT = 'Review this Go vulnerability report. For each reachable finding explain the risk through the call path and propose the safest fix (upgrade or code change) with file:line references.\n\n'

/** Badge di priorità: colore di stato più icona ed etichetta, mai solo il colore. */
const LEVEL_STYLE: Record<VulnLevel, { tone: string; icon: typeof ShieldAlert }> = {
  called: { tone: 'bg-danger/12 text-danger', icon: ShieldAlert },
  imported: { tone: 'bg-warning/15 text-warning', icon: AlertTriangle },
  required: { tone: 'bg-surface-3 text-text-3', icon: ShieldQuestion },
}

function LevelBadge({ finding }: { finding: GoIDEVulnFinding }) {
  const level = vulnLevel(finding)
  const { tone, icon: Icon } = LEVEL_STYLE[level.id]
  return <span title={level.description} className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-[10.5px] font-medium ${tone}`}><Icon size={11} />{level.priority} · {level.label}</span>
}

function openFrame(frame: GoIDEVulnFrame): void {
  const store = useGoIDEStore.getState()
  if (frame.inProject && frame.relative) void store.openLocation(frame.relative, frame.line || 1, frame.column || 1)
  else if (frame.file?.endsWith('.go')) void store.openExternalLocation(frame.file, frame.line || 1, frame.column || 1)
}

/** Security Studio: govulncheck con raggiungibilità, percorsi di chiamata cliccabili e aggiornamento con anteprima. */
export function GoStudioVulnPanel({ session, lead }: { session: GoIDESession; lead?: React.ReactNode }) {
  const modules = goModules(session.project)
  const [moduleDirectory, setModuleDirectory] = useState(modules[0]?.path ?? '')
  const [report, setReport] = useState<GoIDEVulnReport | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const counts = useMemo(() => countByLevel(report?.findings ?? []), [report])
  const selected = report?.findings.find((finding) => finding.id === selectedId) ?? report?.findings[0] ?? null

  if (session.project.authorization !== 'tooling-permitted') {
    return <p className="p-4 text-[12px] text-text-4">Trust the project to scan its dependencies with govulncheck.</p>
  }

  const scan = async () => {
    setScanning(true)
    setNotice(null)
    try {
      const result = await scanGoIDEVulnerabilities(session.id, moduleDirectory)
      setReport(result)
      setSelectedId(result.findings[0]?.id ?? null)
      setError(null)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'govulncheck failed')
    } finally {
      setScanning(false)
    }
  }

  const upgrade = async (finding: GoIDEVulnFinding) => {
    const preview = upgradePreview(finding)
    if (!preview || isGoToolchainModule(finding.module)) return
    const details = [{ label: 'Command', value: preview.command, mono: true }]
    if (preview.goModBefore) details.push({ label: 'go.mod before', value: preview.goModBefore, mono: true })
    if (preview.goModAfter) details.push({ label: 'go.mod after', value: preview.goModAfter, mono: true })
    const accepted = await confirm({ title: `Upgrade ${finding.module} to ${finding.fixedVersion}?`, message: preview.note, details, confirmLabel: 'Run go get' })
    if (!accepted) return
    try {
      await startGoIDEDependencyAction({ sessionId: session.id, moduleDirectory: report?.moduleDirectory ?? moduleDirectory, action: 'update', modulePath: finding.module, version: finding.fixedVersion ?? '', confirmed: true })
      setNotice(`Running ${preview.command}: follow it in the Run panel, then scan again.`)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Upgrade failed')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="go-studio-tool-header flex-wrap gap-2">
        {lead ?? <span className="go-studio-tool-title">Vulnerabilities</span>}
        {modules.length > 1 && (
          <select aria-label="Go module" value={moduleDirectory} onChange={(event) => setModuleDirectory(event.target.value)} className="h-7 max-w-64 rounded-lg border-0 bg-[var(--gs-raised)] px-2 font-mono text-[11.5px] text-text-1 outline-none focus:ring-1 focus:ring-accent">
            {modules.map((module) => <option key={module.path} value={module.path}>{module.modulePath || module.path}</option>)}
          </select>
        )}
        <button type="button" onClick={() => void scan()} disabled={scanning} className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-accent px-3 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60">
          {scanning ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}{scanning ? 'Scanning…' : report ? 'Scan again' : 'Scan with govulncheck'}
        </button>
        <span className="flex items-center gap-1 text-[11px] text-text-4" title="govulncheck downloads the Go vulnerability database; offline and air-gapped network modes block it."><Info size={11} />Contacts vuln.go.dev</span>
        {report && <span className="ml-auto"><GoStudioPerfExport fileName="vulnerabilities.md" prompt={VULN_PROMPT} build={() => vulnReportToMarkdown(report)} /></span>}
      </div>

      {error && <p className="border-b border-danger/30 bg-danger/10 px-3 py-1.5 text-[11.5px] text-danger">{error}</p>}
      {notice && <p className="border-b border-accent/25 bg-accent/10 px-3 py-1.5 text-[11.5px] text-text-2">{notice}</p>}

      {!report && !scanning && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-text-4">
          <ShieldCheck size={24} />
          <p className="max-w-md text-[12.5px]">govulncheck checks your dependencies and the standard library against the Go vulnerability database, and tells you which vulnerable functions your code actually calls.</p>
        </div>
      )}

      {report && (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 border-b border-border-1 px-3 py-2.5">
            {VULN_LEVELS.map((level) => {
              const Icon = LEVEL_STYLE[level.id].icon
              return (
                <div key={level.id} className="rounded-[10px] bg-[var(--gs-ground)] px-2.5 py-1.5" title={level.description}>
                  <div className="flex items-center gap-1.5 text-[10.5px] text-text-4"><Icon size={11} />{level.priority} · {level.label}</div>
                  <div className="mt-0.5 font-mono text-[15px] font-semibold text-text-1">{counts[level.id]}</div>
                </div>
              )
            })}
            <div className="rounded-[10px] bg-[var(--gs-ground)] px-2.5 py-1.5 text-[10.5px] text-text-4">
              <div>{report.modulePath}</div>
              <div className="mt-0.5">govulncheck {report.scannerVersion || '—'} · DB {report.databaseUpdated?.slice(0, 10) || '—'}</div>
            </div>
          </div>

          {report.findings.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <ShieldCheck size={26} className="text-success" />
              <p className="text-[13px] font-medium text-text-1">No known vulnerabilities affect {report.modulePath}.</p>
              <p className="text-[11.5px] text-text-4">Checked against the Go vulnerability database updated {report.databaseUpdated?.slice(0, 10) || 'recently'}.</p>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,0.9fr)_minmax(0,1.6fr)] max-lg:grid-cols-1">
              <div role="listbox" aria-label="Vulnerabilities" className="min-h-0 overflow-auto border-r border-border-1 p-1.5">
                {report.findings.map((finding) => (
                  <button key={finding.id} type="button" role="option" aria-selected={selected?.id === finding.id} onClick={() => setSelectedId(finding.id)} className={`mb-1 block w-full rounded-lg px-2.5 py-2 text-left ${selected?.id === finding.id ? 'bg-accent/10 shadow-[inset_0_0_0_1px_var(--color-border-2)]' : 'hover:bg-surface-2/60'}`}>
                    <span className="flex items-center gap-2"><span className="font-mono text-[11.5px] font-semibold text-text-1">{finding.id}</span><span className="ml-auto"><LevelBadge finding={finding} /></span></span>
                    <span className="mt-1 block truncate text-[11.5px] text-text-2">{finding.summary || 'No summary'}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10.5px] text-text-4">{finding.module} {finding.foundVersion}{finding.fixedVersion ? ` → ${finding.fixedVersion}` : ' · no fix yet'}</span>
                  </button>
                ))}
              </div>
              {selected && <FindingDetail finding={selected} onUpgrade={() => void upgrade(selected)} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FindingDetail({ finding, onUpgrade }: { finding: GoIDEVulnFinding; onUpgrade: () => void }) {
  const preview = upgradePreview(finding)
  const level = vulnLevel(finding)
  return (
    <div className="min-h-0 overflow-auto p-4 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-[14px] font-semibold text-text-1">{finding.id}</h3>
        <LevelBadge finding={finding} />
        {finding.aliases?.map((alias) => <span key={alias} className="rounded-md bg-surface-3 px-1.5 py-px font-mono text-[10.5px] text-text-3">{alias}</span>)}
        <button type="button" onClick={() => openExternal(finding.url)} className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-accent hover:bg-accent/10"><ExternalLink size={12} />Advisory</button>
      </div>
      <p className="mt-1.5 text-[13px] text-text-1">{finding.summary}</p>
      <p className="mt-1 text-[11.5px] text-text-4">{level.description}</p>

      <Section title="Fix">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11.5px]">
          <span className="text-text-2">{finding.module}</span>
          <span className="rounded bg-danger/10 px-1.5 text-danger">{finding.foundVersion || '?'}</span>
          <ArrowRight size={12} className="text-text-4" />
          <span className={`rounded px-1.5 ${finding.fixedVersion ? 'bg-success/12 text-success' : 'bg-surface-3 text-text-3'}`}>{finding.fixedVersion || 'no fixed version yet'}</span>
        </div>
        {preview && (
          <div className="mt-2 rounded-lg bg-[var(--gs-ground)] p-2.5">
            {preview.goModBefore && <div className="font-mono text-[11px] text-danger">- {preview.goModBefore}</div>}
            {preview.goModAfter && <div className="font-mono text-[11px] text-success">+ {preview.goModAfter}</div>}
            <p className="mt-1.5 text-[11px] text-text-4">{preview.note}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {!isGoToolchainModule(finding.module) && <button type="button" onClick={onUpgrade} className="inline-flex h-7 items-center rounded-md bg-accent/15 px-2.5 text-[11.5px] font-medium text-accent hover:bg-accent/25">Upgrade…</button>}
              <button type="button" onClick={() => void navigator.clipboard.writeText(preview.command)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-text-3 hover:bg-surface-3 hover:text-text-1"><Copy size={12} />{preview.command}</button>
            </div>
          </div>
        )}
      </Section>

      {!!finding.callPaths?.length && (
        <Section title={`Call paths · ${finding.callPaths.length}`}>
          {finding.callPaths.map((path, index) => (
            <ol key={index} className="mb-2 rounded-lg bg-[var(--gs-ground)] p-1.5">
              {path.map((frame, step) => (
                <li key={`${step}-${frame.function}`}>
                  <button type="button" onClick={() => openFrame(frame)} disabled={!frame.file} title={frame.file ? 'Open source' : undefined} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-2/70 disabled:cursor-default">
                    <span className="w-4 shrink-0 text-right font-mono text-[10px] text-text-4">{step + 1}</span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${frame.inProject ? 'bg-accent' : step === path.length - 1 ? 'bg-danger' : 'bg-text-4'}`} aria-hidden="true" />
                    <span className="min-w-0 truncate font-mono text-[11.5px] text-text-1">{frameLabel(frame)}</span>
                    {frame.inProject && <span className="shrink-0 rounded bg-accent/12 px-1 text-[9.5px] font-medium text-accent">your code</span>}
                    {step === path.length - 1 && <span className="shrink-0 rounded bg-danger/12 px-1 text-[9.5px] font-medium text-danger">vulnerable</span>}
                    <span className="ml-auto shrink-0 font-mono text-[10.5px] text-text-4">{frameLocation(frame)}</span>
                  </button>
                </li>
              ))}
            </ol>
          ))}
        </Section>
      )}

      {!!finding.dependencyPath?.length && (
        <Section title="Dependency path">
          <div className="flex flex-wrap items-center gap-1 font-mono text-[11px]">
            {finding.dependencyPath.map((module, index) => (
              <span key={module} className="flex items-center gap-1">
                {index > 0 && <ArrowRight size={11} className="text-text-4" />}
                <span className={`rounded-md px-1.5 py-0.5 ${index === finding.dependencyPath!.length - 1 ? 'bg-danger/10 text-danger' : 'bg-surface-3 text-text-2'}`}>{module}</span>
              </span>
            ))}
          </div>
        </Section>
      )}

      {!!finding.symbols?.length && (
        <Section title="Vulnerable symbols">
          <div className="flex flex-wrap gap-1">{finding.symbols.map((symbol) => <span key={symbol} className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-text-2">{symbol}</span>)}</div>
        </Section>
      )}

      {finding.details && <Section title="Details"><p className="whitespace-pre-wrap text-[11.5px] leading-5 text-text-2">{finding.details}</p></Section>}
      {!!finding.cvss?.length && <Section title="CVSS"><p className="font-mono text-[11px] text-text-3">{finding.cvss.join(' · ')}</p></Section>}
      {!!finding.references?.length && (
        <Section title="References">
          {finding.references.map((url) => <button key={url} type="button" onClick={() => openExternal(url)} className="block max-w-full truncate text-left text-[11.5px] text-accent hover:underline">{url}</button>)}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h4 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">{title}</h4>
      {children}
    </section>
  )
}

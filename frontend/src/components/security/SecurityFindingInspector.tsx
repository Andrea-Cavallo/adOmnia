import { useState } from 'react'
import { ArrowRight, Ban, ExternalLink, GitBranch, ShieldCheck, Wrench, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  putSecuritySuppression,
  removeSecuritySuppression,
  type SecurityFinding,
  type SecurityReachability,
  type SecurityScanOptions,
  type SecurityScanReport,
} from '@/lib/securityIntel-api'
import { SecurityUpgradeFlow } from './SecurityUpgradeFlow'

/**
 * Vulnerability Inspector — "Explain My Vulnerability".
 *
 * Risponde a tre domande in un colpo d'occhio: perché questa vulnerabilità è urgente,
 * dove entra nel progetto e come si corregge senza rompere il codice. I segnali restano
 * separati: la gravità tecnica, la probabilità di sfruttamento e l'evidenza che il
 * codice vulnerabile sia raggiungibile sono tre cose diverse e vanno lette insieme,
 * non fuse in un numero.
 */
export function SecurityFindingInspector({
  finding,
  report,
  workspace,
  scanOptions,
  onClose,
}: {
  finding: SecurityFinding
  report: SecurityScanReport
  workspace: string
  scanOptions: SecurityScanOptions
  onClose: () => void
}) {
  const [suppressed, setSuppressed] = useState(!!finding.ignored)
  const [reason, setReason] = useState(finding.ignored?.reason ?? '')
  const [expires, setExpires] = useState(finding.ignored?.expiresAt?.slice(0, 10) ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const severity = finding.advisory.severity
  const cvssScore = severity.cvss40Score || severity.cvss31Score || 0
  const cvssVector = severity.cvss40Vector || severity.cvss31Vector || ''

  const suppress = async () => {
    if (!reason.trim()) {
      setMessage('A suppression needs a written reason.')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await putSecuritySuppression(workspace, {
        reason: reason.trim(),
        createdAt: new Date().toISOString(),
        expiresAt: expires ? new Date(expires).toISOString() : undefined,
        advisoryIds: [finding.advisory.id, ...(finding.advisory.aliases ?? [])],
        component: finding.component.name,
      })
      setSuppressed(true)
      setMessage('Suppression saved in .adomnia/dependency-security.json — it is versioned with the project.')
    } catch (cause) {
      setMessage(String(cause instanceof Error ? cause.message : cause))
    } finally {
      setBusy(false)
    }
  }

  const unsuppress = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await removeSecuritySuppression(workspace, finding.advisory.id)
      setSuppressed(false)
      setMessage('Suppression removed: the finding is active again.')
    } catch (cause) {
      setMessage(String(cause instanceof Error ? cause.message : cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-[440px] max-w-full flex-col border-l border-border-2 bg-surface-1 shadow-2xl">
      <header className="flex items-start gap-2 border-b border-border-1 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[13px] font-semibold">{finding.advisory.id}</span>
            {finding.advisory.aliases?.slice(0, 2).map((alias) => (
              <span
                key={alias}
                className="rounded border border-border-2 bg-surface-2 px-1.5 py-px font-mono text-[9px] text-text-3"
              >
                {alias}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-text-2">{finding.advisory.summary}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"
          aria-label="Close vulnerability inspector"
        >
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-auto px-4 py-4">
        <Section title="Risk signals" hint="measured separately, combined with explicit rules">
          <SignalRow
            label="CVSS"
            value={`${cvssScore.toFixed(1)} ${severity.baseSeverity ?? ''}`.trim()}
            detail={cvssVector || 'no vector published'}
            tone={cvssScore >= 9 ? 'error' : cvssScore >= 7 ? 'warning' : 'default'}
            caption="technical severity"
          />
          <SignalRow
            label="EPSS"
            value={`${((severity.epss ?? 0) * 100).toFixed(1)}%`}
            detail={
              severity.epssPercentile
                ? `percentile ${(severity.epssPercentile * 100).toFixed(1)}% · probability of exploitation within 30 days`
                : 'probability of exploitation within 30 days'
            }
            tone={(severity.epss ?? 0) >= 0.1 ? 'error' : (severity.epss ?? 0) >= 0.01 ? 'warning' : 'default'}
            caption="exploitation probability"
          />
          <SignalRow
            label="CISA KEV"
            value={severity.kev ? 'Listed' : 'Not listed'}
            detail={
              severity.kev
                ? `exploited in the wild${severity.kevDueDate ? ` · remediation due ${severity.kevDueDate}` : ''}${
                    severity.kevRansomwareCampaign ? ' · used in ransomware campaigns' : ''
                  }`
                : 'no evidence of active exploitation in the CISA catalog'
            }
            tone={severity.kev ? 'error' : 'default'}
            caption="observed exploitation"
          />
          <SignalRow
            label="Reachability"
            value={reachabilityLabel(finding.reachability)}
            detail={finding.evidence.note ?? ''}
            tone={
              finding.reachability === 'called'
                ? 'error'
                : finding.reachability === 'potentiallyReachable'
                  ? 'warning'
                  : 'default'
            }
            caption={finding.evidence.method ? `analysis: ${finding.evidence.method}` : 'not analyzed'}
          />
          <SignalRow
            label="Exposure"
            value={finding.component.exposure}
            detail={`declared as ${finding.component.origin}${finding.component.scope ? ` · scope ${finding.component.scope}` : ''}`}
            caption="component role in the application"
          />
          <SignalRow
            label="Fix availability"
            value={finding.remediation.fixedVersion ? `Fixed in ${finding.remediation.fixedVersion}` : 'No fix published'}
            detail={
              finding.remediation.compatibility
                ? `upgrade risk: ${finding.remediation.compatibility}`
                : 'no compatible fix version is published yet'
            }
            tone={finding.remediation.fixedVersion ? 'success' : 'warning'}
            caption="remediation path"
          />
        </Section>

        <Section title="Why this priority" hint={`${finding.risk.priority} · ${finding.risk.band}`}>
          <ul className="space-y-1.5">
            {(finding.risk.reasons ?? []).map((reason) => (
              <li key={reason} className="flex gap-2 text-[11px] leading-relaxed text-text-2">
                <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                {reason}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Dependency path" hint={finding.component.direct ? 'declared directly' : 'transitive'}>
          <div className="flex flex-wrap items-center gap-1.5">
            {(finding.component.dependencyPath ?? [finding.component.name]).map((step, index, all) => (
              <span key={`${step}-${index}`} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'rounded border px-1.5 py-0.5 font-mono text-[10px]',
                    index === all.length - 1
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-border-2 bg-surface-2 text-text-2',
                  )}
                >
                  {step}
                </span>
                {index < all.length - 1 && <ArrowRight size={11} className="text-text-3" />}
              </span>
            ))}
          </div>
          {finding.component.replace && (
            <p className="mt-2 flex items-center gap-1.5 text-[10px] text-text-3">
              <GitBranch size={11} /> replaced by <span className="font-mono">{finding.component.replace}</span>
            </p>
          )}
          {finding.remediation.indirectVia && (
            <p className="mt-2 text-[10px] text-text-3">
              Pulled in by <span className="font-mono">{finding.remediation.indirectVia}</span> — the fix may need to
              change that component.
            </p>
          )}
        </Section>

        {(finding.evidence.callPaths?.length ?? 0) > 0 && (
          <Section
            title="Call paths"
            hint="from your code to the vulnerable symbol"
            caption="no call path found is not a guarantee of safety"
          >
            <div className="space-y-2.5">
              {finding.evidence.callPaths?.map((path, pathIndex) => (
                <div key={pathIndex} className="rounded-md border border-border-1 bg-surface-2 p-2.5">
                  {path.map((frame, frameIndex) => (
                    <div key={frameIndex} className="flex items-baseline gap-2 py-0.5">
                      <span className="w-4 shrink-0 text-right font-mono text-[9px] text-text-3">{frameIndex + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-[10px]">
                          {frame.function ? (
                            <>
                              <span className={frame.inProject ? 'text-accent' : 'text-text-2'}>{frame.function}</span>
                              <span className="text-text-3"> · {frame.package || frame.module}</span>
                            </>
                          ) : (
                            <span className="text-text-2">{frame.package || frame.module}</span>
                          )}
                        </div>
                        {(frame.relative || frame.file) && (
                          <div className="truncate text-[9px] text-text-3">
                            {frame.relative || frame.file}
                            {frame.line ? `:${frame.line}` : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="Remediation" hint={finding.remediation.strategy}>
          {finding.remediation.blocked ? (
            <p className="rounded-md border border-warning/30 bg-warning/10 p-2.5 text-[11px] text-warning">
              {finding.remediation.blockedReason ?? 'This fix cannot be applied automatically.'}
            </p>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 rounded-md border border-border-1 bg-surface-2 p-2.5">
                <Wrench size={13} className="shrink-0 text-accent" />
                <div className="min-w-0">
                  <div className="font-mono text-[11px]">
                    {finding.component.name}{' '}
                    <span className="text-text-3">
                      {finding.remediation.currentVersion} → {finding.remediation.fixedVersion ?? 'mitigation'}
                    </span>
                  </div>
                  {finding.remediation.note && (
                    <p className="mt-1 text-[10px] leading-relaxed text-text-3">{finding.remediation.note}</p>
                  )}
                </div>
              </div>

              {finding.remediation.commands && finding.remediation.commands.length > 0 && (
                <div className="rounded-md border border-border-1 bg-surface-0 p-2.5">
                  {finding.remediation.commands.map((command) => (
                    <code key={command} className="block font-mono text-[10px] text-text-2">
                      $ {command}
                    </code>
                  ))}
                </div>
              )}

              {(finding.remediation.resolves?.length ?? 0) > 0 && (
                <p className="flex items-start gap-1.5 text-[10px] text-success">
                  <ShieldCheck size={12} className="mt-px shrink-0" />
                  The same change also closes {finding.remediation.resolves?.join(', ')}
                </p>
              )}
              {(finding.remediation.introduces?.length ?? 0) > 0 && (
                <p className="flex items-start gap-1.5 text-[10px] text-warning">
                  <GitBranch size={12} className="mt-px shrink-0" />
                  The upgrade brings in {finding.remediation.introduces?.join(', ')}
                </p>
              )}

              {finding.remediation.fixedVersion && (
                <SecurityUpgradeFlow
                  finding={finding}
                  report={report}
                  workspace={workspace}
                  scanOptions={scanOptions}
                />
              )}
            </div>
          )}
        </Section>

        <Section title="Advisory" hint={finding.advisory.sources?.join(', ')}>
          <p className="text-[11px] leading-relaxed text-text-2">{finding.advisory.details || finding.advisory.summary}</p>
          {(finding.advisory.references?.length ?? 0) > 0 && (
            <div className="mt-2 space-y-1">
              {finding.advisory.references?.slice(0, 5).map((reference) => (
                <a
                  key={reference}
                  href={reference}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 truncate text-[10px] text-accent hover:underline"
                >
                  <ExternalLink size={10} className="shrink-0" />
                  {reference}
                </a>
              ))}
            </div>
          )}
          {(finding.advisory.vulnerableRanges?.length ?? 0) > 0 && (
            <p className="mt-2 font-mono text-[10px] text-text-3">
              affected: {finding.advisory.vulnerableRanges?.join(' · ')}
            </p>
          )}
        </Section>

        <Section title="Accept this risk" hint="with a reason and an expiry">
          {suppressed ? (
            <div className="space-y-2">
              <p className="rounded-md border border-border-1 bg-surface-2 p-2.5 text-[10px] leading-relaxed text-text-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <Ban size={11} /> Suppressed
                </span>
                <span className="mt-1 block text-text-3">{finding.ignored?.reason ?? reason}</span>
                {finding.ignored?.expiresAt && (
                  <span className="mt-1 block text-text-3">expires {finding.ignored.expiresAt.slice(0, 10)}</span>
                )}
              </p>
              <button
                type="button"
                onClick={unsuppress}
                disabled={busy}
                className="h-7 rounded-md border border-border-2 bg-surface-2 px-2.5 text-[10px] text-text-2 hover:text-text-1 disabled:opacity-50"
              >
                Reactivate
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                placeholder="Why is this risk acceptable? (required)"
                className="w-full resize-none rounded-md border border-border-2 bg-surface-0 p-2 text-[11px] text-text-1 outline-none placeholder:text-text-3 focus:border-accent/50"
              />
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[10px] text-text-3">
                  Expires
                  <input
                    type="date"
                    value={expires}
                    onChange={(event) => setExpires(event.target.value)}
                    className="rounded border border-border-2 bg-surface-0 px-1.5 py-1 text-[10px] text-text-1 outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={suppress}
                  disabled={busy}
                  className="ml-auto h-7 rounded-md border border-border-2 bg-surface-2 px-2.5 text-[10px] text-text-2 hover:text-text-1 disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Suppress finding'}
                </button>
              </div>
            </div>
          )}
          {message && <p className="mt-2 text-[10px] text-text-3">{message}</p>}
        </Section>
      </div>
    </aside>
  )
}

function reachabilityLabel(reachability: SecurityReachability): string {
  switch (reachability) {
    case 'called':
      return 'Called'
    case 'potentiallyReachable':
      return 'Potentially reachable'
    case 'imported':
      return 'Imported'
    case 'required':
      return 'Required only'
    case 'notReachable':
      return 'Not reachable'
    default:
      return 'Not analyzed'
  }
}

function Section({
  title,
  hint,
  caption,
  children,
}: {
  title: string
  hint?: string
  caption?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-3">{title}</h3>
        {hint && <span className="text-[9px] text-text-3">{hint}</span>}
      </div>
      {children}
      {caption && <p className="mt-1.5 text-[9px] italic text-text-3">{caption}</p>}
    </section>
  )
}

function SignalRow({
  label,
  value,
  detail,
  caption,
  tone = 'default',
}: {
  label: string
  value: string
  detail: string
  caption: string
  tone?: 'default' | 'error' | 'warning' | 'success'
}) {
  const toneClass =
    tone === 'error'
      ? 'text-error'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'success'
          ? 'text-success'
          : 'text-text-1'
  return (
    <div className="border-b border-border-1 py-2 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <span className="w-[104px] shrink-0 text-[10px] uppercase tracking-wider text-text-3">{label}</span>
        <span className={cn('text-xs font-semibold', toneClass)}>{value}</span>
      </div>
      <p className="ml-[112px] text-[10px] leading-relaxed text-text-3">{detail}</p>
      <p className="ml-[112px] text-[9px] italic text-text-3/80">{caption}</p>
    </div>
  )
}

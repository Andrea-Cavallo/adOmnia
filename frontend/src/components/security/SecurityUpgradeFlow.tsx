import { useState } from 'react'
import { withContentKeys } from '@/lib/contentKeys'
import { AlertTriangle, Check, Loader2, Minus, Play, ShieldCheck, Wrench, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  finishSecurityUpgrade,
  planSecurityUpgrade,
  previewSecurityUpgrade,
  runSecurityUpgradeStep,
  type SecurityAdvisoryImpact,
  type SecurityScanOptions,
  type SecurityScanReport,
  type SecurityFinding,
  type SecurityUpgradePlan,
  type SecurityUpgradePreview,
  type SecurityUpgradeStep,
} from '@/lib/securityIntel-api'

/**
 * Safe Remediation — "Preview diff → Run checks → Apply".
 *
 * La modifica a un manifest non è mai un salto nel buio: prima si vede l'impatto
 * dell'aggiornamento (quali vulnerabilità spariscono, quali restano, quali nuove
 * introduce), poi il diff esatto che verrebbe scritto, poi i passi di verifica con il
 * loro output. La modifica resta provvisoria e con backup finché l'utente non la
 * conferma; a ogni momento si può tornare indietro.
 */
export function SecurityUpgradeFlow({
  finding,
  report,
  workspace,
  scanOptions,
}: {
  finding: SecurityFinding
  report: SecurityScanReport
  workspace: string
  scanOptions: SecurityScanOptions
}) {
  const [targetVersion, setTargetVersion] = useState(finding.remediation.fixedVersion ?? '')
  const [preview, setPreview] = useState<SecurityUpgradePreview | null>(null)
  const [plan, setPlan] = useState<SecurityUpgradePlan | null>(null)
  const [runningStep, setRunningStep] = useState<string | null>(null)
  const [busy, setBusy] = useState<'preview' | 'plan' | 'checks' | 'finish' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const upgradeRequest = () => ({
    component: finding.component,
    targetVersion: targetVersion.trim(),
    report,
    options: scanOptions,
  })

  const fail = (cause: unknown) => setError(String(cause instanceof Error ? cause.message : cause))

  const runPreview = async () => {
    setBusy('preview')
    setError(null)
    setMessage(null)
    setPreview(null)
    setPlan(null)
    try {
      setPreview(await previewSecurityUpgrade(workspace, upgradeRequest()))
    } catch (cause) {
      fail(cause)
    } finally {
      setBusy(null)
    }
  }

  const prepare = async () => {
    setBusy('plan')
    setError(null)
    setMessage(null)
    try {
      setPlan(await planSecurityUpgrade(workspace, upgradeRequest()))
    } catch (cause) {
      fail(cause)
    } finally {
      setBusy(null)
    }
  }

  const runChecks = async () => {
    if (!plan) return
    setBusy('checks')
    setError(null)
    setMessage(null)
    try {
      let current = plan
      for (const step of current.steps) {
        if (step.status === 'ok' || step.status === 'skipped') continue
        setRunningStep(step.id)
        // oxlint-disable-next-line eslint/no-await-in-loop -- upgrade steps are ordered, each one depends on the previous plan state
        current = await runSecurityUpgradeStep(workspace, current.id, step.id, scanOptions)
        setPlan(current)
        setRunningStep(null)
        if (current.steps.find((candidate) => candidate.id === step.id)?.status === 'failed') break
      }
    } catch (cause) {
      fail(cause)
    } finally {
      setRunningStep(null)
      setBusy(null)
    }
  }

  const finish = async (apply: boolean) => {
    if (!plan) return
    setBusy('finish')
    setError(null)
    try {
      const finished = await finishSecurityUpgrade(workspace, plan.id, apply)
      setPlan(finished)
      setMessage(
        apply
          ? `${finished.note ?? 'The change is definitive.'} Run a new scan to refresh the findings.`
          : (finished.note ?? 'The change is discarded.'),
      )
    } catch (cause) {
      fail(cause)
    } finally {
      setBusy(null)
    }
  }

  const planFailed = (plan?.steps ?? []).some((step) => displayStatus(step, runningStep) === 'failed')
  const checksDone = (plan?.steps ?? []).every((step) => step.status === 'ok' || step.status === 'skipped')
  const checksStarted = (plan?.steps ?? []).some((step) => step.status !== 'idle')
  const finished = plan?.state === 'committed' || plan?.state === 'reverted'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border-1 bg-surface-2 p-2.5">
        <Wrench size={13} className="shrink-0 text-accent" />
        <span className="font-mono text-[11px]">{finding.component.name}</span>
        <span className="text-[10px] text-text-3">{finding.component.version} →</span>
        <input
          value={targetVersion}
          onChange={(event) => {
            setTargetVersion(event.target.value)
            setPreview(null)
            setPlan(null)
          }}
          className="w-24 rounded border border-border-2 bg-surface-0 px-1.5 py-1 font-mono text-[11px] text-text-1 outline-none focus:border-accent/50"
        />
        <Button variant="outline" size="sm" onClick={runPreview} disabled={busy !== null || !targetVersion.trim()}>
          {busy === 'preview' ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
          Preview impact
        </Button>
      </div>

      {preview && (
        <div className="space-y-2 rounded-md border border-border-1 bg-surface-2 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <ImpactBadge label={`closes ${preview.resolves?.length ?? 0}`} tone="success" />
            <ImpactBadge label={`still open ${preview.remaining?.length ?? 0}`} tone="warning" />
            <ImpactBadge label={`introduces ${preview.introduces?.length ?? 0}`} tone={preview.introduces?.length ? 'error' : 'default'} />
            <span className="rounded border border-border-2 bg-surface-3 px-1.5 py-px text-[9px] text-text-3">
              {preview.compatibility} upgrade
            </span>
          </div>
          <ImpactList title="Closed by this upgrade" impacts={preview.resolves} tone="text-success" />
          <ImpactList title="Still open after this upgrade" impacts={preview.remaining} tone="text-warning" />
          <ImpactList title="Introduced by this upgrade" impacts={preview.introduces} tone="text-error" />
          <p className="text-[10px] leading-relaxed text-text-2">{preview.advice}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={prepare}
            disabled={busy !== null || !preview.compatibility}
          >
            {busy === 'plan' ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />}
            Prepare the change
          </Button>
        </div>
      )}

      {plan && (
        <div className="space-y-2.5 rounded-md border border-border-1 bg-surface-2 p-2.5">
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-3">Manifest diff</h4>
            <p className="text-[9px] text-text-3">
              nothing is written until the checks run, and the previous content is kept as a backup
            </p>
          </div>
          <div className="max-h-56 overflow-auto rounded-md border border-border-1 bg-surface-0 p-2">
            {withContentKeys(plan.diff.split('\n'), (line) => line).map(({ key: lineKey, item: line }) => (
              <div
                key={lineKey}
                className={cn(
                  'whitespace-pre-wrap break-all font-mono text-[9px] leading-relaxed',
                  diffTone(line),
                )}
              >
                {line || ' '}
              </div>
            ))}
          </div>

          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-3">Verification steps</h4>
          <ol className="space-y-1.5">
            {plan.steps.map((step) => (
              <StepRow key={step.id} step={step} running={runningStep === step.id} />
            ))}
          </ol>

          {!finished && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={runChecks}
                disabled={busy !== null || (checksDone && !planFailed)}
              >
                {busy === 'checks' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                {checksStarted ? 'Re-run checks' : 'Run checks'}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => finish(true)}
                disabled={busy !== null || !checksDone}
              >
                <Check size={12} />
                Apply change
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => finish(false)}
                disabled={busy !== null}
              >
                <X size={12} />
                Discard change
              </Button>
              {planFailed && (
                <span className="text-[10px] text-error">
                  a verification step failed: fix it or discard the change
                </span>
              )}
            </div>
          )}
          {finished && (
            <p
              className={cn(
                'rounded-md border p-2 text-[10px] leading-relaxed',
                plan.state === 'committed'
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-border-1 bg-surface-1 text-text-2',
              )}
            >
              {message ?? plan.note}
            </p>
          )}
        </div>
      )}

      {!finished && message && <p className="text-[10px] text-text-3">{message}</p>}
      {error && (
        <p className="flex items-start gap-1.5 rounded-md border border-error/30 bg-error/10 p-2 text-[10px] text-error">
          <AlertTriangle size={12} className="mt-px shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

function displayStatus(step: SecurityUpgradeStep, runningStep: string | null): string {
  return runningStep === step.id ? 'running' : step.status
}

function diffTone(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-text-3'
  if (line.startsWith('@@')) return 'text-info'
  if (line.startsWith('+')) return 'text-success'
  if (line.startsWith('-')) return 'text-error'
  return 'text-text-2'
}

function ImpactBadge({ label, tone }: { label: string; tone: 'success' | 'warning' | 'error' | 'default' }) {
  const tones = {
    success: 'border-success/30 bg-success/15 text-success',
    warning: 'border-warning/30 bg-warning/15 text-warning',
    error: 'border-error/30 bg-error/15 text-error',
    default: 'border-border-2 bg-surface-3 text-text-3',
  }
  return <span className={cn('rounded-full border px-1.5 py-px text-[9px] font-medium', tones[tone])}>{label}</span>
}

function ImpactList({ title, impacts, tone }: { title: string; impacts?: SecurityAdvisoryImpact[]; tone: string }) {
  if (!impacts || impacts.length === 0) return null
  return (
    <div>
      <p className={cn('text-[9px] font-semibold uppercase tracking-wider', tone)}>{title}</p>
      <ul className="mt-1 space-y-0.5">
        {impacts.map((impact) => (
          <li key={impact.id} className="flex flex-wrap items-baseline gap-1.5 text-[10px] text-text-2">
            <span className="font-mono">{impact.id}</span>
            <span className={cn('text-[9px] font-semibold', tone)}>{impact.severity}</span>
            {impact.kev && <span className="text-[9px] font-semibold text-error">KEV</span>}
            {impact.fixedVersion && <span className="text-[9px] text-text-3">fixed in {impact.fixedVersion}</span>}
            {impact.summary && <span className="min-w-0 truncate text-[9px] text-text-3">{impact.summary}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function StepRow({ step, running }: { step: SecurityUpgradeStep; running: boolean }) {
  const status = running ? 'running' : step.status
  return (
    <li className="rounded-md border border-border-1 bg-surface-1 p-2">
      <div className="flex items-center gap-2">
        <StepStatusIcon status={status} />
        <span className="text-[11px] text-text-1">{step.label}</span>
        {step.command && <code className="ml-auto truncate font-mono text-[9px] text-text-3">{step.command}</code>}
      </div>
      {step.output && (
        <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-0 p-1.5 font-mono text-[9px] leading-relaxed text-text-2">
          {step.output}
        </pre>
      )}
    </li>
  )
}

function StepStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'ok':
      return <Check size={12} className="shrink-0 text-success" />
    case 'failed':
      return <X size={12} className="shrink-0 text-error" />
    case 'skipped':
      return <Minus size={12} className="shrink-0 text-warning" />
    case 'running':
      return <Loader2 size={12} className="shrink-0 animate-spin text-info" />
    default:
      return <span className="ml-px mr-px h-2 w-2 shrink-0 rounded-full border border-border-2" />
  }
}

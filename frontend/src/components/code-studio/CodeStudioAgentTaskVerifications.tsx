import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleAlert, CircleSlash, Loader2, Play, Plus, Send, Trash2, Wrench, XCircle } from 'lucide-react'
import { VerificationKind, type AgentEvidence, type AgentTask, type AgentVerification, type AgentVerificationDraft } from '@/lib/agent-task-api'
import { useAgentTaskStore } from '@/stores/agentTasks'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { listGoIDERunConfigurations, type GoIDERunConfiguration } from '@/lib/code-studio-api'
import { CodeStudioAlert, CodeStudioButton, CodeStudioField } from './CodeStudioModal'

type VerificationType = 'test' | 'request'

const isActive = (task: AgentTask) => ['running', 'waiting_permission', 'stopping'].includes(task.status)

const outcomeBadge: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  passed: { label: 'Passed', className: 'text-success', icon: CheckCircle2 },
  failed: { label: 'Failed', className: 'text-danger', icon: XCircle },
  error: { label: 'Error', className: 'text-warning', icon: CircleAlert },
  not_run: { label: 'Not run', className: 'text-text-3', icon: CircleSlash },
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const badge = outcomeBadge[outcome] ?? outcomeBadge.not_run
  const Icon = badge.icon
  return <span className={`inline-flex items-center gap-1 text-[10px] ${badge.className}`}><Icon size={11} />{badge.label}</span>
}

const summarize = (verification: AgentVerification) => verification.kind === 'request'
  ? `${verification.method || 'GET'} ${verification.url}`
  : `${verification.language || 'go'} test ${verification.packages?.length ? verification.packages.join(' ') : './...'}${verification.run ? ` · ${verification.run}` : ''}`

const formatDuration = (millis: number) => millis >= 1000 ? `${(millis / 1000).toFixed(1)} s` : `${millis} ms`

interface Props { task: AgentTask; ready: boolean }

/** Verifications adOmnia runs on the task content, and the evidence they produce. */
export function CodeStudioAgentTaskVerifications({ task, ready }: Props) {
  const busy = useAgentTaskStore((state) => state.busyById[task.id])
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<VerificationType>('test')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const active = isActive(task)
  const verifying = (task.verifyingIds?.length ?? 0) > 0
  const evidences = useMemo(() => [...(task.evidences ?? [])].reverse(), [task.evidences])
  const lastByVerification = useMemo(() => {
    const map = new Map<string, AgentEvidence>()
    for (const evidence of task.evidences ?? []) map.set(evidence.verificationId, evidence)
    return map
  }, [task.evidences])

  const act = async (action: () => Promise<unknown>) => {
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const run = (ids: string[]) => act(() => useAgentTaskStore.getState().startVerifications(task.id, ids))
  const correction = async () => {
    if (!selected.length) return
    await act(async () => {
      await useAgentTaskStore.getState().askCorrection(task.id, selected, note)
      setSelected([])
      setNote('')
    })
  }
  // ponytail: mirrors consecutiveCorrections in internal/ide/agenttask; the backend still enforces it.
  const correctionLimit = task.limits.maxCorrections || 3
  const corrections = consecutiveCorrections(task)
  const limitReached = corrections >= correctionLimit
  const remove = (verificationId: string) => act(() => useAgentTaskStore.getState().removeVerification(task.id, verificationId))

  return <section className="agent-task-section flex flex-col gap-2" aria-label="Verifications">
    <div className="flex items-center gap-2">
      <h3 className="gs-section-title flex-1">Verifications</h3>
      {verifying && <span className="inline-flex items-center gap-1 text-[10px] text-text-3" role="status"><Loader2 size={11} className="animate-spin" />Verifying {task.verifyingIds?.length}</span>}
      <CodeStudioButton small icon={Play} loading={busy && !verifying} disabled={active || verifying || !(task.verifications?.length)} title={active ? 'Stop the running attempt first' : 'Run every verification on the current content'} onClick={() => void run([])}>Run all</CodeStudioButton>
      <CodeStudioButton small icon={Plus} disabled={active || verifying} onClick={() => setAdding((value) => !value)}>{adding ? 'Close' : 'Add'}</CodeStudioButton>
    </div>
    {error && <CodeStudioAlert>{error}</CodeStudioAlert>}
    <p className="text-[11px] text-text-3">adOmnia runs these checks itself and records what it measured. A verification that does not run is never reported as passed.</p>

    {adding && <VerificationForm root={task.root} kind={kind} setKind={setKind} busy={busy} onAdd={async (draft) => {
      await act(async () => {
        await useAgentTaskStore.getState().addVerification(task.id, draft)
        setAdding(false)
      })
    }} />}

    {!(task.verifications?.length) && !adding && <p className="text-[11px] text-text-3">No verification yet. Add a language test or a local HTTP request to prove the change works.</p>}
    {(task.verifications?.length ?? 0) > 0 && <ul className="flex flex-col gap-1" aria-label="Task verifications">
      {(task.verifications ?? []).map((verification) => {
        const last = lastByVerification.get(verification.id)
        const running = task.verifyingIds?.includes(verification.id)
        return <li key={verification.id} className="agent-verify-row flex items-start gap-2 rounded border border-border-1 px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium">{verification.label}</span>
              <span className="gs-badge">{verification.kind}</span>
              {running ? <span className="text-[10px] text-text-3">running…</span> : last && <><OutcomeBadge outcome={last.outcome} /><span className="text-[10px] text-text-4">{formatDuration(last.durationMs)}</span></>}
            </div>
            <p className="mt-0.5 break-words font-mono text-[10px] text-text-3" title={summarize(verification)}>{summarize(verification)}</p>
          </div>
          <button type="button" className="code-studio-icon-button h-6 w-6" disabled={active || verifying || busy} title="Run this verification" aria-label={`Run ${verification.label}`} onClick={() => void run([verification.id])}><Play size={12} /></button>
          <button type="button" className="code-studio-icon-button h-6 w-6" disabled={active || verifying || busy} title="Remove this verification; its evidence is kept" aria-label={`Remove ${verification.label}`} onClick={() => void remove(verification.id)}><Trash2 size={12} /></button>
        </li>
      })}
    </ul>}

    {evidences.length > 0 && <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2"><h4 className="gs-section-title flex-1">Evidence</h4><span className="text-[10px] text-text-4">{evidences.length} recorded</span></div>
      <ul className="flex flex-col gap-1" aria-label="Recorded evidence">
        {evidences.map((evidence) => <li key={evidence.id} className="flex flex-col gap-1 rounded border border-border-1 px-2 py-1.5">
          <div className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={selected.includes(evidence.id)} aria-label={`Select evidence ${evidence.label}`} onChange={() => toggle(evidence.id)} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><OutcomeBadge outcome={evidence.outcome} /><span className="text-[12px] font-medium">{evidence.label}</span><span className="text-[10px] text-text-4">{formatDuration(evidence.durationMs)}</span></div>
              <p className="mt-0.5 break-words font-mono text-[10px] text-text-3">{evidence.command}</p>
              {evidence.diffFingerprint && <p className="break-words font-mono text-[10px] text-text-4" title={evidence.diffFingerprint}>diff {evidence.diffFingerprint.slice(0, 12)} · {evidence.changedFiles} changed file{evidence.changedFiles === 1 ? '' : 's'}</p>}
            </div>
          </div>
          <details className="text-[11px]"><summary className="cursor-pointer text-text-3">Log and observations</summary>
            {evidence.log && <pre className="milk-output agent-task-preview mt-1">{evidence.log}</pre>}
            {!!evidence.observations?.length && <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-3">{evidence.observations.map((observation) => <li key={observation.name}>{observation.name}: {observation.value}</li>)}</ul>}
            <p className="mt-1 text-[10px] text-text-4">Attempt {evidence.attemptId ? evidence.attemptId.slice(-8) : 'none'} · {evidence.workdir}</p>
          </details>
        </li>)}
      </ul>
      <div className="flex flex-col gap-2 rounded border border-border-1 p-2">
        <p className="text-[11px] text-text-3">Send the selected results to the agent as a correction. The same verifications are re-run on the new content, so the outcome is measured again.</p>
        <input className="gs-input h-7 text-[11px]" value={note} placeholder="Additional instruction (optional)" aria-label="Correction note" onChange={(event) => setNote(event.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <CodeStudioButton small variant="primary" icon={Wrench} loading={busy} disabled={active || !selected.length || !ready || limitReached} title={!ready ? 'The selected agent is not ready' : active ? 'Stop the running attempt first' : limitReached ? `Limit of ${correctionLimit} consecutive corrections reached: review the evidence, then run the task again or raise the limit` : !selected.length ? 'Select at least one result' : undefined} onClick={() => void correction()}>Ask for correction</CodeStudioButton>
          <span className="text-[10px] text-text-4">{selected.length ? `${selected.length} selected` : 'No result selected'} · {corrections}/{correctionLimit} corrections</span>
        </div>
      </div>
    </div>}
  </section>
}

const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const samePath = (a: string, b: string) => normalizePath(a) === normalizePath(b)

/** Run configurations of the task's project, from its open Code Studio session (empty when the project is not open). */
function useProjectRunConfigurations(root: string, enabled: boolean): GoIDERunConfiguration[] {
  const sessionId = useCodeStudioStore((state) => state.sessions.find((session) => samePath(session.project.realPath, root) || samePath(session.project.rootPath, root))?.id)
  const [configs, setConfigs] = useState<GoIDERunConfiguration[]>([])
  useEffect(() => {
    if (!enabled || !sessionId) return
    let live = true
    void listGoIDERunConfigurations(sessionId).then((items) => { if (live) setConfigs(items ?? []) }).catch(() => { if (live) setConfigs([]) })
    return () => { live = false }
  }, [enabled, sessionId])
  return enabled && sessionId ? configs : []
}

const launchBlocker = (config: GoIDERunConfiguration) => config.kind === 'compound' ? 'compound configurations are not supported yet' : config.environment?.some((entry) => entry.secret) ? 'needs secret values' : ''

function VerificationForm({ root, kind, setKind, busy, onAdd }: {
  root: string
  kind: VerificationType
  setKind: (kind: VerificationType) => void
  busy: boolean
  onAdd: (draft: AgentVerificationDraft) => Promise<void>
}) {
  const [label, setLabel] = useState('')
  const [packages, setPackages] = useState('./...')
  const [runFilter, setRunFilter] = useState('')
  const [coverage, setCoverage] = useState(false)
  const [method, setMethod] = useState('GET')
  const [url, setUrl] = useState('http://localhost:8080/health')
  const [expectedStatus, setExpectedStatus] = useState(200)
  const [body, setBody] = useState('')
  const [timeout, setTimeout] = useState(0)
  const [serviceId, setServiceId] = useState('')
  const [readyTimeout, setReadyTimeout] = useState(60)
  const runConfigs = useProjectRunConfigurations(root, kind === 'request')
  const serviceConfig = runConfigs.find((config) => config.id === serviceId && !launchBlocker(config))
  const submit = () => {
    const draft: AgentVerificationDraft = kind === 'test'
      ? { kind: VerificationKind.VerificationTest, label: label.trim() || 'Language tests', language: 'go', packages: packages.split(',').map((item) => item.trim()).filter(Boolean), run: runFilter.trim(), coverage, timeoutSeconds: timeout }
      : { kind: VerificationKind.VerificationRequest, label: label.trim() || `${method} ${url}`, method, url: url.trim(), body, expectedStatus, timeoutSeconds: timeout,
        service: serviceConfig ? { name: serviceConfig.name, configuration: JSON.stringify(serviceConfig), readyTimeoutSeconds: readyTimeout } : {} }
    void onAdd(draft)
  }
  return <div className="flex flex-col gap-2 rounded border border-border-1 p-2">
    <div className="flex flex-wrap items-end gap-2">
      <CodeStudioField label="Type">
        <select className="gs-input h-7 text-[11px]" value={kind} onChange={(event) => setKind(event.target.value as VerificationType)} aria-label="Verification type">
          <option value="test">Language test</option>
          <option value="request">HTTP request</option>
        </select>
      </CodeStudioField>
      <CodeStudioField label="Label" className="min-w-40 flex-1"><input className="gs-input h-7 text-[11px]" value={label} placeholder={kind === 'test' ? 'Unit tests' : 'Health check'} onChange={(event) => setLabel(event.target.value)} /></CodeStudioField>
      <CodeStudioField label="Timeout (s)" hint="0 = default"><input type="number" min={0} max={600} className="gs-input h-7 w-24 text-[11px]" value={timeout} onChange={(event) => setTimeout(Number(event.target.value) || 0)} /></CodeStudioField>
    </div>
    {kind === 'test' ? <div className="flex flex-wrap items-end gap-2">
      <CodeStudioField label="Packages" className="min-w-40 flex-1" hint="Comma separated, relative to the workspace"><input className="gs-input h-7 font-mono text-[11px]" value={packages} onChange={(event) => setPackages(event.target.value)} /></CodeStudioField>
      <CodeStudioField label="Run filter" hint="-run expression"><input className="gs-input h-7 w-40 font-mono text-[11px]" value={runFilter} onChange={(event) => setRunFilter(event.target.value)} /></CodeStudioField>
      <label className="gs-check"><input type="checkbox" checked={coverage} onChange={(event) => setCoverage(event.target.checked)} />Coverage</label>
    </div> : <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <CodeStudioField label="Method"><select className="gs-input h-7 w-24 text-[11px]" value={method} onChange={(event) => setMethod(event.target.value)} aria-label="HTTP method">{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((item) => <option key={item} value={item}>{item}</option>)}</select></CodeStudioField>
        <CodeStudioField label="URL" className="min-w-60 flex-1" hint="Loopback only unless the host is approved"><input className="gs-input h-7 font-mono text-[11px]" value={url} onChange={(event) => setUrl(event.target.value)} /></CodeStudioField>
        <CodeStudioField label="Expected status"><input type="number" min={100} max={599} className="gs-input h-7 w-28 text-[11px]" value={expectedStatus} onChange={(event) => setExpectedStatus(Number(event.target.value) || 200)} /></CodeStudioField>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <CodeStudioField label="Start before the request" className="min-w-60 flex-1" hint={runConfigs.length ? 'Started in the task workspace, stopped when the verification ends' : 'Open this project in Code Studio to pick one of its run configurations'}>
          <select className="gs-input h-7 text-[11px]" value={serviceConfig ? serviceId : ''} onChange={(event) => setServiceId(event.target.value)} aria-label="Run configuration to start">
            <option value="">Nothing — the service is already running</option>
            {runConfigs.map((config) => { const blocker = launchBlocker(config); return <option key={config.id} value={config.id} disabled={!!blocker}>{config.name}{blocker ? ` (${blocker})` : ''}</option> })}
          </select>
        </CodeStudioField>
        {serviceConfig && <CodeStudioField label="Ready within (s)"><input type="number" min={1} max={300} className="gs-input h-7 w-24 text-[11px]" value={readyTimeout} onChange={(event) => setReadyTimeout(Number(event.target.value) || 60)} /></CodeStudioField>}
      </div>
      <CodeStudioField label="Body" hint="Optional; sent as-is"><textarea className="gs-input min-h-14 font-mono text-[11px]" value={body} onChange={(event) => setBody(event.target.value)} /></CodeStudioField>
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <CodeStudioButton small variant="primary" icon={kind === 'test' ? Play : Send} loading={busy} onClick={submit}>Add verification</CodeStudioButton>
      <span className="text-[10px] text-text-4">Definitions are saved with the task; running one records new evidence.</span>
    </div>
  </div>
}

function consecutiveCorrections(task: { attempts?: Array<{ correctionOf?: string }> | null }): number {
  const attempts = task.attempts ?? []
  let count = 0
  for (let index = attempts.length - 1; index >= 0 && attempts[index].correctionOf; index--) count++
  return count
}

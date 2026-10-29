import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Bot, Download, Loader2, RefreshCw } from 'lucide-react'
import { confirm } from '@/lib/confirmDialog'
import { ContextReceipt, Draft, Intent, type AgentTask } from '@/lib/agent-task-api'
import {
  auditSkillInfo, auditSkillInstall, auditSkillInstallPlan, auditSkillPrepare, auditSkillReport, auditSkillRuns,
  type AuditProfile, type AuditReport, type AuditRun, type AuditSkillInfo, type AuditVerdict,
} from '@/lib/auditskill-api'
import { AUDIT_AGENT_OPTIONS, auditAgentOption, auditTimeoutMinutes, type AuditTaskAgent } from '@/lib/auditAgents'
import { useAgentTaskStore, noAgentTasks } from '@/stores/agentTasks'
import { useCodeStudioAssistantStore } from '@/stores/codeStudioAssistant'
import { usePiAgentStore } from '@/stores/piAgent'
import { useClaudeCodeStore } from '@/stores/claudeCode'
import { useMilkStore } from '@/stores/milk'
import type { AgentChatStore } from '@/stores/agentChat'
import { SecurityProjectPicker } from './SecurityProjectPicker'

const AGENT_STORES: Record<AuditTaskAgent, AgentChatStore> = { pi: usePiAgentStore, claude: useClaudeCodeStore, milk: useMilkStore }

const PROFILES: Array<{ id: AuditProfile; label: string; hint: string }> = [
  { id: 'quick', label: 'Quick', hint: 'One hunter wave and one critic pass: a partial first look' },
  { id: 'standard', label: 'Standard', hint: 'The full six-phase workflow' },
  { id: 'deep', label: 'Deep', hint: 'Finer coverage units and repeated critic waves for high-stakes code' },
]

const VERDICT_LABEL: Record<AuditVerdict, string> = { confirmed: 'Confirmed', needs_validation: 'Needs validation', rejected: 'Rejected' }
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'] as const
const ACTIVE = new Set(['running', 'waiting_permission', 'stopping'])

const message = (cause: unknown) => String(cause instanceof Error ? cause.message : cause)

/**
 * Audit del codice con la skill security-audit di Cloudflare. Lo esegue l'agente scelto nella chat AI di
 * Code Studio (stessa scelta, stessa configurazione, stessi permessi), come Agent Task: il Security Center
 * prepara il prompt, segue il task e legge findings.json e REPORT.md scritti dalla skill.
 */
export function SecurityAuditSkillPanel({ initialProject }: { initialProject?: string }) {
  const pane = useCodeStudioAssistantStore((state) => state.lastProvider)
  const option = auditAgentOption(pane)
  // Gli hook si chiamano sempre tutti: si sceglie il risultato, non l'hook.
  const piStatus = usePiAgentStore((state) => state.status)
  const claudeStatus = useClaudeCodeStore((state) => state.status)
  const milkStatus = useMilkStore((state) => state.status)
  const piPermissions = usePiAgentStore((state) => state.permissions)
  const claudePermissions = useClaudeCodeStore((state) => state.permissions)
  const milkPermissions = useMilkStore((state) => state.permissions)
  const agentStatus = option.agent === 'pi' ? piStatus : option.agent === 'claude' ? claudeStatus : option.agent === 'milk' ? milkStatus : null
  const allPermissions = option.agent === 'pi' ? piPermissions : option.agent === 'claude' ? claudePermissions : option.agent === 'milk' ? milkPermissions : []
  const [project, setProject] = useState(initialProject ?? '')
  const [profile, setProfile] = useState<AuditProfile>('standard')
  const [focus, setFocus] = useState('')
  const [info, setInfo] = useState<AuditSkillInfo | null>(null)
  const [runs, setRuns] = useState<AuditRun[]>([])
  const [selectedRun, setSelectedRun] = useState<number | null>(null)
  const [report, setReport] = useState<AuditReport | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const root = project.trim()
  const tasks = useAgentTaskStore((state) => (root ? state.tasksByRoot[root] : undefined) ?? noAgentTasks)
  const task: AgentTask | null = tasks.find((item) => item.id === taskId) ?? null
  const running = !!task && ACTIVE.has(task.status)
  const agentReady = agentStatus?.state === 'ready'
  const permissions = useMemo(() => (task ? allPermissions.filter((entry) => entry.sessionKey === task.activeAttemptId) : []), [allPermissions, task])

  const refreshInfo = useCallback(() => { void auditSkillInfo().then(setInfo).catch((cause) => setError(message(cause))) }, [])
  useEffect(refreshInfo, [refreshInfo])
  useEffect(() => { if (option.agent) void AGENT_STORES[option.agent].getState().ensure() }, [option.agent])
  useEffect(() => { if (root) void useAgentTaskStore.getState().load(root) }, [root])

  const refreshRuns = useCallback(async () => {
    if (!root) { setRuns([]); return }
    try {
      const next = await auditSkillRuns(root)
      setRuns(next)
      setSelectedRun((current) => (current && next.some((run) => run.number === current) ? current : next[0]?.number ?? null))
    } catch (cause) { setError(message(cause)) }
  }, [root])
  useEffect(() => { void refreshRuns() }, [refreshRuns])

  // A task concluso la skill ha scritto (o non ha scritto) i file: si rilegge la cartella.
  const taskStatus = task?.status
  useEffect(() => { if (taskStatus && !ACTIVE.has(taskStatus)) void refreshRuns() }, [taskStatus, refreshRuns])

  useEffect(() => {
    if (!root || selectedRun === null) { setReport(null); return }
    let current = true
    auditSkillReport(root, selectedRun).then((next) => current && setReport(next)).catch((cause) => current && setError(message(cause)))
    return () => { current = false }
  }, [root, selectedRun, taskStatus])

  const install = async () => {
    try {
      const plan = await auditSkillInstallPlan()
      const approved = await confirm({ title: 'Install the security-audit skill?', message: `${plan.note}\n\n${plan.command}`, confirmLabel: 'Install skill' })
      if (!approved) return
      setError(null); setInstalling(true)
      setInfo(await auditSkillInstall())
    } catch (cause) { setError(message(cause)) } finally { setInstalling(false) }
  }

  const start = async () => {
    setError(null)
    if (!root) { setError('Select the project folder to audit.'); return }
    if (!option.agent) { setError(`${option.label} cannot run the audit: ${option.unsupported}. Choose a coding agent.`); return }
    try {
      const prepared = await auditSkillPrepare(root, profile, focus)
      const approved = await confirm({
        title: `Audit with ${option.label}?`,
        message: `${option.label} reads ${root} following Cloudflare's security-audit skill (${profile} profile). The code it reads goes to the model configured for ${option.label}${agentStatus?.model ? ` (${agentStatus.model})` : ''}, under the same permissions as its chat.\n\nResults are written to ${prepared.run.dir}, outside the repository; the project files are not modified. An audit can take hours and use many tokens.${option.note ? `\n\n${option.note}` : ''}\n\nOnly audit code you are allowed to test.`,
        confirmLabel: 'Start audit',
      })
      if (!approved) return
      const store = useAgentTaskStore.getState()
      const created = await store.create(new Draft({
        root, intent: Intent.IntentAnalysis,
        objective: `Security audit with the security-audit skill · run-${prepared.run.number} · ${profile}`,
        criteria: ['findings.json validated by validate-findings.cjs', 'REPORT.md written in the output directory'],
        paths: [], dependencies: [], agent: option.agent,
        limits: { timeoutMinutes: auditTimeoutMinutes(profile), maxContextBytes: 16 * 1024 },
      }))
      setTaskId(created.id)
      setSelectedRun(prepared.run.number)
      const bytes = new TextEncoder().encode(prepared.prompt).length
      await store.start(created.id, prepared.prompt, new ContextReceipt({ bytes, sources: 0, excluded: 0, truncated: false, includesUnsaved: false }))
    } catch (cause) { setError(message(cause)) }
  }

  const stop = () => { if (task) void useAgentTaskStore.getState().stop(task.id).catch((cause) => setError(message(cause))) }
  const respond = (requestId: string, allow: boolean) => { if (option.agent) void AGENT_STORES[option.agent].getState().respondPermission(requestId, allow) }

  const confirmed = report?.findings.filter((finding) => finding.verdict === 'confirmed') ?? []
  const counts = confirmed.reduce<Record<string, number>>((all, finding) => ({ ...all, [finding.severity ?? 'informational']: (all[finding.severity ?? 'informational'] ?? 0) + 1 }), {})
  const pending = report?.findings.filter((finding) => finding.verdict === 'needs_validation').length ?? 0
  const attempt = task ? task.attempts.find((item) => item.id === task.activeAttemptId) ?? task.attempts[task.attempts.length - 1] : undefined
  const lastEvents = attempt?.events.slice(-6) ?? []
  const canRun = !!info?.installed && !!option.agent && agentReady && !!root && !running

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sec-bar">
        <SecurityProjectPicker value={project} onChange={setProject} disabled={running} className="min-w-[340px] flex-1" />
        <div role="group" aria-label="Audit profile" className="sec-segs">
          {PROFILES.map((item) => (
            <button key={item.id} type="button" className="sec-seg" aria-pressed={profile === item.id} disabled={running} title={item.hint} onClick={() => setProfile(item.id)}>{item.label}</button>
          ))}
        </div>
        {running ? (
          <button type="button" className="sec-scan" onClick={stop} data-running="true"><span className="sec-scan-label">Stop</span><span className="sec-scan-dot" aria-hidden="true" /></button>
        ) : (
          <button type="button" className="sec-scan" onClick={() => void start()} disabled={!canRun} title={canRun ? 'Start the audit as an agent task' : 'Install the skill and choose a ready coding agent first'}>
            <span className="sec-scan-label">Audit</span><span className="sec-scan-dot" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="sec-bar" style={{ paddingTop: 0 }}>
        <label className="sec-field" title="The same agent as the Code Studio AI chat: changing it here changes it there too">
          <Bot size={13} aria-hidden="true" />
          <select value={pane} disabled={running} aria-label="Agent" onChange={(event) => useCodeStudioAssistantStore.getState().choose(auditAgentOption(event.target.value as typeof pane).pane)}>
            {AUDIT_AGENT_OPTIONS.map((item) => (
              <option key={item.pane} value={item.pane} disabled={!item.agent}>{item.label}{item.agent ? '' : ' · not a coding agent'}</option>
            ))}
          </select>
        </label>
        <span className="sec-muted text-[11px]" role="status">
          {!option.agent ? option.unsupported : agentReady ? `ready${agentStatus?.model ? ` · ${agentStatus.model}` : ''}` : agentStatus?.message || 'not ready: enable and configure it from the Code Studio AI chat'}
        </span>
        <label className="sec-field min-w-[220px] flex-1">
          <input value={focus} onChange={(event) => setFocus(event.target.value)} disabled={running} aria-label="Priority" placeholder="Prioritise, e.g. auth and IPC bindings" className="w-full" />
        </label>
      </div>

      {error && (
        <div className="sec-error" role="alert">
          <AlertCircle size={13} aria-hidden="true" /><span>{error}</span>
          <button type="button" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      <div className="sec-body">
        {info && (!info.installed || (info.managed && !info.current)) && (
          <div className="sec-note" data-tone="warn">
            <span>{info.installed ? <><b>A newer version of the skill is pinned.</b> Update the copy in {info.dir}.</> : <><b>The security-audit skill is not installed.</b> Cloudflare's open-source (MIT) audit workflow, installed once for every agent in {info.dir}.</>}</span>
            <button type="button" className="sec-btn" disabled={installing} onClick={() => void install()}>
              {installing ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} {info.installed ? 'Update skill' : 'Install skill'}
            </button>
          </div>
        )}
        {info?.installed && !info.managed && <p className="sec-muted text-[11px]">Using the security-audit skill already in {info.dir} (not installed by adOmnia, left as it is).</p>}
        {info && !info.nodeFound && <div className="sec-note" data-tone="warn"><span>Node.js was not found: the agent cannot run the skill's validators, so findings.json may stay unvalidated.</span></div>}
        {option.note && <p className="sec-muted text-[11px]">{option.note}</p>}

        {!task && runs.length === 0 && (
          <div className="sec-hero">
            <span className="sec-hero-mark" aria-hidden="true">···</span>
            <h2 className="sec-label">Audit the code with your coding agent</h2>
            <p>
              The agent you use in the Code Studio AI chat maps the architecture and trust boundaries, hunts by attack class, then tries to
              disprove every candidate. Only findings with a full source trace are confirmed; the rest stay as needs-validation with the exact
              missing fact. Runs add up: each new run reads the previous ones and targets their gaps.
            </p>
          </div>
        )}

        {task && (
          <section className="sec-section" aria-live="polite">
            <div className="sec-section-head">
              {running && <Loader2 size={14} className="animate-spin text-accent" aria-hidden="true" />}
              <h2 className="sec-label">{option.label} · {task.status.replace(/_/g, ' ')}</h2>
              <span className="sec-muted text-[11px]">Also in Code Studio → AI → Tasks</span>
            </div>
            {permissions.map((permission) => (
              <div key={permission.requestId} className="sec-note" role="alertdialog" aria-label="Agent tool permission">
                <span><b>{permission.title || 'The agent requests tool access'}</b>{permission.description ? ` · ${permission.description}` : ''}</span>
                <button type="button" className="sec-btn" onClick={() => respond(permission.requestId, true)}>Allow</button>
                <button type="button" className="sec-btn" onClick={() => respond(permission.requestId, false)}>Deny</button>
              </div>
            ))}
            <div className="mt-2 font-mono text-[11px] leading-relaxed text-text-3">
              {lastEvents.map((event) => <div key={event.id} className="truncate">{event.toolName ? `${event.toolName} · ${event.toolStatus ?? ''}` : event.message || event.kind}</div>)}
            </div>
          </section>
        )}

        {runs.length > 0 && (
          <section className="sec-section">
            <div className="sec-section-head">
              <h2 className="sec-label">Runs</h2>
              <div role="group" aria-label="Runs" className="sec-segs">
                {runs.map((run) => (
                  <button key={run.number} type="button" className="sec-seg" aria-pressed={selectedRun === run.number} title={run.dir} onClick={() => setSelectedRun(run.number)}>
                    run-{run.number}{run.status ? ` · ${run.status.replace(/_/g, ' ')}` : ''}
                  </button>
                ))}
              </div>
              <button type="button" className="sec-btn ml-auto" onClick={() => void refreshRuns()} title="Read the run folders again"><RefreshCw size={12} aria-hidden="true" /> Refresh</button>
            </div>
            {report?.missing?.length ? <p className="sec-muted text-[11px]">Not written yet: {report.missing.join(', ')} in {report.run.dir}</p> : null}
          </section>
        )}

        {report && report.findings.length > 0 && (
          <>
            <section className="sec-stats" aria-label="Audit summary">
              {SEVERITIES.map((level) => (
                <div key={level} className="sec-stat" data-tone={level === 'critical' ? 'error' : level === 'high' ? 'warning' : undefined}>
                  <div className="sec-stat-value" data-nonzero={(counts[level] ?? 0) > 0}>{counts[level] ?? 0}</div>
                  <div className="sec-stat-label">{level === 'informational' ? 'info' : level}</div>
                </div>
              ))}
              <div className="sec-stat"><div className="sec-stat-value" data-nonzero={pending > 0}>{pending}</div><div className="sec-stat-label">to validate</div></div>
            </section>
            <section className="sec-section">
              <div className="sec-section-head"><h2 className="sec-label">Findings</h2></div>
              <table className="sec-table">
                <tbody>
                  {report.findings.map((finding) => (
                    <tr key={finding.fingerprint} className="sec-row" style={{ cursor: 'default', opacity: finding.verdict === 'rejected' ? 0.6 : 1 }}>
                      <td className="whitespace-nowrap">
                        {finding.severity && <span className="sec-dot" data-band={finding.severity} />}
                        <span className="sec-prio uppercase">{finding.severity ?? VERDICT_LABEL[finding.verdict]}</span>
                      </td>
                      <td>
                        <span className="sec-id">{finding.title}</span>
                        <div className="sec-sub" style={{ maxWidth: 640 }}>{finding.description}</div>
                        {finding.remediation && <div className="sec-sub" style={{ maxWidth: 640 }}>Fix: {finding.remediation}</div>}
                        {finding.blockers?.map((blocker) => <div key={blocker} className="sec-sub" style={{ maxWidth: 640 }}>{finding.verdict === 'rejected' ? 'Rejected: ' : 'Missing: '}{blocker}</div>)}
                      </td>
                      <td className="sec-muted whitespace-nowrap text-[11px]">{VERDICT_LABEL[finding.verdict]}</td>
                      <td className="sec-mono sec-muted whitespace-nowrap">{finding.file}{finding.line ? `:${finding.line}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
        {report?.markdown && (
          <details className="sec-section">
            <summary className="sec-label cursor-pointer">REPORT.md</summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-text-2">{report.markdown}</pre>
          </details>
        )}
      </div>
    </div>
  )
}

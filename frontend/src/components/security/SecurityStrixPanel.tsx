import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Bot, Download, Loader2 } from 'lucide-react'
import { confirm } from '@/lib/confirmDialog'
import { buildAIConfig, buildAIConfigFor } from '@/lib/aiEngine'
import { resolveSecret } from '@/lib/vaultRefs'
import { useEnvironmentsStore } from '@/stores/environments'
import { PROVIDER_LABELS, strixAgentOptions } from '@/lib/strixAgents'
import { useSettingsStore } from '@/stores/settings'
import { saveTextFile } from '@/lib/fileUtils'
import {
  isStrixActive,
  strixCancel,
  strixExportMarkdown,
  strixInfo,
  strixInstall,
  strixInstallPlan,
  strixReport,
  strixStart,
  strixStatus,
  type StrixInfo,
  type StrixMode,
  type StrixReport,
  type StrixRun,
  type StrixSeverity,
} from '@/lib/strix-api'
import { SecurityProjectPicker } from './SecurityProjectPicker'

const POLL_MS = 2000
const MODES: Array<{ id: StrixMode; label: string; hint: string }> = [
  { id: 'quick', label: 'Quick', hint: 'Minutes: the obvious, high-impact issues' },
  { id: 'standard', label: 'Standard', hint: 'A balanced pass' },
  { id: 'deep', label: 'Deep', hint: 'Hours: thorough multi-agent testing' },
]

const STATE_LABEL: Record<string, string> = {
  preparing: 'Copying the project…',
  running: 'Strix is testing…',
  finished: 'Finished: no vulnerabilities found',
  found: 'Finished: vulnerabilities found',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const message = (cause: unknown) => String(cause instanceof Error ? cause.message : cause)

/**
 * Pentest con Strix (https://github.com/usestrix/strix): agenti AI che provano a sfruttare le falle del progetto.
 * Gira su una COPIA del progetto, in un sandbox Docker; il codice va al provider AI scelto in Settings → AI,
 * quindi ogni scansione parte solo dopo una conferma che lo dice.
 */
export function SecurityStrixPanel({ initialProject }: { initialProject?: string }) {
  const ai = useSettingsStore((state) => state.settings.ai)
  const [info, setInfo] = useState<StrixInfo | null>(null)
  const [project, setProject] = useState(initialProject ?? '')
  const [mode, setMode] = useState<StrixMode>('quick')
  const [budget, setBudget] = useState('10')
  const [instruction, setInstruction] = useState('')
  const [customModel, setCustomModel] = useState('')
  const environments = useEnvironmentsStore((state) => state.environments)
  const activeEnvId = useEnvironmentsStore((state) => state.activeEnvId)
  const agents = useMemo(() => strixAgentOptions(environments, activeEnvId, ai), [environments, activeEnvId, ai])
  // 'settings' = il provider di Settings → AI; altrimenti il provider di una chiave trovata negli Environments.
  const [agent, setAgent] = useState<string>('settings')
  const [agentModel, setAgentModel] = useState('')
  const chosenAgent = agent === 'settings' ? null : agents.find((item) => item.provider === agent) ?? null
  const [run, setRun] = useState<StrixRun | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [report, setReport] = useState<StrixReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const offset = useRef(0)
  const logEnd = useRef<HTMLDivElement>(null)

  const refreshInfo = useCallback(() => { void strixInfo().then(setInfo).catch((cause) => setError(message(cause))) }, [])
  useEffect(refreshInfo, [refreshInfo])

  const active = isStrixActive(run?.state) || installing

  // Una sola richiesta di stato alla volta; l'output arriva a pezzi dall'indice già visto.
  useEffect(() => {
    if (!run || !(isStrixActive(run.state) || installing)) return
    let stopped = false
    const poll = async () => {
      try {
        const next = await strixStatus(run.id, offset.current)
        if (stopped) return
        offset.current = next.offset
        if (next.output.length) setLines((current) => [...current, ...next.output].slice(-1500))
        setRun((current) => (current ? { ...current, ...next, output: [] } : next))
        if (!isStrixActive(next.state)) {
          if (installing) { setInstalling(false); refreshInfo() }
        }
      } catch (cause) {
        if (!stopped) setError(message(cause))
      }
    }
    const timer = window.setInterval(() => void poll(), POLL_MS)
    void poll()
    return () => { stopped = true; window.clearInterval(timer) }
  }, [run?.id, run?.state, installing, refreshInfo])

  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'end' }) }, [lines.length])

  // I risultati si leggono a scansione conclusa (anche se fallita: Strix può aver scritto un report parziale).
  useEffect(() => {
    if (!run || run.mode === 'install' || !['finished', 'found', 'failed'].includes(run.state)) return
    let current = true
    void strixReport(run.id).then((result) => current && setReport(result)).catch(() => undefined)
    return () => { current = false }
  }, [run?.id, run?.state, run?.mode])

  const begin = (next: StrixRun) => { offset.current = 0; setLines([]); setReport(null); setRun(next) }

  const install = async () => {
    try {
      const plan = await strixInstallPlan()
      const approved = await confirm({
        title: 'Install Strix?',
        message: `${plan.note}\n\nCommand: ${plan.command}\n\nThe output appears below.`,
        confirmLabel: 'Install Strix',
      })
      if (!approved) return
      setError(null); setInstalling(true)
      begin(await strixInstall())
    } catch (cause) { setInstalling(false); setError(message(cause)) }
  }

  const start = async () => {
    setError(null)
    if (!project.trim()) { setError('Select the project folder to scan.'); return }
    if (chosenAgent && !customModel.trim() && !agentModel.trim()) { setError(`Enter the ${PROVIDER_LABELS[chosenAgent.provider]} model to use.`); return }
    const model = customModel.trim() || (chosenAgent ? `${chosenAgent.provider}/${agentModel.trim()}` : `${ai.provider}/${ai.model}`)
    const approved = await confirm({
      title: 'Run a Strix pentest?',
      message: `Strix runs AI agents that read your code and actively try to exploit it, inside a Docker sandbox, on a private copy of ${project.trim()} (secrets such as .env and key files are left out; your files are never modified).\n\nThe code the agents read is sent to your AI provider: ${model}. A scan can use a lot of tokens — the budget below caps the spend.\n\nOnly scan code you are allowed to test.`,
      confirmLabel: 'Run pentest',
    })
    if (!approved) return
    try {
      const options = { root: project.trim(), mode, maxBudget: Number(budget) > 0 ? Number(budget) : undefined, instruction: instruction.trim() || undefined }
      const aiConfig = chosenAgent ? buildAIConfigFor(chosenAgent.provider, agentModel.trim(), await resolveSecret(chosenAgent.credential.value)) : await buildAIConfig()
      begin(await strixStart(options, aiConfig, customModel.trim()))
    } catch (cause) { setError(message(cause)) }
  }

  const stop = () => { if (run) void strixCancel(run.id).catch((cause) => setError(message(cause))) }

  const exportMarkdown = async () => {
    if (!run) return
    try {
      const markdown = await strixExportMarkdown(run.id)
      await saveTextFile(`strix-${new Date().toISOString().slice(0, 10)}.md`, markdown, 'text/markdown')
    } catch (cause) { setError(message(cause)) }
  }

  const ready = info?.installed && info.dockerReady
  const counts = report?.findings.reduce<Record<string, number>>((all, finding) => ({ ...all, [finding.severity]: (all[finding.severity] ?? 0) + 1 }), {}) ?? {}
  const bandOf = (severity: StrixSeverity) => (severity === 'info' ? 'informational' : severity)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sec-bar">
        <SecurityProjectPicker value={project} onChange={setProject} disabled={active} className="min-w-[340px] flex-1" />
        <div role="group" aria-label="Scan depth" className="sec-segs">
          {MODES.map((item) => (
            <button key={item.id} type="button" className="sec-seg" aria-pressed={mode === item.id} disabled={active} title={item.hint} onClick={() => setMode(item.id)}>{item.label}</button>
          ))}
        </div>
        <label className="sec-field" title="Maximum LLM spend for the whole scan">
          <span>Budget $</span>
          <input value={budget} onChange={(event) => setBudget(event.target.value.replace(/[^0-9.]/g, ''))} disabled={active} inputMode="decimal" aria-label="Budget in dollars" className="w-12 font-mono" />
        </label>
        {isStrixActive(run?.state) ? (
          <button type="button" className="sec-scan" onClick={stop} data-running="true"><span className="sec-scan-label">Stop</span><span className="sec-scan-dot" aria-hidden="true" /></button>
        ) : (
          <button type="button" className="sec-scan" onClick={() => void start()} disabled={!ready || active} title={ready ? 'Run the pentest on a copy of the project' : 'Strix and Docker must be ready first'}>
            <span className="sec-scan-label">Run</span><span className="sec-scan-dot" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="sec-bar" style={{ paddingTop: 0 }}>
        <label className="sec-field" title="The agent Strix thinks with: the provider from Settings → AI, or any key found in your Environments">
          <Bot size={13} aria-hidden="true" />
          <select
            value={agent}
            disabled={active}
            aria-label="Agent"
            onChange={(event) => {
              setAgent(event.target.value)
              setAgentModel(agents.find((item) => item.provider === event.target.value)?.suggestedModel ?? '')
            }}
            className="max-w-[320px]"
          >
            <option value="settings">{ai.model ? `Settings → AI · ${ai.provider} · ${ai.model}` : 'Settings → AI (no model configured)'}</option>
            {agents.map((item) => (
              <option key={item.provider} value={item.provider}>{PROVIDER_LABELS[item.provider]} · {item.credential.key} · {item.credential.environmentName}</option>
            ))}
          </select>
        </label>
        {chosenAgent && (
          <label className="sec-field">
            <input value={agentModel} onChange={(event) => setAgentModel(event.target.value)} disabled={active} spellCheck={false} aria-label="Model" placeholder={`${chosenAgent.provider} model id`} className="w-56 font-mono" />
          </label>
        )}
        <label className="sec-field">
          <input value={customModel} onChange={(event) => setCustomModel(event.target.value)} disabled={active} spellCheck={false} aria-label="Custom LiteLLM model" placeholder="Custom model id, e.g. github_copilot/gpt-4o" className="w-72 font-mono" />
        </label>
        <label className="sec-field min-w-[220px] flex-1">
          <input value={instruction} onChange={(event) => setInstruction(event.target.value)} disabled={active} aria-label="Focus" placeholder="Focus, e.g. auth bypass and IDOR" className="w-full" />
        </label>
      </div>

      {error && (
        <div className="sec-error" role="alert">
          <AlertCircle size={13} aria-hidden="true" /><span>{error}</span>
          <button type="button" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      <div className="sec-body">
        {info && !info.installed && (
          <div className="sec-note" data-tone="warn">
            <span><b>Strix is not installed.</b> It is an open-source CLI (Apache-2.0) that adOmnia runs locally, in Docker.</span>
            <button type="button" className="sec-btn" disabled={installing} onClick={() => void install()}>
              {installing ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Install Strix
            </button>
          </div>
        )}
        {info?.installed && !info.dockerReady && (
          <div className="sec-note" data-tone="warn">
            <span>{info.dockerNote}</span>
            <button type="button" className="sec-btn" onClick={refreshInfo}>Check again</button>
          </div>
        )}

        {!run && (
          <div className="sec-hero">
            <span className="sec-hero-mark" aria-hidden="true">···</span>
            <h2 className="sec-label">Let AI hackers attack your code</h2>
            <p>
              Strix agents run your project in a Docker sandbox and try real exploits, then report only what they could prove, with a proof of
              concept and a fix. The scan works on a private copy, so your files are never changed, and the whole assessment exports as Markdown.
            </p>
            {info?.version && <p className="sec-muted">{info.version}</p>}
          </div>
        )}

        {run && (
          <>
            <div className="sec-section-head" style={{ marginTop: 24 }}>
              {isStrixActive(run.state) && <Loader2 size={14} className="animate-spin text-accent" aria-hidden="true" />}
              <h2 className="sec-label">{installing ? 'Installing Strix' : STATE_LABEL[run.state] ?? run.state}</h2>
              {run.files > 0 && <span className="sec-muted text-[11px]">{run.files} files</span>}
              {run.error && <span className="text-[11px]" style={{ color: 'var(--color-error, #ff453a)' }}>{run.error}</span>}
              {report && <button type="button" className="sec-btn ml-auto" onClick={() => void exportMarkdown()}><Download size={13} aria-hidden="true" /> Export as MD</button>}
            </div>

            {report && (
              <>
                <section className="sec-stats" aria-label="Pentest summary">
                  {(['critical', 'high', 'medium', 'low', 'info'] as StrixSeverity[]).map((level) => (
                    <div key={level} className="sec-stat" data-tone={level === 'critical' ? 'error' : level === 'high' ? 'warning' : undefined}>
                      <div className="sec-stat-value" data-nonzero={(counts[level] ?? 0) > 0}>{counts[level] ?? 0}</div>
                      <div className="sec-stat-label">{level}</div>
                    </div>
                  ))}
                  {report.costUsd ? <div className="sec-stat"><div className="sec-stat-value">${report.costUsd.toFixed(2)}</div><div className="sec-stat-label">LLM cost</div></div> : null}
                </section>
                <section className="sec-section">
                  <div className="sec-section-head"><h2 className="sec-label">Findings</h2></div>
                  {report.findings.length === 0 && <p className="sec-empty">No findings were reported.</p>}
                  <table className="sec-table">
                    <tbody>
                      {report.findings.map((finding, index) => (
                        <tr key={`${finding.id}-${index}`} className="sec-row" style={{ cursor: 'default' }}>
                          <td className="whitespace-nowrap"><span className="sec-dot" data-band={bandOf(finding.severity)} /><span className="sec-prio uppercase">{finding.severity}</span></td>
                          <td><span className="sec-id">{finding.title}</span>{finding.message && <div className="sec-sub" style={{ maxWidth: 640 }}>{finding.message}</div>}</td>
                          <td className="sec-mono sec-muted whitespace-nowrap">{finding.file}{finding.line ? `:${finding.line}` : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                {report.markdown && (
                  <details className="sec-section">
                    <summary className="sec-label cursor-pointer">Full assessment report</summary>
                    <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-text-2">{report.markdown}</pre>
                  </details>
                )}
              </>
            )}

            <details open={isStrixActive(run.state) || !report} className="sec-section">
              <summary className="sec-label cursor-pointer">Output</summary>
              <div className="mt-3 max-h-80 overflow-auto border-t border-border-1 pt-3 font-mono text-[11px] leading-relaxed text-text-3">
                {lines.map((line, index) => <div key={index} className="whitespace-pre-wrap break-all">{line}</div>)}
                <div ref={logEnd} />
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  )
}

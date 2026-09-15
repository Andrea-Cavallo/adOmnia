import { useMemo, useState } from 'react'
import { Bot, Clock3, Download, Gauge, Puzzle, Save, Settings2, ShieldAlert, X } from 'lucide-react'
import { downloadText } from '@/lib/fileUtils'
import {
  BUILTIN_DIAGNOSTIC_RULES,
  DEFAULT_PARSING_PROFILE,
  buildAiLogContext,
  buildExecutionMetrics,
  compareVersions,
  evaluateDiagnosticRules,
  exportParsingProfile,
  importDiagnosticRules,
  importParsingProfile,
  loadDiagnosticRules,
  loadParsingProfiles,
  saveDiagnosticRules,
  saveParsingProfiles,
  summarizeLogInvestigation,
  type AnalyzedRequest,
  type DiagnosticRule,
  type LogAnalysis,
  type LogEvent,
  type MetricDimension,
  type ParsingProfile,
} from '@/lib/loginspector'
import type { LogSessionSource } from './useLogImport'

type Tab = 'integrity' | 'parsing' | 'metrics' | 'rules' | 'ai'

interface Props {
  events: LogEvent[]
  analysis: LogAnalysis
  sources: LogSessionSource[]
  selectedRequest: AnalyzedRequest | null
  maskFields: string[]
  onConfigureSource: (id: string, config: { parsingProfile?: ParsingProfile; clockOffsetMs?: number }) => void
  onSelectEventId: (id: number) => void
  onClose: () => void
}

const TABS: { id: Tab; label: string; icon: typeof Clock3 }[] = [
  { id: 'integrity', label: 'Integrity', icon: Clock3 },
  { id: 'parsing', label: 'Parsing profiles', icon: Settings2 },
  { id: 'metrics', label: 'Metrics', icon: Gauge },
  { id: 'rules', label: 'Diagnostic rules', icon: Puzzle },
  { id: 'ai', label: 'AI assistant', icon: Bot },
]

function ms(value: number | null): string {
  if (value === null) return 'n/d'
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`
}

export function AdvancedAnalysisPanel({ events, analysis, sources, selectedRequest, maskFields, onConfigureSource, onSelectEventId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('integrity')
  const [profiles, setProfiles] = useState(loadParsingProfiles)
  const [profileDraft, setProfileDraft] = useState(() => exportParsingProfile({
    ...DEFAULT_PARSING_PROFILE,
    id: 'custom-profile',
    name: 'Custom profile',
    fieldMappings: { timestamp: ['logged_at'], service: ['app_name'], correlationId: ['context.correlation'], duration: ['elapsed_us'], requestBody: ['payload.in'], responseBody: ['payload.out'] },
    durationUnit: 'us',
  }))
  const [profileMessage, setProfileMessage] = useState('')
  const [dimension, setDimension] = useState<MetricDimension>('route')
  const [rules, setRules] = useState<DiagnosticRule[]>(loadDiagnosticRules)
  const [rulesDraft, setRulesDraft] = useState(() => JSON.stringify(loadDiagnosticRules(), null, 2))
  const [rulesMessage, setRulesMessage] = useState('')
  const [aiResult, setAiResult] = useState('')
  const [aiError, setAiError] = useState('')
  const [aiRunning, setAiRunning] = useState(false)

  const metrics = useMemo(() => buildExecutionMetrics(analysis, dimension), [analysis, dimension])
  const versions = useMemo(() => [...new Set(analysis.requests.map((request) => request.serviceVersion).filter(Boolean))], [analysis.requests])
  const [baselineVersion, setBaselineVersion] = useState('')
  const [currentVersion, setCurrentVersion] = useState('')
  const comparisons = useMemo(() => baselineVersion && currentVersion
    ? compareVersions(analysis, baselineVersion, currentVersion, dimension) : [], [analysis, baselineVersion, currentVersion, dimension])
  const findings = useMemo(() => evaluateDiagnosticRules(events, rules), [events, rules])
  const aiContext = useMemo(() => buildAiLogContext(events, selectedRequest, maskFields), [events, maskFields, selectedRequest])

  const saveProfile = () => {
    try {
      const profile = importParsingProfile(profileDraft)
      const next = [...profiles.filter((item) => item.id !== profile.id), profile]
      saveParsingProfiles(next)
      setProfiles(next)
      setProfileMessage(`Saved ${profile.name}. Assign it to a source below.`)
    } catch (error) { setProfileMessage(error instanceof Error ? error.message : 'Invalid profile') }
  }

  const applyRules = () => {
    try {
      const next = importDiagnosticRules(rulesDraft)
      saveDiagnosticRules(next)
      setRules(next)
      setRulesMessage(`Saved ${next.length} versioned rule(s).`)
    } catch (error) { setRulesMessage(error instanceof Error ? error.message : 'Invalid rules') }
  }

  const runAi = async () => {
    setAiRunning(true)
    setAiError('')
    try { setAiResult(await summarizeLogInvestigation(events, selectedRequest, maskFields)) }
    catch (error) { setAiError(error instanceof Error ? error.message : 'AI summary failed') }
    finally { setAiRunning(false) }
  }

  return (
    <div className="absolute inset-0 z-40 flex bg-surface-0/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Advanced log analysis">
      <div className="m-3 flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border-2 bg-surface-0 shadow-2xl">
        <nav className="w-44 shrink-0 border-r border-border-1 bg-surface-1 p-2">
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-text-4">Advanced analysis</p>
          {TABS.map((item) => {
            const Icon = item.icon
            return <button key={item.id} onClick={() => setTab(item.id)} className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[11px] ${tab === item.id ? 'bg-accent/15 text-accent-light' : 'text-text-3 hover:bg-surface-2 hover:text-text-1'}`}><Icon size={12} />{item.label}</button>
          })}
        </nav>
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-10 shrink-0 items-center border-b border-border-1 px-4">
            <h2 className="text-xs font-semibold text-text-1">{TABS.find((item) => item.id === tab)?.label}</h2>
            <button onClick={onClose} title="Close advanced analysis" className="ml-auto grid h-7 w-7 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1"><X size={14} /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {tab === 'integrity' && (
              <div>
                <p className="mb-3 text-[11px] text-text-3">Corrections are always explicit. The event detail preserves the original timestamp beside corrected time.</p>
                {analysis.integrityIssues.length ? analysis.integrityIssues.map((issue, index) => (
                  <button key={`${issue.kind}-${index}`} onClick={() => issue.eventIds[0] !== undefined && onSelectEventId(issue.eventIds[0])} className="mb-2 block w-full rounded border border-border-1 bg-surface-1 p-3 text-left hover:border-accent/40">
                    <span className={issue.severity === 'warn' ? 'text-warning' : 'text-info'}><ShieldAlert size={12} className="mr-1 inline" />{issue.title}</span>
                    <p className="mt-1 text-[10px] text-text-3">{issue.detail}</p>
                    <p className="mt-1 font-mono text-[9px] text-text-4">{issue.sourceIds.join(', ')} · {issue.eventIds.length} evidence event(s)</p>
                  </button>
                )) : <p className="rounded border border-success/30 bg-success/10 p-3 text-[11px] text-success">No incomplete-chain or clock inconsistency signals were detected.</p>}
              </div>
            )}

            {tab === 'parsing' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-[11px] font-semibold text-text-1">Assign profile and clock correction per source</h3>
                  <p className="mb-2 text-[10px] text-text-4">Offsets are milliseconds; original source time is never overwritten.</p>
                  {sources.map((source) => (
                    <div key={source.id} className="mb-1 grid grid-cols-[minmax(120px,1fr)_minmax(160px,1fr)_120px] gap-2 rounded border border-border-1 bg-surface-1 p-2">
                      <span className="truncate font-mono text-[10px] text-text-2">{source.displayName}</span>
                      <select value={source.parsingProfile?.id || ''} onChange={(event) => onConfigureSource(source.id, { parsingProfile: profiles.find((item) => item.id === event.target.value), clockOffsetMs: source.clockOffsetMs })} className="h-7 rounded border border-border-2 bg-surface-0 px-2 text-[10px] text-text-2">
                        <option value="">Built-in auto detection</option>
                        {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                      </select>
                      <input key={`${source.id}-${source.clockOffsetMs}`} defaultValue={source.clockOffsetMs || 0} type="number" step="1" title="Clock offset in milliseconds" onBlur={(event) => onConfigureSource(source.id, { parsingProfile: source.parsingProfile, clockOffsetMs: Number(event.target.value) || 0 })} className="h-7 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[10px] text-text-2" />
                    </div>
                  ))}
                </div>
                <div>
                  <div className="mb-2 flex items-center gap-2"><h3 className="text-[11px] font-semibold text-text-1">Portable profile JSON</h3><button onClick={saveProfile} className="ml-auto flex h-7 items-center gap-1 rounded border border-accent/40 px-2 text-[10px] text-accent-light"><Save size={10} /> Validate & save</button><button onClick={() => downloadText('adomnia-log-profile.json', profileDraft, 'application/json')} className="flex h-7 items-center gap-1 rounded border border-border-2 px-2 text-[10px] text-text-3"><Download size={10} /> Export</button></div>
                  <textarea value={profileDraft} onChange={(event) => setProfileDraft(event.target.value)} spellCheck={false} className="h-72 w-full resize-y rounded border border-border-2 bg-surface-1 p-3 font-mono text-[10px] text-text-2 outline-none focus:border-accent" />
                  {profileMessage && <p className="mt-1 text-[10px] text-text-3">{profileMessage}</p>}
                </div>
              </div>
            )}

            {tab === 'metrics' && (
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <select value={dimension} onChange={(event) => setDimension(event.target.value as MetricDimension)} className="h-7 rounded border border-border-2 bg-surface-1 px-2 text-[10px] text-text-2"><option value="route">By route</option><option value="service">By service</option><option value="version">By version</option></select>
                  <span className="text-[10px] text-text-4">Version comparison</span>
                  <select value={baselineVersion} onChange={(event) => setBaselineVersion(event.target.value)} className="h-7 rounded border border-border-2 bg-surface-1 px-2 text-[10px] text-text-2"><option value="">baseline…</option>{versions.map((version) => <option key={version}>{version}</option>)}</select>
                  <span className="text-text-4">→</span>
                  <select value={currentVersion} onChange={(event) => setCurrentVersion(event.target.value)} className="h-7 rounded border border-border-2 bg-surface-1 px-2 text-[10px] text-text-2"><option value="">current…</option>{versions.map((version) => <option key={version}>{version}</option>)}</select>
                </div>
                <p className="mb-2 text-[10px] text-text-4">Percentiles use one request duration per chain. Concurrent downstream durations are never summed. Coverage shows timed/total and explicit/estimated samples.</p>
                <table className="w-full text-left text-[10px]"><thead className="text-text-4"><tr><th className="p-2">Group</th><th>Samples</th><th>Errors</th><th>p50</th><th>p95</th><th>p99</th><th>Coverage</th></tr></thead><tbody>{metrics.map((metric) => <tr key={metric.key} className="border-t border-border-1 font-mono text-text-2"><td className="p-2">{metric.key}</td><td>{metric.sampleCount}</td><td>{metric.errorCount} ({(metric.errorRate * 100).toFixed(1)}%)</td><td>{ms(metric.p50Ms)}</td><td>{ms(metric.p95Ms)}</td><td>{ms(metric.p99Ms)}</td><td>{metric.timedSamples}/{metric.sampleCount} · {metric.explicitTimedSamples} explicit</td></tr>)}</tbody></table>
                {comparisons.length > 0 && <div className="mt-4"><h3 className="mb-2 text-[11px] font-semibold text-text-1">Before / after differences</h3>{comparisons.map((comparison) => <div key={comparison.key} className="mb-1 grid grid-cols-[1fr_100px_110px] rounded border border-border-1 p-2 font-mono text-[10px] text-text-2"><span>{comparison.key}</span><span>error Δ {comparison.errorRateDelta === null ? 'n/d' : `${(comparison.errorRateDelta * 100).toFixed(1)}pp`}</span><span className={(comparison.p95DeltaMs ?? 0) > 0 ? 'text-error' : 'text-success'}>p95 Δ {ms(comparison.p95DeltaMs)}</span></div>)}</div>}
              </div>
            )}

            {tab === 'rules' && (
              <div className="grid min-h-[420px] grid-cols-2 gap-4">
                <div><div className="mb-2 flex items-center"><h3 className="text-[11px] font-semibold text-text-1">Versioned declarative rules</h3><button onClick={applyRules} className="ml-auto flex h-7 items-center gap-1 rounded border border-accent/40 px-2 text-[10px] text-accent-light"><Save size={10} /> Validate & save</button></div><textarea value={rulesDraft} onChange={(event) => setRulesDraft(event.target.value)} spellCheck={false} className="h-[460px] w-full resize-y rounded border border-border-2 bg-surface-1 p-3 font-mono text-[9px] text-text-2 outline-none focus:border-accent" />{rulesMessage && <p className="mt-1 text-[10px] text-text-3">{rulesMessage}</p>}<button onClick={() => { setRulesDraft(JSON.stringify(BUILTIN_DIAGNOSTIC_RULES, null, 2)); setRules(BUILTIN_DIAGNOSTIC_RULES); saveDiagnosticRules(BUILTIN_DIAGNOSTIC_RULES) }} className="mt-2 text-[10px] text-text-4 hover:text-text-1">Restore built-in verified rules</button></div>
                <div><h3 className="mb-2 text-[11px] font-semibold text-text-1">Findings · {findings.length}</h3>{findings.length ? findings.map((finding) => <button key={`${finding.ruleId}-${finding.scopeKey}`} onClick={() => onSelectEventId(finding.eventIds[0])} className="mb-2 block w-full rounded border border-border-1 bg-surface-1 p-3 text-left"><p className={finding.severity === 'error' ? 'text-error' : finding.severity === 'warn' ? 'text-warning' : 'text-info'}>{finding.ruleName} <span className="font-mono text-[9px]">v{finding.ruleVersion}</span></p><p className="mt-1 text-[10px] text-text-3">{finding.evidence}</p><p className="mt-1 text-[10px] text-text-4">{finding.action}</p><p className="mt-1 font-mono text-[9px] text-text-4">{finding.sourceLines.map((line) => `${line.source}:${line.line}`).join(', ')}</p></button>) : <p className="text-[10px] text-text-4">No rule has sufficient observed evidence.</p>}</div>
              </div>
            )}

            {tab === 'ai' && (
              <div className="max-w-4xl">
                <p className="text-[11px] text-text-2">AI is optional and runs only when you press the button. The main investigation remains fully functional without it.</p>
                <p className={`mt-2 rounded border p-2 text-[10px] ${aiContext.localProvider ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'}`}>{aiContext.localProvider ? `Local provider: ${aiContext.provider}.` : `Configured provider: ${aiContext.provider}. This explicit action sends ${aiContext.eventCount} redacted evidence event(s) to that provider.`} Secrets, nested payloads, raw text and stacks are redacted first.</p>
                <button onClick={() => void runAi()} disabled={aiRunning || !events.length} className="mt-3 flex h-8 items-center gap-2 rounded border border-accent/40 bg-accent/10 px-3 text-[11px] text-accent-light disabled:opacity-40"><Bot size={12} />{aiRunning ? 'Analyzing…' : selectedRequest ? 'Summarize selected chain' : 'Summarize visible investigation sample'}</button>
                {aiError && <p className="mt-2 text-[10px] text-error">{aiError}</p>}
                {aiResult && <pre className="mt-3 whitespace-pre-wrap rounded border border-border-1 bg-surface-1 p-3 font-sans text-[11px] leading-relaxed text-text-2">{aiResult}</pre>}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bug, Copy, Loader2, Power, RefreshCw, Search, Settings2, ShieldAlert, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { Clipboard as WailsClipboard } from '@wailsio/runtime'
import type { GoIDESession } from '@/lib/goide-api'
import {
  clearGoIDESonarBaseline, configureGoIDESonarScanner, detectGoIDESonarScanner, fetchGoIDESonarIssues,
  getGoIDESonarConfig, runGoIDESonarScan, saveGoIDESonarBaseline, saveGoIDESonarConfig, setGoIDESonarToken,
  type GoIDESonarConfig, type GoIDESonarScannerInfo, type GoIDESonarScanResult,
} from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'
import { filterSonarIssues, formatSonarIssue, formatSonarIssues, isSecurityIssue, sonarIssuesToAIFixTargets, sonarSeverityTone, sortSonarIssues } from './goStudioSonar'
import { goStudioAIFixAvailable, resolveAllGoStudioProblemsWithAI } from './goStudioAIFixRunner'

interface GoStudioSonarPanelProps {
  session: GoIDESession
}

const EMPTY_CONFIG: GoIDESonarConfig = { enabled: false, serverUrl: '', projectKey: '', sources: '.', exclusions: '', hasToken: false }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** SonarQube opzionale: scansione del progetto e import dei problemi, con copia e fix AI. */
export function GoStudioSonarPanel({ session }: GoStudioSonarPanelProps) {
  const sessionId = session.id
  const authorized = session.project.authorization === 'tooling-permitted'
  const [config, setConfig] = useState<GoIDESonarConfig>(EMPTY_CONFIG)
  const [scanner, setScanner] = useState<GoIDESonarScannerInfo | null>(null)
  const [scannerPath, setScannerPath] = useState('')
  const [token, setToken] = useState('')
  const [draft, setDraft] = useState<GoIDESonarConfig>(EMPTY_CONFIG)
  const [showSettings, setShowSettings] = useState(false)
  const [result, setResult] = useState<GoIDESonarScanResult | null>(null)
  const [busy, setBusy] = useState<'scan' | 'fetch' | null>(null)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [severity, setSeverity] = useState('')
  const [securityOnly, setSecurityOnly] = useState(false)

  const load = useCallback(async () => {
    try {
      const [loadedConfig, info] = await Promise.all([getGoIDESonarConfig(sessionId), detectGoIDESonarScanner(sessionId)])
      setConfig(loadedConfig)
      setDraft(loadedConfig)
      setScanner(info)
      setScannerPath(info.source === 'custom' ? info.binary ?? '' : '')
      setError(null)
    } catch (problem) {
      setError(errorMessage(problem))
    }
  }, [sessionId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [busy])

  const issues = useMemo(() => (result ? sortSonarIssues(result.issues) : []), [result])
  const visible = useMemo(() => filterSonarIssues(issues, { query, severity, securityOnly }), [issues, query, severity, securityOnly])
  const securityCount = useMemo(() => issues.filter(isSecurityIssue).length, [issues])
  const aiReady = goStudioAIFixAvailable()

  const runScan = async () => {
    setBusy('scan'); setStartedAt(Date.now()); setNow(Date.now()); setError(null); setNotice(null)
    try {
      const outcome = await runGoIDESonarScan(sessionId, token)
      setResult(outcome)
      setConfig((current) => ({ ...current, hasToken: current.hasToken || token.trim() !== '' }))
      if (token.trim()) setToken('')
      setNotice(outcome.warning ?? (outcome.issueCount === 0 ? 'Scan finished: no open issues found.' : null))
    } catch (problem) {
      setError(errorMessage(problem))
    } finally {
      setBusy(null)
    }
  }

  const refresh = async () => {
    setBusy('fetch'); setStartedAt(Date.now()); setNow(Date.now()); setError(null); setNotice(null)
    try {
      setResult(await fetchGoIDESonarIssues(sessionId, token))
      if (token.trim()) { await setGoIDESonarToken(sessionId, token); setConfig((current) => ({ ...current, hasToken: true })); setToken('') }
    } catch (problem) {
      setError(errorMessage(problem))
    } finally {
      setBusy(null)
    }
  }

  const saveSettings = async () => {
    setError(null)
    try {
      const saved = await saveGoIDESonarConfig(sessionId, draft)
      if (token.trim()) { await setGoIDESonarToken(sessionId, token); saved.hasToken = true; setToken('') }
      setConfig(saved)
      setNotice('SonarQube settings saved.')
    } catch (problem) {
      setError(errorMessage(problem))
    }
  }

  const saveToken = async () => {
    try {
      await setGoIDESonarToken(sessionId, token)
      setConfig((current) => ({ ...current, hasToken: token.trim() !== '' }))
      setToken('')
      setNotice(token.trim() ? 'Token kept in memory for this session.' : 'Token cleared.')
    } catch (problem) {
      setError(errorMessage(problem))
    }
  }

  const configureScanner = async () => {
    try {
      await configureGoIDESonarScanner(sessionId, scannerPath)
      setScanner(await detectGoIDESonarScanner(sessionId))
    } catch (problem) {
      setError(errorMessage(problem))
    }
  }

  const copyProblems = () => {
    void WailsClipboard.SetText(formatSonarIssues(visible))
    setNotice(`Copied ${visible.length} problem${visible.length === 1 ? '' : 's'} to the clipboard.`)
  }

  const fixWithAI = () => {
    if (!aiReady) { setError('Fix with AI needs an AI provider: enable and test one in Settings → AI.'); return }
    const targets = sonarIssuesToAIFixTargets(visible)
    if (targets.length === 0) { setNotice('No problems to fix.'); return }
    void resolveAllGoStudioProblemsWithAI(targets)
  }

  const saveBaseline = async () => {
    try {
      const count = await saveGoIDESonarBaseline(sessionId, token)
      if (token.trim()) { await setGoIDESonarToken(sessionId, token); setToken(''); setConfig((current) => ({ ...current, hasToken: true })) }
      await refresh()
      setNotice(`Baseline saved: ${count} existing problem${count === 1 ? '' : 's'} will be hidden.`)
    } catch (problem) {
      setError(errorMessage(problem))
    }
  }

  const clearBaseline = async () => {
    try {
      await clearGoIDESonarBaseline(sessionId)
      if (result) await refresh()
      setNotice('Baseline cleared: all problems are shown again.')
    } catch (problem) {
      setError(errorMessage(problem))
    }
  }

  const settings = showSettings || !config.enabled
  const seconds = busy ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="go-studio-tool-header flex-wrap gap-2">
        <span className="go-studio-tool-title">SonarQube</span>
        <span className={`flex items-center gap-1 text-[11px] ${scanner?.available ? 'text-success' : 'text-text-4'}`}>
          {scanner?.available ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
          {scanner?.available ? `sonar-scanner ${scanner.version ?? ''}`.trim() : 'sonar-scanner not found'}
        </span>
        {result && <span className="text-[11px] text-text-4">{result.issueCount} open{result.baselined ? ` · ${result.baselined} baselined` : ''}{securityCount ? ` · ${securityCount} security` : ''}</span>}
        {config.hasToken && <span className="rounded bg-surface-3 px-1 text-[10px] text-text-3">token set</span>}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {busy && <span className="flex items-center gap-1 text-[11px] text-accent"><Loader2 size={12} className="animate-spin" />{busy === 'scan' ? 'Scanning' : 'Refreshing'} · {seconds}s</span>}
          <button type="button" onClick={() => setShowSettings((value) => !value)} title="Settings" className={`go-studio-icon-button h-7 w-7 ${settings ? 'text-accent' : ''}`}><Settings2 size={13} /></button>
          <button type="button" onClick={() => void refresh()} disabled={!config.enabled || !!busy} title="Reimport issues (no rescan)" className="go-studio-icon-button h-7 w-7"><RefreshCw size={13} /></button>
        </div>
      </div>

      {!authorized && <p className="border-b border-warning/30 bg-warning/10 px-3 py-1 text-[11.5px] text-warning">Trust the project tools to run SonarQube scans.</p>}
      {error && <p className="border-b border-danger/30 bg-danger/10 px-3 py-1 text-[11.5px] text-danger">{error}</p>}
      {notice && <p className="border-b border-border-1 bg-surface-2/60 px-3 py-1 text-[11.5px] text-text-3">{notice}</p>}

      {settings && (
        <div className="min-h-0 overflow-auto border-b border-border-1 p-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 flex items-center gap-2 text-[12.5px] text-text-2">
              <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} className="h-[15px] w-[15px] accent-[var(--color-accent)]" />
              Enable SonarQube for this project <Power size={12} className="text-text-4" />
            </label>
            <label className="gs-field-label">Server URL<input value={draft.serverUrl} onChange={(event) => setDraft({ ...draft, serverUrl: event.target.value })} placeholder="https://sonar.example.com" className="gs-input gs-mono" /></label>
            <label className="gs-field-label">Project key<input value={draft.projectKey} onChange={(event) => setDraft({ ...draft, projectKey: event.target.value })} placeholder="my-service" className="gs-input gs-mono" /></label>
            <label className="gs-field-label">Sources<input value={draft.sources} onChange={(event) => setDraft({ ...draft, sources: event.target.value })} placeholder="." className="gs-input gs-mono" /></label>
            <label className="gs-field-label">Exclusions<input value={draft.exclusions} onChange={(event) => setDraft({ ...draft, exclusions: event.target.value })} placeholder="**/*_test.go,**/vendor/**" className="gs-input gs-mono" /></label>
            <label className="gs-field-label">Token (memory only)<input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={config.hasToken ? '•••••• (set)' : 'SonarQube user token'} className="gs-input gs-mono" autoComplete="off" /></label>
            <label className="gs-field-label">sonar-scanner path (optional)<input value={scannerPath} onChange={(event) => setScannerPath(event.target.value)} placeholder={scanner?.binary || 'found on PATH'} className="gs-input gs-mono" /></label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void saveSettings()} className="rounded-md bg-accent/15 px-2.5 py-1 text-[12px] font-medium text-accent hover:bg-accent/25">Save settings</button>
            <button type="button" onClick={() => void saveToken()} className="rounded-md bg-surface-2 px-2.5 py-1 text-[12px] text-text-2 hover:bg-surface-3">Save token</button>
            <button type="button" onClick={() => void configureScanner()} className="rounded-md bg-surface-2 px-2.5 py-1 text-[12px] text-text-2 hover:bg-surface-3">Use scanner path</button>
            <button type="button" onClick={() => void runScan()} disabled={!config.enabled || !scanner?.available || !!busy} title={scanner?.available ? 'Run sonar-scanner and import issues' : scanner?.error} className="ml-auto flex items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1 text-[12px] font-medium text-success hover:bg-success/25 disabled:opacity-50"><Bug size={13} />Scan now</button>
          </div>
          {scanner?.error && <p className="mt-2 text-[11px] text-text-4">{scanner.error}</p>}
        </div>
      )}

      {config.enabled && !settings && (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border-1 px-3 py-1.5 text-[11.5px]">
            <label className="flex h-7 w-56 items-center gap-2 rounded-lg bg-[var(--gs-ground)] px-2.5 text-text-4 focus-within:ring-1 focus-within:ring-accent">
              <Search size={12} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter file, rule, message" aria-label="Filter issues" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-text-2 outline-none" />
            </label>
            <select value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label="Severity" className="h-7 rounded-lg border-0 bg-[var(--gs-raised)] px-2 text-[11.5px] text-text-2 outline-none focus:ring-1 focus:ring-accent">
              <option value="">All severities</option>
              {Object.entries(result?.bySeverity ?? {}).sort().map(([key, count]) => <option key={key} value={key}>{key} ({count})</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-text-3"><input type="checkbox" checked={securityOnly} onChange={(event) => setSecurityOnly(event.target.checked)} className="h-[14px] w-[14px] accent-[var(--color-accent)]" />Security only</label>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => void runScan()} disabled={!scanner?.available || !!busy} title={scanner?.available ? 'Run sonar-scanner again' : scanner?.error} className="go-studio-icon-button h-7 w-7 text-success"><Bug size={13} /></button>
              <button type="button" onClick={copyProblems} disabled={visible.length === 0} title="Copy all problems" className="go-studio-icon-button h-7 w-7"><Copy size={13} /></button>
              <button type="button" onClick={fixWithAI} disabled={visible.length === 0 || !aiReady} title={aiReady ? 'Resolve with AI (preview before applying)' : 'Enable an AI provider in Settings → AI'} className="go-studio-icon-button h-7 w-7 text-accent"><Sparkles size={13} /></button>
              <button type="button" onClick={() => void saveBaseline()} disabled={!!busy} title="Save baseline (hide current problems)" className="go-studio-icon-button h-7 w-7"><ShieldCheck size={13} /></button>
              <button type="button" onClick={() => void clearBaseline()} title="Clear baseline" className="go-studio-icon-button h-7 w-7"><Trash2 size={13} /></button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {!result && <p className="p-4 text-[12px] text-text-4">Run a scan to import the open issues from SonarQube, then copy them or hand them to the AI.</p>}
            {result && visible.length === 0 && <p className="p-4 text-[12px] text-text-4">{issues.length === 0 ? 'No open issues found.' : 'No issue matches the filter.'}</p>}
            {visible.map((issue) => (
              <button
                key={issue.key}
                type="button"
                onClick={() => void useGoIDEStore.getState().openLocation(issue.file, issue.line || 1)}
                title={formatSonarIssue(issue)}
                className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border-b border-border-1/60 px-3 py-1 text-left hover:bg-surface-2/60"
              >
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${sonarSeverityTone(issue.severity)}`}>{(issue.severity ?? 'INFO').toUpperCase()}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-text-1">{issue.message}</span>
                  <span className="block truncate font-mono text-[10.5px] text-text-4">{issue.file}{issue.line ? `:${issue.line}` : ''} · {issue.rule}{issue.type ? ` · ${issue.type}` : ''}{isSecurityIssue(issue) ? ' · security' : ''}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

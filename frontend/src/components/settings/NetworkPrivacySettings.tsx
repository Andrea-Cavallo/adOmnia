import { useCallback, useEffect, useState } from 'react'
import { Activity, CircleSlash, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import * as AppBindings from '../../../bindings/adomnia/app'
import type { Event as NetworkEvent, Settings as NetworkSettings } from '../../../bindings/adomnia/internal/netpolicy/models'
import { SettingsCard } from './SettingsLayout'
import { TextInput, Toggle } from './SettingsFields'

const EMPTY: NetworkSettings = { offline: false, proxyUrl: '', noProxy: '', caBundlePath: '' }

const CATEGORY_LABELS: Record<string, string> = {
  ai: 'AI provider', update: 'Update check', 'git-host': 'Git host API', copilot: 'Copilot',
  vulncheck: 'Vulnerability DB', 'go-toolchain': 'Go download', 'go-registry': 'Module registry', sonarqube: 'SonarQube',
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Politica di rete di tutta adOmnia: modo offline unico, proxy e CA aziendali, e il registro
 * delle connessioni che adOmnia apre da sola (le richieste del client API non ci finiscono).
 */
export function NetworkPrivacySettings() {
  const [saved, setSaved] = useState<NetworkSettings>(EMPTY)
  const [draft, setDraft] = useState<NetworkSettings>(EMPTY)
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ kind: 'idle' })
  const [activity, setActivity] = useState<NetworkEvent[]>([])

  const refreshActivity = useCallback(() => {
    AppBindings.GetNetworkActivity().then((events) => setActivity(events ?? [])).catch(() => setActivity([]))
  }, [])

  useEffect(() => {
    AppBindings.GetNetworkSettings().then((settings) => { setSaved(settings); setDraft(settings) }).catch(() => undefined)
    refreshActivity()
  }, [refreshActivity])

  const save = async (next: NetworkSettings) => {
    setStatus({ kind: 'saving' })
    try {
      const stored = await AppBindings.SaveNetworkSettings(next)
      setSaved(stored)
      setDraft(stored)
      setStatus({ kind: 'saved' })
    } catch (error) {
      setStatus({ kind: 'error', message: errorText(error) })
    }
  }

  const dirty = draft.proxyUrl !== saved.proxyUrl || draft.noProxy !== saved.noProxy || draft.caBundlePath !== saved.caBundlePath
  const update = (patch: Partial<NetworkSettings>) => { setDraft((current) => ({ ...current, ...patch })); setStatus({ kind: 'idle' }) }

  return (
    <>
      <SettingsCard>
        <div className="flex items-start gap-2 px-2 py-3">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-status-ok" />
          <div>
            <div className="text-xs font-medium text-text-1">No telemetry</div>
            <div className="mt-0.5 text-[10px] leading-relaxed text-text-4">
              adOmnia collects no usage data, crash reports or analytics, and has no switch to turn them on. Every connection it opens by itself is listed below.
            </div>
          </div>
        </div>
        <Toggle
          label="Offline mode"
          desc="Blocks every connection adOmnia starts by itself to a non-local host: AI cloud providers, Copilot, update check, vulnerability database, Go toolchain and module downloads, Git host APIs. Local models (Ollama on localhost) and the requests you send from the API client still work."
          checked={draft.offline}
          onChange={(offline) => save({ ...saved, offline })}
        />
      </SettingsCard>

      <SettingsCard>
        <TextInput label="Proxy" desc="Corporate proxy for all of adOmnia: API client, AI, Git, Go toolchain and gopls. Empty uses HTTPS_PROXY from the system. Put the password in the system, not in the URL." value={draft.proxyUrl} placeholder="http://proxy.corp:8080" onChange={(proxyUrl) => update({ proxyUrl })} />
        <TextInput label="No proxy for" desc="Hosts reached directly (NO_PROXY), separated by commas." value={draft.noProxy} placeholder="git.corp.example,.internal" onChange={(noProxy) => update({ noProxy })} />
        <TextInput label="Corporate CA bundle (PEM)" desc="Absolute path of a PEM file added to the system certificates for TLS inspection. TLS verification is never turned off." value={draft.caBundlePath} placeholder="C:/certs/corporate-ca.pem" onChange={(caBundlePath) => update({ caBundlePath })} />
        <div className="flex items-center justify-end gap-3 px-2 pb-3">
          <span role="status" aria-live="polite" className={`text-[11px] ${status.kind === 'error' ? 'text-status-err' : 'text-text-3'}`}>
            {status.kind === 'saving' && 'Saving…'}
            {status.kind === 'saved' && 'Saved: new connections use these settings.'}
            {status.kind === 'error' && status.message}
          </span>
          <button
            onClick={() => save(draft)}
            disabled={!dirty || status.kind === 'saving'}
            className="h-7 rounded border border-border-2 bg-surface-2 px-3 text-xs text-text-1 transition-colors hover:bg-surface-3 disabled:opacity-50"
          >
            Save network settings
          </button>
        </div>
      </SettingsCard>

      <SettingsCard>
        <div className="flex items-center justify-between gap-2 px-2 pt-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-1">
            <Activity size={13} className="text-text-3" /> Network activity
            <span className="text-[10px] font-normal text-text-4">this session · kept in memory only</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={refreshActivity} title="Refresh" aria-label="Refresh network activity" className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text-1"><RefreshCw size={12} /></button>
            <button onClick={() => AppBindings.ClearNetworkActivity().then(refreshActivity)} title="Clear" aria-label="Clear network activity" className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text-1"><Trash2 size={12} /></button>
          </div>
        </div>
        {activity.length === 0 ? (
          <div className="px-2 py-4 text-[11px] text-text-4">No connections opened by adOmnia in this session.</div>
        ) : (
          <ul className="max-h-72 overflow-auto px-2 py-2 font-mono text-[11px]">
            {activity.map((event, index) => (
              <li key={`${event.time}-${index}`} className="grid grid-cols-[64px_120px_minmax(0,1fr)_auto] items-center gap-2 border-b border-border-1 py-1 last:border-0">
                <span className="text-text-4">{new Date(event.time).toLocaleTimeString()}</span>
                <span className="truncate text-text-3">{CATEGORY_LABELS[event.category] ?? event.category}</span>
                <span className="truncate text-text-2" title={event.detail || undefined}>{event.method ? `${event.method} ` : ''}{event.host}{event.path ?? ''}</span>
                <span className={event.outcome === 'ok' ? 'text-status-ok' : event.outcome === 'blocked' ? 'text-status-warn' : 'text-status-err'}>
                  {event.outcome === 'blocked' ? <span className="inline-flex items-center gap-1"><CircleSlash size={10} /> blocked</span> : event.status || event.outcome}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </>
  )
}

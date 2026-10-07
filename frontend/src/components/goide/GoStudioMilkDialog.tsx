import { useEffect, useState } from 'react'
import { AlertCircle, Download, ExternalLink } from 'lucide-react'
import { Browser } from '@wailsio/runtime'
import milkAvatar from '../../../../assets/images/milk-avatar.png'
import { GoStudioAlert, GoStudioButton, GoStudioModal } from './GoStudioModal'
import { assignMilkProvider, getMilkAgents, getMilkLog, type MilkAgentRole, type MilkAgentsInfo, type MilkSettings } from '@/lib/milk-api'
import { useMilkStore } from '@/stores/milk'

/** Upstream project: adOmnia drives the milk binary installed on this machine, so updating milk updates the chat. */
export const MILK_REPO_URL = 'https://github.com/scoutme/milk'

const BUTTON = 'gs-btn gs-btn-secondary gs-btn-sm'

/**
 * milk's bottle on a light chip: its navy outline would vanish on dark themes.
 * Shaped like a lucide icon (`size`) so it drops into tabs, stripes and modals.
 */
export function MilkLogo({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[#f6f1e7] ring-1 ring-black/10 ${className}`}
      style={{ width: size + 4, height: size + 4 }}
    >
      <img src={milkAvatar} alt="" width={size} height={size} draggable={false} />
    </span>
  )
}

const ROLES: { role: MilkAgentRole; label: string }[] = [
  { role: 'primary', label: 'Primary' },
  { role: 'escalation', label: 'Escalation' },
]

/**
 * Models whose key is already in the environment: one click adds the agent to milk's config with a
 * token_cmd that reads the variable, so the key itself never lands in a file.
 */
function MilkAgentsSection() {
  const [info, setInfo] = useState<MilkAgentsInfo | null>(null)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    getMilkAgents().then(setInfo, (reason: unknown) => setError(String(reason)))
  }, [])

  const assign = (id: string, role: MilkAgentRole) => {
    setPending(`${id}:${role}`)
    setError('')
    assignMilkProvider(id, role)
      .then(setInfo, (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setPending(''))
  }

  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="gs-section-title">Models from your environment</h3>
      <p className="text-[12.5px] text-text-2">
        Pick the model milk answers with (primary) and the one it hands harder turns to (escalation).
        The key is read from the variable each time milk starts and is never written to disk.
      </p>
      {error && <GoStudioAlert icon={AlertCircle}>{error}</GoStudioAlert>}
      {info && (
        <ul className="gs-surface flex flex-col divide-y divide-border-1">
          {info.providers.map((provider) => (
            <li key={provider.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-text-1">{provider.label} <span className="text-text-4">· {provider.model}</span></div>
                <div className={`gs-mono text-[11px] ${provider.detected ? 'text-success' : 'text-text-4'}`}>
                  {provider.envVar} {provider.detected ? 'found' : 'not set'}
                </div>
              </div>
              {ROLES.map(({ role, label }) => {
                const active = (role === 'primary' ? info.primary : info.escalation) === provider.id
                return (
                  <GoStudioButton
                    key={role}
                    small
                    variant={active ? 'primary' : 'secondary'}
                    loading={pending === `${provider.id}:${role}`}
                    disabled={!provider.detected || active || pending !== ''}
                    onClick={() => assign(provider.id, role)}
                  >
                    {label}
                  </GoStudioButton>
                )
              })}
            </li>
          ))}
        </ul>
      )}
      {info && (
        <p className="text-[11.5px] text-text-4">
          Now: primary <span className="gs-mono">{info.primary || '—'}</span>, escalation <span className="gs-mono">{info.escalation || 'claude'}</span>.
          Set a variable after starting adOmnia? Restart adOmnia so it can see it. Other agents and models: <span className="gs-mono">{info.configPath}</span>.
        </p>
      )}
    </section>
  )
}

/** milk settings in gO Studio: enable, binary path, permissions, process status and logs. */
export function GoStudioMilkDialog() {
  const open = useMilkStore((state) => state.dialogOpen)
  const settings = useMilkStore((state) => state.settings)
  const status = useMilkStore((state) => state.status)
  const busy = useMilkStore((state) => state.busy)
  const error = useMilkStore((state) => state.error)
  const [draft, setDraft] = useState<MilkSettings | null>(null)
  const [log, setLog] = useState<string[] | null>(null)
  const close = () => useMilkStore.getState().setDialogOpen(false)

  useEffect(() => {
    if (open) {
      setLog(null)
      void useMilkStore.getState().ensure()
    }
  }, [open])

  useEffect(() => {
    if (open && settings) setDraft({ ...settings })
  }, [open, settings])

  if (!open || !draft) return null
  const installing = status?.state === 'installing'
  const missing = status?.state === 'not-installed' || status?.state === 'outdated'

  const save = async () => {
    if (await useMilkStore.getState().saveSettings(draft)) close()
  }

  return (
    <GoStudioModal
      open={open}
      onClose={close}
      size="md"
      divided
      icon={MilkLogo}
      title="milk"
      subtitle={<span className="text-text-3">{status?.message || status?.state || 'disabled'}{status?.version ? ` · ${status.version}` : ''}</span>}
      actions={<label className="gs-check mr-1 text-[12.5px]"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Enabled</label>}
      footer={<>
        <GoStudioButton variant="ghost" onClick={close}>Cancel</GoStudioButton>
        <GoStudioButton variant="primary" loading={busy} onClick={() => void save()}>Save</GoStudioButton>
      </>}
    >
      {error && <GoStudioAlert icon={AlertCircle}>{error}</GoStudioAlert>}

      <section className="flex flex-col gap-2.5">
        <h3 className="gs-section-title">Agent host</h3>
        <p className="text-[12.5px] text-text-2">
          adOmnia runs <span className="gs-mono">milk serve --acp</span> from the milk you installed, so updating milk is all it takes to get its new features.
          Agents, models and their keys stay in milk&apos;s own config (<span className="gs-mono">~/.milk</span>).
        </p>
        <div className="flex flex-wrap gap-2">
          <GoStudioButton small variant={missing ? 'primary' : 'secondary'} icon={Download} loading={installing} disabled={busy || installing} onClick={() => void useMilkStore.getState().install()}>
            {status?.state === 'not-installed' ? 'Install milk' : 'Update milk'}
          </GoStudioButton>
          <button type="button" onClick={() => void Browser.OpenURL(MILK_REPO_URL)} className={BUTTON}><ExternalLink size={12} /> github.com/scoutme/milk</button>
          <button type="button" disabled={busy || !settings?.enabled} onClick={() => void useMilkStore.getState().restart()} className={BUTTON}>Restart</button>
          <button type="button" onClick={() => void getMilkLog().then(setLog)} className={BUTTON}>Show logs</button>
        </div>
        <p className="text-[11.5px] text-text-4">
          Install/Update downloads the newest release (v0.4.0 or later) from the milk repository, checks its SHA-256 and puts it where milk&apos;s own installer would.
        </p>
        {log && <pre className="gs-surface gs-mono max-h-44 overflow-auto p-3 text-[11px] leading-5 text-text-3">{log.length ? log.join('\n') : 'No log lines yet.'}</pre>}
      </section>

      <MilkAgentsSection />

      <section className="flex flex-col gap-2.5">
        <h3 className="gs-section-title">Binary</h3>
        <input
          value={draft.binaryPath}
          onChange={(event) => setDraft({ ...draft, binaryPath: event.target.value })}
          placeholder="Found automatically on PATH, in %LOCALAPPDATA%\milk\bin or ~/.local/bin"
          className="gs-input gs-mono text-[12px]"
          aria-label="milk binary path"
        />
        {status?.binary && <p className="text-[11.5px] text-text-4">In use: <span className="gs-mono">{status.binary}</span></p>}
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="gs-section-title">Tool permissions</h3>
        <label className="gs-check">
          <input type="checkbox" checked={draft.skipPermissions} onChange={(event) => setDraft({ ...draft, skipPermissions: event.target.checked })} />
          Approve every tool call without asking
        </label>
        {draft.skipPermissions && <GoStudioAlert icon={AlertCircle}>milk will run shell commands and edit files in the project without confirmation.</GoStudioAlert>}
      </section>
    </GoStudioModal>
  )
}

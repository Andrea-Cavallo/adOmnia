import { useEffect, useState } from 'react'
import { AlertCircle, Download, ExternalLink } from 'lucide-react'
import { Browser } from '@wailsio/runtime'
import milkAvatar from '../../../../assets/images/milk-avatar.png'
import { CodeStudioAlert, CodeStudioButton, CodeStudioModal } from './CodeStudioModal'
import { assignMilkProvider, getMcpServers, getMilkAgents, saveMcpServers, getMilkLog, type MilkAgentRole, type MilkAgentsInfo, type MilkSettings } from '@/lib/milk-api'
import { useMilkStore } from '@/stores/milk'

/** Upstream project: adOmnia drives the milk binary installed on this machine, so updating milk updates the chat. */
export const MILK_REPO_URL = 'https://github.com/scoutme/milk'

const BUTTON = 'gs-btn gs-btn-secondary gs-btn-sm'

/**
 * The source bottle includes a white outline for contrast on light and dark themes.
 * Shaped like a lucide icon (`size`) so it drops into tabs, stripes and modals.
 */
export function MilkLogo({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <img src={milkAvatar} alt="" width={size} height={size} draggable={false}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }} />
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
      {error && <CodeStudioAlert icon={AlertCircle}>{error}</CodeStudioAlert>}
      {(info?.warnings ?? []).map((warning) => <CodeStudioAlert key={warning} icon={AlertCircle}>{warning}</CodeStudioAlert>)}
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
                  <CodeStudioButton
                    key={role}
                    small
                    variant={active ? 'primary' : 'secondary'}
                    loading={pending === `${provider.id}:${role}`}
                    disabled={!provider.detected || active || pending !== ''}
                    onClick={() => assign(provider.id, role)}
                  >
                    {label}
                  </CodeStudioButton>
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

/** Context servers (MCP) configured once and handed to every ACP agent session. */
function McpServersSection() {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getMcpServers().then((servers) => setText(JSON.stringify(servers ?? [], null, 2)), (reason: unknown) => setError(String(reason)))
  }, [])

  const save = () => {
    setError('')
    setSaved(false)
    let parsed: unknown
    try { parsed = JSON.parse(text || '[]') } catch { setError('Invalid JSON'); return }
    if (!Array.isArray(parsed)) { setError('Expected a JSON array'); return }
    saveMcpServers(parsed).then(
      (servers) => { setText(JSON.stringify(servers ?? [], null, 2)); setSaved(true) },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    )
  }

  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="gs-section-title">Context servers (MCP)</h3>
      <p className="text-[12.5px] text-text-2">
        Configured once, passed to every agent (milk, Claude Code) when a new chat session starts. Stdio: <span className="gs-mono">command</span>, <span className="gs-mono">args</span>, <span className="gs-mono">env</span>. HTTP: <span className="gs-mono">url</span>, <span className="gs-mono">headers</span>.
      </p>
      {error && <CodeStudioAlert icon={AlertCircle}>{error}</CodeStudioAlert>}
      <textarea
        value={text}
        onChange={(event) => { setText(event.target.value); setSaved(false) }}
        spellCheck={false}
        rows={7}
        aria-label="MCP servers JSON"
        placeholder='[{"name": "my-server", "command": "node", "args": ["server.js"]}]'
        className="gs-input gs-mono"
      />
      <div className="flex items-center gap-3">
        <CodeStudioButton small onClick={save}>Save</CodeStudioButton>
        {saved && <span className="text-[11.5px] text-success">Saved — applies to new chats</span>}
      </div>
    </section>
  )
}

/** milk settings in Code Studio: enable, binary path, permissions, process status and logs. */
export function CodeStudioMilkDialog() {
  const open = useMilkStore((state) => state.dialogOpen)
  const settings = useMilkStore((state) => state.settings)
  useEffect(() => {
    if (open) void useMilkStore.getState().ensure()
  }, [open])
  // The form is mounted per opening, so the draft starts from the stored settings without a sync effect.
  return open && settings ? <MilkDialogForm settings={settings} /> : null
}

function MilkDialogForm({ settings }: { settings: MilkSettings }) {
  const open = true
  const status = useMilkStore((state) => state.status)
  const busy = useMilkStore((state) => state.busy)
  const error = useMilkStore((state) => state.error)
  const [draft, setDraft] = useState<MilkSettings>(() => ({ ...settings }))
  const [log, setLog] = useState<string[] | null>(null)
  const close = () => useMilkStore.getState().setDialogOpen(false)

  const installing = status?.state === 'installing'
  const missing = status?.state === 'not-installed' || status?.state === 'outdated'

  const save = async () => {
    if (await useMilkStore.getState().saveSettings(draft)) close()
  }

  return (
    <CodeStudioModal
      open={open}
      onClose={close}
      size="md"
      divided
      icon={MilkLogo}
      title="milk"
      subtitle={<span className="text-text-3">{status?.message || status?.state || 'disabled'}{status?.version ? ` · ${status.version}` : ''}</span>}
      actions={<label className="gs-check mr-1 text-[12.5px]"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Enabled</label>}
      footer={<>
        <CodeStudioButton variant="ghost" onClick={close}>Cancel</CodeStudioButton>
        <CodeStudioButton variant="primary" loading={busy} onClick={() => void save()}>Save</CodeStudioButton>
      </>}
    >
      {error && <CodeStudioAlert icon={AlertCircle}>{error}</CodeStudioAlert>}

      <section className="flex flex-col gap-2.5">
        <h3 className="gs-section-title">Agent host</h3>
        <p className="text-[12.5px] text-text-2">
          adOmnia runs <span className="gs-mono">milk serve --acp</span> from the milk you installed, so updating milk is all it takes to get its new features.
          Agents, models and their keys stay in milk&apos;s own config (<span className="gs-mono">~/.milk</span>).
        </p>
        <div className="flex flex-wrap gap-2">
          <CodeStudioButton small variant={missing ? 'primary' : 'secondary'} icon={Download} loading={installing} disabled={busy || installing} onClick={() => void useMilkStore.getState().install()}>
            {status?.state === 'not-installed' ? 'Install milk' : 'Update milk'}
          </CodeStudioButton>
          <button type="button" onClick={() => void Browser.OpenURL(MILK_REPO_URL)} className={BUTTON}><ExternalLink size={12} /> github.com/scoutme/milk</button>
          <button type="button" disabled={busy || !settings.enabled} onClick={() => void useMilkStore.getState().restart()} className={BUTTON}>Restart</button>
          <button type="button" onClick={() => void getMilkLog().then(setLog)} className={BUTTON}>Show logs</button>
        </div>
        <p className="text-[11.5px] text-text-4">
          Install/Update downloads the newest release (v0.4.0 or later) from the milk repository, checks its SHA-256 and puts it where milk&apos;s own installer would.
        </p>
        {log && <pre className="gs-surface gs-mono max-h-44 overflow-auto p-3 text-[11px] leading-5 text-text-3">{log.length ? log.join('\n') : 'No log lines yet.'}</pre>}
      </section>

      <MilkAgentsSection />
      <McpServersSection />

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
        {draft.skipPermissions && <CodeStudioAlert icon={AlertCircle}>milk will run shell commands and edit files in the project without confirmation.</CodeStudioAlert>}
        <label className="gs-check">
          <input type="checkbox" checked={!draft.disableBuiltinMcp} onChange={(event) => setDraft({ ...draft, disableBuiltinMcp: !event.target.checked })} />
          Give the agent adOmnia's collections and mock server (MCP)
        </label>
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="gs-section-title">Turn timeout</h3>
        <p className="text-[12.5px] text-text-2">
          Stop a turn that runs longer than this, so a model that keeps thinking forever cannot hold the chat open.
          Use the Stop button in the chat to interrupt sooner.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={120}
            value={draft.turnTimeoutMinutes ?? ''}
            placeholder="10"
            onChange={(event) => setDraft({ ...draft, turnTimeoutMinutes: event.target.value === '' ? 0 : Number(event.target.value) })}
            className="gs-input gs-mono w-24 text-[12px]"
            aria-label="Turn timeout in minutes"
          />
          <span className="text-[11.5px] text-text-4">minutes per turn (blank = 10, max 120)</span>
        </div>
      </section>
    </CodeStudioModal>
  )
}

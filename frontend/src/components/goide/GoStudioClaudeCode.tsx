import { Fragment, useEffect, useState } from 'react'
import { AlertCircle, ExternalLink } from 'lucide-react'
import { Browser } from '@wailsio/runtime'
import type { GoIDESession } from '@/lib/goide-api'
import type { MilkSettings } from '@/lib/milk-api'
import { BRAND_ICONS } from '@/lib/brandIcons.generated'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { getClaudeCodeLog, inspectClaudeCode, useClaudeCodeStore, type ClaudeCodeConfig } from '@/stores/claudeCode'
import { useGoIDEStore } from '@/stores/goide'
import { GoStudioAgentChat, type ChatAgent } from './GoStudioAgentChat'
import { GoStudioAlert, GoStudioButton, GoStudioModal } from './GoStudioModal'

const ADAPTER_URL = 'https://github.com/agentclientprotocol/claude-agent-acp'
const BUTTON = 'gs-btn gs-btn-secondary gs-btn-sm'

/** Claude's mark in its brand color (Simple Icons): readable on light and dark themes. */
export function ClaudeLogo({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={`#${BRAND_ICONS.claude.hex}`} aria-hidden="true" className={`shrink-0 ${className}`}>
      <path d={BRAND_ICONS.claude.path} />
    </svg>
  )
}

const CLAUDE: ChatAgent = {
  tool: 'claude',
  name: 'Claude Code',
  store: useClaudeCodeStore,
  Logo: ClaudeLogo,
  suggestions: ['What does this project do?', 'Find possible bugs in the open file', 'Write tests for the open file'],
  intro: 'Claude Code works in this folder with its own tools; it asks before editing files or running commands.',
  setupHint: 'Enable Claude Code in its settings. It uses your `claude` login and needs Node.js.',
  setupTitle: (status) => status?.state === 'not-installed' ? 'Claude Code needs Node.js'
    : status?.state === 'starting' ? 'Starting Claude Code…'
      : 'Claude Code is not running',
  setupAction: () => 'Open Claude Code settings',
}

export function GoStudioClaudeChat(props: { session: GoIDESession; document?: GoIDEEditorDocument | null }) {
  return <GoStudioAgentChat agent={CLAUDE} {...props} />
}

/**
 * What Claude Code will use in the active project, read from the same settings files it reads
 * (managed, ~/.claude/settings.json, .claude/settings.json, .claude/settings.local.json).
 * Enterprise backends (Bedrock, Vertex AI, Foundry, gateways) are configured there, not in adOmnia.
 */
function ConfigurationSection({ config }: { config: ClaudeCodeConfig }) {
  const facts = [
    ['Model', config.model || 'Claude Code default'],
    ['Region', config.region],
    ['AWS profile', config.profile],
    ['Endpoint', config.endpoint],
  ].filter(([, value]) => value)
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="gs-section-title">Configuration</h3>
      <p className="text-[12.5px] text-text-1"><span className="font-semibold">{config.providerLabel}</span> <span className="text-text-3">· read from Claude Code&apos;s own settings, as Claude Code will see them in this project</span></p>
      {(config.warnings ?? []).map((warning) => <GoStudioAlert key={warning} icon={AlertCircle}>{warning}</GoStudioAlert>)}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[12px]">
        {facts.map(([label, value]) => <Fragment key={label}><dt className="text-text-3">{label}</dt><dd className="gs-mono min-w-0 truncate text-text-1">{value}</dd></Fragment>)}
        {!!config.helpers?.length && <><dt className="text-text-3">Credential helpers</dt><dd className="gs-mono min-w-0 truncate text-text-1">{config.helpers.join(', ')}</dd></>}
      </dl>
      {!!config.variables?.length && (
        <table className="gs-surface w-full text-[11.5px]">
          <tbody>
            {config.variables.map((variable) => (
              <tr key={variable.name} className="border-b border-border-1 last:border-0">
                <td className="gs-mono px-2 py-1 text-text-2">{variable.name}</td>
                <td className="gs-mono max-w-[200px] truncate px-2 py-1 text-text-1">{variable.value}</td>
                <td className="px-2 py-1 text-text-4">{variable.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ul className="flex flex-col gap-0.5 text-[11px] text-text-4">
        {(config.files ?? []).map((file) => <li key={file.path} className="gs-mono truncate" title={file.error || undefined}>{file.found ? (file.error ? '✗' : '✓') : '·'} {file.scope}: {file.path}</li>)}
      </ul>
    </section>
  )
}

/** Claude Code settings in gO Studio: enable, adapter path, login vs API key, permissions, logs. */
export function GoStudioClaudeDialog() {
  const open = useClaudeCodeStore((state) => state.dialogOpen)
  const settings = useClaudeCodeStore((state) => state.settings)
  const status = useClaudeCodeStore((state) => state.status)
  const busy = useClaudeCodeStore((state) => state.busy)
  const error = useClaudeCodeStore((state) => state.error)
  const [draft, setDraft] = useState<MilkSettings | null>(null)
  const [log, setLog] = useState<string[] | null>(null)
  const [config, setConfig] = useState<ClaudeCodeConfig | null>(null)
  const root = useGoIDEStore((state) => state.sessions.find((session) => session.id === state.activeSessionId)?.project.realPath ?? '')
  const close = () => useClaudeCodeStore.getState().setDialogOpen(false)

  useEffect(() => {
    if (open) {
      setLog(null)
      void useClaudeCodeStore.getState().ensure()
      inspectClaudeCode(root).then(setConfig, () => setConfig(null))
    }
  }, [open, root, settings?.ignoreApiKey])

  useEffect(() => {
    if (open && settings) setDraft({ ...settings })
  }, [open, settings])

  if (!open || !draft) return null

  const save = async () => {
    if (await useClaudeCodeStore.getState().saveSettings(draft)) close()
  }

  return (
    <GoStudioModal
      open={open}
      onClose={close}
      size="md"
      divided
      icon={ClaudeLogo}
      title="Claude Code"
      subtitle={<span className="text-text-3">{status?.message || status?.state || 'disabled'}{status?.version ? ` · adapter ${status.version}` : ''}</span>}
      actions={<label className="gs-check mr-1 text-[12.5px]"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Enabled</label>}
      footer={<>
        <GoStudioButton variant="ghost" onClick={close}>Cancel</GoStudioButton>
        <GoStudioButton variant="primary" loading={busy} onClick={() => void save()}>Save</GoStudioButton>
      </>}
    >
      {error && <GoStudioAlert icon={AlertCircle}>{error}</GoStudioAlert>}

      <section className="flex flex-col gap-2.5">
        <h3 className="gs-section-title">Agent</h3>
        <p className="text-[12.5px] text-text-2">
          adOmnia talks to Claude Code through its official ACP adapter, started with <span className="gs-mono">npx</span> (Node.js 22+) the first time and then from npm&apos;s cache.
          It uses the account you logged in with <span className="gs-mono">claude</span>; run <span className="gs-mono">claude</span> once in a terminal if you never did.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void Browser.OpenURL(ADAPTER_URL)} className={BUTTON}><ExternalLink size={12} /> claude-agent-acp</button>
          <button type="button" disabled={busy || !settings?.enabled} onClick={() => void useClaudeCodeStore.getState().restart()} className={BUTTON}>Restart</button>
          <button type="button" onClick={() => void getClaudeCodeLog().then(setLog)} className={BUTTON}>Show logs</button>
        </div>
        {log && <pre className="gs-surface gs-mono max-h-44 overflow-auto p-3 text-[11px] leading-5 text-text-3">{log.length ? log.join('\n') : 'No log lines yet.'}</pre>}
      </section>

      {config && <ConfigurationSection config={config} />}

      <section className="flex flex-col gap-2.5">
        <h3 className="gs-section-title">Account</h3>
        <label className="gs-check">
          <input type="checkbox" checked={!!draft.ignoreApiKey} onChange={(event) => setDraft({ ...draft, ignoreApiKey: event.target.checked })} />
          Use my Claude login, ignore <span className="gs-mono">ANTHROPIC_API_KEY</span>
        </label>
        <p className="text-[11.5px] text-text-4">When that variable is set, Claude Code bills the API key instead of your Pro/Max plan.</p>
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="gs-section-title">Adapter</h3>
        <input
          value={draft.binaryPath}
          onChange={(event) => setDraft({ ...draft, binaryPath: event.target.value })}
          placeholder="claude-agent-acp on PATH, otherwise npx"
          className="gs-input gs-mono text-[12px]"
          aria-label="Claude Code adapter path"
        />
        {status?.binary && <p className="text-[11.5px] text-text-4">In use: <span className="gs-mono">{status.binary}</span></p>}
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="gs-section-title">Tool permissions</h3>
        <label className="gs-check">
          <input type="checkbox" checked={draft.skipPermissions} onChange={(event) => setDraft({ ...draft, skipPermissions: event.target.checked })} />
          Approve every tool call without asking
        </label>
        {draft.skipPermissions && <GoStudioAlert icon={AlertCircle}>Claude Code will run shell commands and edit files in the project without confirmation.</GoStudioAlert>}
      </section>
    </GoStudioModal>
  )
}

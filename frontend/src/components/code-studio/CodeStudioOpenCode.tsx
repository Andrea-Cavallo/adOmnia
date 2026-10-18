import { useEffect, useState } from 'react'
import { TerminalSquare } from 'lucide-react'
import { Browser } from '@wailsio/runtime'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { MilkSettings } from '@/lib/milk-api'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { checkOllamaModel, listOllamaModels, useOpenCodeStore } from '@/stores/opencode'
import { CodeStudioAgentChat, type ChatAgent } from './CodeStudioAgentChat'
import { CodeStudioAlert, CodeStudioButton, CodeStudioField, CodeStudioModal } from './CodeStudioModal'

export const OpenCodeLogo = TerminalSquare
const AGENT: ChatAgent = {
  tool: 'opencode', name: 'OpenCode · Ollama', store: useOpenCodeStore, Logo: OpenCodeLogo,
  suggestions: ['Explain the open file', 'Find possible bugs in this project', 'Write tests for the open file'],
  intro: 'OpenCode works in this folder using your local Ollama model. It asks before editing files or running commands.',
  setupHint: 'Choose an installed Ollama model and enable OpenCode in settings.',
  setupTitle: status => status?.state === 'starting' ? 'Starting OpenCode…' : status?.state === 'not-installed' ? 'OpenCode is not installed' : 'OpenCode is not running',
  setupAction: () => 'Open OpenCode settings',
}
export function CodeStudioOpenCodeChat(props: { session: GoIDESession; document?: GoIDEEditorDocument | null }) {
  return <CodeStudioAgentChat agent={AGENT} {...props} />
}

export function CodeStudioOpenCodeDialog() {
  const open = useOpenCodeStore(state => state.dialogOpen)
  const settings = useOpenCodeStore(state => state.settings)
  const status = useOpenCodeStore(state => state.status)
  const busy = useOpenCodeStore(state => state.busy)
  const storeError = useOpenCodeStore(state => state.error)
  const [draft, setDraft] = useState<MilkSettings | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    if (open) { void useOpenCodeStore.getState().ensure(); setError(null); setChecked(false); setModels([]) }
  }, [open])
  useEffect(() => { if (open && settings) setDraft({ ...settings, env: { ...settings.env } }) }, [open, settings])
  if (!open) return null
  const close = () => useOpenCodeStore.getState().setDialogOpen(false)
  // Opening settings must not depend on a successful backend call. Otherwise
  // the very error needed to diagnose an unavailable service is hidden too.
  if (!settings || !draft) return <CodeStudioModal open title="OpenCode + Ollama" onClose={close}
    footer={<CodeStudioButton onClick={close}>Close</CodeStudioButton>}>
    {storeError
      ? <><CodeStudioAlert>{storeError}</CodeStudioAlert><p className="text-xs text-text-2">OpenCode settings could not be loaded. If adOmnia was updated while running, restart it to load the current backend.</p></>
      : <p role="status" className="text-xs text-text-2">Loading OpenCode settings…</p>}
    <CodeStudioButton onClick={() => void useOpenCodeStore.getState().ensure()}>Retry</CodeStudioButton>
  </CodeStudioModal>
  const env = draft.env ?? {}
  const endpoint = env.ADOMNIA_OLLAMA_URL || 'http://127.0.0.1:11434'
  const model = env.ADOMNIA_OLLAMA_MODEL || ''
  const setEnv = (key: string, value: string) => setDraft({ ...draft, env: { ...env, [key]: value } })
  const refresh = async () => {
    setChecking(true); setError(null); setChecked(false)
    try {
      const found = await listOllamaModels(endpoint)
      setModels(found); setChecked(true)
      if (!found.length) setError('Ollama is running but no local models are installed. Install a model with tool calling in Ollama, then refresh.')
    } catch (cause) { setError(String(cause)); setModels([]) }
    finally { setChecking(false) }
  }
  const save = async () => {
    if (draft.enabled) {
      setChecking(true); setError(null)
      try { await checkOllamaModel(endpoint, model) }
      catch (cause) { setError(String(cause)); return }
      finally { setChecking(false) }
    }
    if (await useOpenCodeStore.getState().saveSettings({ ...draft, env: { ADOMNIA_OLLAMA_URL: endpoint, ADOMNIA_OLLAMA_MODEL: model }, skipPermissions: false, disableBuiltinMcp: true })) close()
  }
  return <CodeStudioModal open title="OpenCode + Ollama" subtitle="Local model, project chat and tools" onClose={close} persistent={busy}
    footer={<><CodeStudioButton onClick={close}>Cancel</CodeStudioButton><CodeStudioButton variant="primary" disabled={busy || checking || (draft.enabled && !model)} onClick={() => void save()}>Save</CodeStudioButton></>}>
    <p className="text-xs text-text-2">OpenCode and Ollama run on this machine. Choose a local model that supports tool calling. No model is downloaded by adOmnia.</p>
    <div className="flex gap-2"><CodeStudioButton small onClick={() => void Browser.OpenURL('https://opencode.ai/docs/')}>Install OpenCode</CodeStudioButton><CodeStudioButton small onClick={() => void Browser.OpenURL('https://ollama.com/download')}>Install Ollama</CodeStudioButton></div>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />Enable OpenCode</label>
    <CodeStudioField label="OpenCode executable" hint="Leave empty to find opencode on PATH or in its usual installation folders."><input className="gs-input gs-mono" value={draft.binaryPath} onChange={event => setDraft({ ...draft, binaryPath: event.target.value })} placeholder="Automatic" /></CodeStudioField>
    <CodeStudioField label="Ollama URL" hint="HTTP loopback only, such as 127.0.0.1 or localhost."><input className="gs-input gs-mono" value={endpoint} onChange={event => { setEnv('ADOMNIA_OLLAMA_URL', event.target.value); setModels([]); setChecked(false) }} /></CodeStudioField>
    <CodeStudioButton small loading={checking} disabled={busy} onClick={() => void refresh()}>Connect and refresh models</CodeStudioButton>
    <CodeStudioField label="Installed Ollama model"><select className="gs-input gs-mono" value={model} onChange={event => setEnv('ADOMNIA_OLLAMA_MODEL', event.target.value)}><option value="">Choose a model</option>{[...new Set([...(model ? [model] : []), ...models])].map(name => <option key={name} value={name}>{name}</option>)}</select></CodeStudioField>
    {checked && models.length > 0 && <p role="status" className="text-xs text-success">Ollama connected · {models.length} local models found</p>}
    {(error || storeError) && <CodeStudioAlert>{error || storeError}</CodeStudioAlert>}
    {status?.message && <p className="text-xs text-text-3">{status.message}</p>}
    <p className="text-xs text-text-3">Only the Ollama provider is enabled. Web tools and automatic updates are disabled. File changes and shell commands require approval. OpenCode can also read its own project configuration; review any plugins or MCP servers configured there.</p>
  </CodeStudioModal>
}

import { useEffect, useState } from 'react'
import { Download, Terminal, RefreshCw } from 'lucide-react'
import * as Pi from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/piagent'
import type { MilkSettings } from '@/lib/milk-api'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { usePiAgentStore } from '@/stores/piAgent'
import { CodeStudioAgentChat, type ChatAgent } from './CodeStudioAgentChat'
import { CodeStudioAlert, CodeStudioButton, CodeStudioField, CodeStudioModal } from './CodeStudioModal'
import '@/styles/studioNothing.css'

const PI: ChatAgent = {
  tool: 'pi', name: 'Pi', store: usePiAgentStore, Logo: Terminal,
  sessionControls: root => Pi.SessionControls(root), setSessionControl: (root, id, value) => Pi.SetSessionControl(root, id, value),
  suggestions: ['Explain how this project is structured', 'Find and fix the issue in the open file', 'Write tests for this function'],
  intro: 'Pi works in this project with its own model and tools. Tool actions ask for confirmation in adOmnia.',
  setupHint: 'Install or enable Pi, then configure a provider using Pi’s own login or API keys.',
  setupTitle: status => status?.state === 'not-installed' ? 'Connect Pi to this project' : 'Pi is not running',
  setupAction: () => 'Open Pi settings',
}

export function CodeStudioPiChat(props: { session: GoIDESession; document?: GoIDEEditorDocument | null }) {
  const open = usePiAgentStore(state => state.dialogOpen), settings = usePiAgentStore(state => state.settings), busy = usePiAgentStore(state => state.busy), error = usePiAgentStore(state => state.error)
  const [draft, setDraft] = useState<MilkSettings | null>(null)
  useEffect(() => { if (open) setDraft(settings) }, [open, settings])
  const loginCommand = settings?.binaryPath ? (/\.(m?js)$/i.test(settings.binaryPath) ? `node ${JSON.stringify(settings.binaryPath)} ` : `& ${JSON.stringify(settings.binaryPath)} `) : 'pi '
  const close = () => usePiAgentStore.getState().setDialogOpen(false)
  return <><CodeStudioAgentChat agent={PI} {...props} /><CodeStudioModal open={open} onClose={close} title={<span className="nothing-studio-title">Pi agent</span>} className="nothing-studio" subtitle="Native Pi RPC · project sessions · model and thinking controls" persistent={busy} divided footer={<><CodeStudioButton variant="ghost" onClick={close}>Close</CodeStudioButton><CodeStudioButton variant="primary" disabled={!draft} loading={busy} onClick={() => { if (draft) void usePiAgentStore.getState().saveSettings(draft).then(saved => { if (saved) close() }) }}>Save settings</CodeStudioButton></>}>
    {error && <CodeStudioAlert>{error}</CodeStudioAlert>}
    <p className="text-xs leading-relaxed text-text-3">Pi uses its own provider credentials and model configuration. For OAuth, run the command below in a terminal and use <code>/login</code>. Then choose the model in the session controls.</p>
    <pre className="rounded border border-border-1 bg-surface-2 p-3 text-xs text-text-2 whitespace-pre-wrap break-all"><code>{loginCommand.trim()}</code></pre>
    <div className="flex flex-wrap gap-2"><CodeStudioButton icon={Download} loading={busy} onClick={() => void usePiAgentStore.getState().install()}>Install Pi 1.4.0</CodeStudioButton><CodeStudioButton icon={RefreshCw} disabled={busy} onClick={() => void usePiAgentStore.getState().restart()}>Restart</CodeStudioButton></div>
    <p className="gs-hint">Install uses the official @earendil-works/pi-coding-agent package in adOmnia’s tools directory. Node.js and npm must be installed. Nothing is downloaded when you open the chat.</p>
    {draft && <><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />Enable Pi</label><CodeStudioField label="Custom Pi executable or CLI script" hint="Leave empty to use the managed installation or Pi from PATH."><input className="gs-input" aria-label="Pi executable" value={draft.binaryPath} onChange={event => setDraft({ ...draft, binaryPath: event.target.value })} /></CodeStudioField><CodeStudioField label="Turn timeout (minutes)" hint="Zero uses the shared ten-minute default."><input className="gs-input" type="number" min={0} max={120} value={draft.turnTimeoutMinutes ?? 0} onChange={event => setDraft({ ...draft, turnTimeoutMinutes: Number(event.target.value) })} /></CodeStudioField></>}
    <p className="gs-hint">adOmnia supplies a confirmation extension. Third-party Pi extensions are not loaded here. Project AI exclusions apply to file tools; shell commands still require review and are not sandboxed.</p>
  </CodeStudioModal></>
}

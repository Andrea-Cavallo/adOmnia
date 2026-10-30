import { ContextMenu } from '@/components/ui/ContextMenu'
import { CodeStudioChatHeader } from './CodeStudioChatChrome'
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { ChevronDown, Cpu, ListTodo, Power, Terminal } from 'lucide-react'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { isChatPane, useCodeStudioAssistantStore } from '@/stores/codeStudioAssistant'
import { GitHubMark } from './CodeStudioCopilotStatus'
import { ClaudeLogo, CodeStudioClaudeChat } from './CodeStudioClaudeCode'
import { MilkLogo } from './CodeStudioMilkDialog'
import { CodeStudioCopilotChat } from './CodeStudioCopilotChat'
import { CodeStudioPiChat } from './CodeStudioPiChat'
import { CodeStudioMilkChat } from './CodeStudioMilkChat'
import { CodeStudioAgentTasks } from './CodeStudioAgentTasks'
import { AI_PROVIDERS, AI_PROVIDER_TONE_CLASS, aiProviderPower, aiProviderTooltip } from './codeStudioAiHub'
import { ensureAiProviders, setAiProviderEnabled, useAiProviders } from './useAiProviders'
import type { CodeStudioChatPane } from '@/stores/codeStudioAssistant'

const LocalLlmChat = lazy(() => import('./CodeStudioLocalLlmChat').then(module => ({ default: module.CodeStudioLocalLlmChat })))

const PROVIDER_ICONS: Record<CodeStudioChatPane, ComponentType<{ size?: number }>> = {
  copilot: GitHubMark,
  milk: MilkLogo,
  claude: ClaudeLogo,
  local: Cpu,
  pi: Terminal,
}

interface CodeStudioAiHubPanelProps {
  session: GoIDESession
  document: GoIDEEditorDocument | null
}

/** Chat dei provider e task condividono il tool window senza cambiare il provider salvato. */
export function CodeStudioAiHubPanel({ session, document }: CodeStudioAiHubPanelProps) {
  const active = useCodeStudioAssistantStore((state) => (isChatPane(state.pane) ? state.pane : state.lastProvider))
  const open = useCodeStudioAssistantStore((state) => state.open)
  const providers = useAiProviders()
  const tasksOpen = useCodeStudioAssistantStore((state) => state.tasksOpen)
  const showTasks = useCodeStudioAssistantStore((state) => state.showTasks)
  const [menu, setMenu] = useState<{x: number; y: number} | null>(null)
  const [switching, setSwitching] = useState<CodeStudioChatPane | null>(null)
  useEffect(() => { ensureAiProviders() }, [])
  const Icon = PROVIDER_ICONS[active]
  const current = providers[active]
  const label = AI_PROVIDERS.find(item => item.id === active)?.label ?? active
  const power = aiProviderPower(label, current.enabled)
  const chrome = <div className="studio-chat-switcher">
    <button type="button" className="studio-chat-provider" aria-label={`Choose assistant: ${label}`} aria-haspopup="menu" aria-expanded={!!menu} title={aiProviderTooltip(current.tone, current.message, label)} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { x: rect.left, y: rect.bottom + 6 }) }}><Icon size={15} /><span>{label}</span><span className={`studio-chat-state ${AI_PROVIDER_TONE_CLASS[current.tone]}`} aria-hidden="true" /><ChevronDown size={12} /></button>
    <button type="button" className="studio-chat-tasks" aria-label={tasksOpen ? 'Return to chat' : 'Agent tasks'} aria-pressed={tasksOpen} title={tasksOpen ? 'Return to chat' : 'Agent tasks'} onClick={() => tasksOpen ? open(active) : showTasks()}><ListTodo size={14} /></button>
  </div>
  return (
    <div className="studio-chat-hub flex min-h-0 min-w-0 flex-1 flex-col">
      {menu && <ContextMenu x={menu.x} y={menu.y} appearance="studio" items={[
        ...AI_PROVIDERS.map(item => ({ id: item.id, label: item.label, icon: PROVIDER_ICONS[item.id], checked: item.id === active && !tasksOpen })),
        ...(active === 'local' ? [] : [{ id: 'power', label: power.label, icon: Power, separatorBefore: true, disabled: power.disabled || switching === active }]),
      ]} onClose={() => setMenu(null)} onSelect={id => { setMenu(null); if (id === 'power' && active !== 'local') { setSwitching(active); void setAiProviderEnabled[active](power.next).finally(() => setSwitching(null)) } else if (isChatPane(id)) open(id) }} />}
      <CodeStudioChatHeader.Provider value={chrome}>
      {tasksOpen && <header className="studio-chat-header">{chrome}</header>}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {active === 'local' && !tasksOpen ? <Suspense fallback={<p role="status" className="p-3 text-xs text-text-3">Loading local chat…</p>}><LocalLlmChat key={session.id} session={session} document={document} /></Suspense> : tasksOpen ? <CodeStudioAgentTasks session={session} document={document} /> : active === 'pi' ? <CodeStudioPiChat session={session} document={document} /> : active === 'copilot' ? <CodeStudioCopilotChat session={session} document={document} /> : active === 'milk' ? <CodeStudioMilkChat session={session} document={document} /> : <CodeStudioClaudeChat session={session} document={document} />}
      </div>
      </CodeStudioChatHeader.Provider>
    </div>
  )
}

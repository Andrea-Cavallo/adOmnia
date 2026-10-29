import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { Cpu, ListTodo, Power, Terminal } from 'lucide-react'
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
  const [switching, setSwitching] = useState<CodeStudioChatPane | null>(null)
  useEffect(() => { ensureAiProviders() }, [])
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div role="tablist" aria-label="AI assistants" className="flex min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto px-1.5 py-1">
        {AI_PROVIDERS.map(({ id, label }) => {
          const { tone, message, enabled } = providers[id]
          const Icon = PROVIDER_ICONS[id]
          const power = aiProviderPower(label, enabled)
          return (
            <div key={id} className={`flex h-7 shrink-0 items-center rounded-md ${!tasksOpen && active === id ? 'bg-surface-3' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={!tasksOpen && active === id}
                onClick={() => { open(id) }}
                title={aiProviderTooltip(tone, message, label)}
                className={`relative flex h-7 items-center gap-1.5 rounded-md pl-2 pr-1 text-[11px] ${!tasksOpen && active === id ? 'font-semibold text-text-1' : 'text-text-3 hover:text-text-1'} ${enabled === false ? 'opacity-60' : ''}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${AI_PROVIDER_TONE_CLASS[tone]}`} aria-hidden="true" />
                <Icon size={12} />
                {label}
              </button>
              {id !== 'local' && <button
                type="button"
                aria-label={power.label}
                aria-pressed={enabled === true}
                title={power.label}
                disabled={power.disabled || switching === id}
                onClick={() => {
                  setSwitching(id)
                  void setAiProviderEnabled[id](power.next).finally(() => setSwitching((current) => (current === id ? null : current)))
                }}
                className={`mr-0.5 flex h-5 w-5 items-center justify-center rounded hover:bg-surface-4 hover:text-text-1 disabled:opacity-40 ${enabled ? 'text-success' : 'text-text-4'}`}
              >
                <Power size={11} />
              </button>}
            </div>
          )
        })}
        <button type="button" role="tab" aria-selected={tasksOpen} onClick={() => { showTasks() }} className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] ${tasksOpen ? 'bg-surface-3 font-semibold text-text-1' : 'text-text-3 hover:text-text-1'}`}><ListTodo size={12} />Tasks</button>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {active === 'local' && !tasksOpen ? <Suspense fallback={<p role="status" className="p-3 text-xs text-text-3">Loading local chat…</p>}><LocalLlmChat key={session.id} session={session} document={document} /></Suspense> : tasksOpen ? <CodeStudioAgentTasks session={session} document={document} /> : active === 'pi' ? <CodeStudioPiChat session={session} document={document} /> : active === 'copilot' ? <CodeStudioCopilotChat session={session} document={document} /> : active === 'milk' ? <CodeStudioMilkChat session={session} document={document} /> : <CodeStudioClaudeChat session={session} document={document} />}
      </div>
    </div>
  )
}

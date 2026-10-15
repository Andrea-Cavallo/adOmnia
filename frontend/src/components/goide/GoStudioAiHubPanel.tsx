import { useEffect, type ComponentType } from 'react'
import type { GoIDESession } from '@/lib/goide-api'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { isChatPane, useGoStudioAssistantStore } from '@/stores/goStudioAssistant'
import { GitHubMark } from './GoStudioCopilotStatus'
import { ClaudeLogo, GoStudioClaudeChat } from './GoStudioClaudeCode'
import { MilkLogo } from './GoStudioMilkDialog'
import { GoStudioCopilotChat } from './GoStudioCopilotChat'
import { GoStudioMilkChat } from './GoStudioMilkChat'
import { AI_PROVIDERS, AI_PROVIDER_TONE_CLASS, aiProviderTooltip } from './goStudioAiHub'
import { ensureAiProviders, useAiProviders } from './useAiProviders'
import type { GoStudioChatPane } from '@/stores/goStudioAssistant'

const PROVIDER_ICONS: Record<GoStudioChatPane, ComponentType<{ size?: number }>> = {
  copilot: GitHubMark,
  milk: MilkLogo,
  claude: ClaudeLogo,
}

interface GoStudioAiHubPanelProps {
  session: GoIDESession
  document: GoIDEEditorDocument | null
}

/**
 * Hub delle chat AI: un solo pannello con i tab di Copilot, milk e Claude Code,
 * ognuno con il proprio pallino di stato. Le chat restano i componenti di sempre
 * (GoStudioCopilotChat / GoStudioMilkChat / GoStudioClaudeChat), montati come figli.
 */
export function GoStudioAiHubPanel({ session, document }: GoStudioAiHubPanelProps) {
  const active = useGoStudioAssistantStore((state) => (isChatPane(state.pane) ? state.pane : state.lastProvider))
  const open = useGoStudioAssistantStore((state) => state.open)
  const providers = useAiProviders()
  useEffect(() => { ensureAiProviders() }, [])
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div role="tablist" aria-label="AI assistants" className="flex min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto px-1.5 py-1">
        {AI_PROVIDERS.map(({ id, label }) => {
          const { tone, message } = providers[id]
          const Icon = PROVIDER_ICONS[id]
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active === id}
              onClick={() => open(id)}
              title={aiProviderTooltip(tone, message, label)}
              className={`relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] ${active === id ? 'bg-surface-3 font-semibold text-text-1' : 'text-text-3 hover:text-text-1'}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${AI_PROVIDER_TONE_CLASS[tone]}`} aria-hidden="true" />
              <Icon size={12} />
              {label}
            </button>
          )
        })}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {active === 'copilot' ? <GoStudioCopilotChat session={session} document={document} /> : active === 'milk' ? <GoStudioMilkChat session={session} document={document} /> : <GoStudioClaudeChat session={session} document={document} />}
      </div>
    </div>
  )
}

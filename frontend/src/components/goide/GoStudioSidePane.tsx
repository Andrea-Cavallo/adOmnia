import { lazy, Suspense, useState } from 'react'
import { Bot, Braces, FolderTree, Minus, Sparkles } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { GoStudioProjectOverview } from './GoStudioProjectOverview'
import { GoStudioStructure } from './GoStudioStructure'
import { GoStudioCopilotChat } from './GoStudioCopilotChat'
import { useGoStudioAssistantStore } from '@/stores/goStudioAssistant'

const AICompanion = lazy(() => import('@/components/assistant/AICompanion').then((module) => ({ default: module.AICompanion })))

type SidePaneTab = 'structure' | 'project' | 'copilot' | 'a0'

interface GoStudioSidePaneProps {
  session: GoIDESession
  document: GoIDEEditorDocument | null
}

const TABS: ReadonlyArray<{ id: SidePaneTab; label: string; icon: typeof Braces }> = [
  { id: 'structure', label: 'Structure', icon: Braces },
  { id: 'project', label: 'Project', icon: FolderTree },
  { id: 'copilot', label: 'Copilot', icon: Sparkles },
  { id: 'a0', label: 'AI di a0', icon: Bot },
]

export function GoStudioSidePane({ session, document }: GoStudioSidePaneProps) {
  const [tab, setTab] = useState<SidePaneTab>('structure')
  const assistantPane = useGoStudioAssistantStore((state) => state.pane)
  const visibleTab: SidePaneTab = assistantPane ?? (tab === 'copilot' || tab === 'a0' ? 'structure' : tab)
  const selectTab = (next: SidePaneTab) => {
    if (next === 'copilot' || next === 'a0') useGoStudioAssistantStore.getState().open(next)
    else useGoStudioAssistantStore.getState().close()
    setTab(next)
  }
  return (
    <aside aria-label="Structure and project overview" className="flex h-full min-w-0 flex-col">
      <div role="tablist" className="go-studio-tool-header gap-1 pl-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={visibleTab === id} onClick={() => selectTab(id)} className={`relative flex h-9 items-center gap-1.5 px-2 text-[12px] ${visibleTab === id ? 'font-semibold text-text-1' : 'text-text-3 hover:text-text-1'}`}>
            <Icon size={13} /> {label}
            {visibleTab === id && <span className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-accent" aria-hidden="true" />}
          </button>
        ))}
        <button type="button" onClick={() => useGoIDEStore.getState().updateLayout({ structureOpen: false })} aria-label="Hide Structure pane" title="Hide · Alt+7" className="go-studio-icon-button ml-auto mr-1 h-6 w-6"><Minus size={14} /></button>
      </div>
      {visibleTab === 'structure' ? <GoStudioStructure sessionId={session.id} document={document} /> : visibleTab === 'project' ? <GoStudioProjectOverview session={session} /> : visibleTab === 'copilot' ? <GoStudioCopilotChat session={session} document={document} /> : <Suspense fallback={<div className="p-3 text-[10px] text-text-4">Loading a0…</div>}><AICompanion /></Suspense>}
    </aside>
  )
}

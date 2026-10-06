import { Suspense, lazy, useState, type ComponentType } from 'react'
import { Braces, FolderTree, Minus, Sparkles } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { GoStudioProjectOverview } from './GoStudioProjectOverview'
import { GoStudioStructure } from './GoStudioStructure'
import { GoStudioCopilotChat } from './GoStudioCopilotChat'
import { GoStudioMilkChat } from './GoStudioMilkChat'
import { MilkLogo } from './GoStudioMilkDialog'
import { useGoStudioAssistantStore } from '@/stores/goStudioAssistant'

const AICompanion = lazy(() => import('@/components/assistant/AICompanion').then((module) => ({ default: module.AICompanion })))

type SidePaneTab = 'structure' | 'project' | 'copilot' | 'milk'

interface GoStudioSidePaneProps {
  session: GoIDESession
  document: GoIDEEditorDocument | null
}

const TABS: ReadonlyArray<{ id: SidePaneTab; label: string; icon: ComponentType<{ size?: number }> }> = [
  { id: 'structure', label: 'Structure', icon: Braces },
  { id: 'project', label: 'Project', icon: FolderTree },
  { id: 'copilot', label: 'Copilot', icon: Sparkles },
  { id: 'milk', label: 'milk', icon: MilkLogo },
]

export function GoStudioSidePane({ session, document }: GoStudioSidePaneProps) {
  const [tab, setTab] = useState<SidePaneTab>('structure')
  const pane = useGoStudioAssistantStore((state) => state.pane)
  const activeAssistant: SidePaneTab | null = pane === 'copilot' ? 'copilot' : pane === 'milk' ? 'milk' : null
  const visibleTab: SidePaneTab = activeAssistant ?? (tab === 'copilot' || tab === 'milk' ? 'structure' : tab)
  const selectTab = (next: SidePaneTab) => {
    if (next === 'copilot' || next === 'milk') useGoStudioAssistantStore.getState().open(next)
    else useGoStudioAssistantStore.getState().close()
    setTab(next)
  }
  const content = pane === 'a0' ? <Suspense fallback={<div className="p-3 text-[10px] text-text-4">Loading a0…</div>}><AICompanion /></Suspense> : activeAssistant === 'copilot' ? <GoStudioCopilotChat session={session} document={document} /> : activeAssistant === 'milk' ? <GoStudioMilkChat session={session} document={document} /> : visibleTab === 'structure' ? <GoStudioStructure sessionId={session.id} document={document} /> : <GoStudioProjectOverview session={session} />
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
      {content}
    </aside>
  )
}

import { Suspense, lazy, useState, type ComponentType } from 'react'
import { Braces, Crosshair, FolderTree, Minus, Sparkles } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { GoStudioProjectOverview } from './GoStudioProjectOverview'
import { GoStudioStructure } from './GoStudioStructure'
import { GoStudioLineContext } from './GoStudioLineContext'
import { GoStudioCopilotChat } from './GoStudioCopilotChat'
import { GoStudioMilkChat } from './GoStudioMilkChat'
import { ClaudeLogo, GoStudioClaudeChat } from './GoStudioClaudeCode'
import { MilkLogo } from './GoStudioMilkDialog'
import { isChatPane, type GoStudioChatPane, useGoStudioAssistantStore } from '@/stores/goStudioAssistant'
import { StudioToolControls } from './StudioToolControls'
import { toolKey, useStudioTools } from './studioToolState'

const AICompanion = lazy(() => import('@/components/assistant/AICompanion').then((module) => ({ default: module.AICompanion })))

type SidePaneTab = 'structure' | 'context' | 'project' | GoStudioChatPane

interface GoStudioSidePaneProps {
  session: GoIDESession
  document: GoIDEEditorDocument | null
}

const TABS: ReadonlyArray<{ id: SidePaneTab; label: string; icon: ComponentType<{ size?: number }> }> = [
  { id: 'structure', label: 'Structure', icon: Braces },
  { id: 'context', label: 'Context', icon: Crosshair },
  { id: 'project', label: 'Project', icon: FolderTree },
  { id: 'copilot', label: 'Copilot', icon: Sparkles },
  { id: 'milk', label: 'milk', icon: MilkLogo },
  { id: 'claude', label: 'Claude', icon: ClaudeLogo },
]

export function GoStudioSidePane({ session, document }: GoStudioSidePaneProps) {
  const [tab, setTab] = useState<SidePaneTab>('structure')
  const pane = useGoStudioAssistantStore((state) => state.pane)
  const detached = useStudioTools((state) => isChatPane(pane) && state.detached.includes(toolKey(session.id, pane)))
  const activeAssistant: SidePaneTab | null = isChatPane(pane) ? pane : null
  const visibleTab: SidePaneTab = activeAssistant ?? (isChatPane(tab) ? 'structure' : tab)
  const selectTab = (next: SidePaneTab) => {
    if (isChatPane(next)) useGoStudioAssistantStore.getState().open(next)
    else useGoStudioAssistantStore.getState().close()
    setTab(next)
  }
  const content = pane === 'a0' ? <Suspense fallback={<div className="p-3 text-[10px] text-text-4">Loading a0…</div>}><AICompanion /></Suspense> : activeAssistant === 'copilot' ? <GoStudioCopilotChat session={session} document={document} /> : activeAssistant === 'milk' ? <GoStudioMilkChat session={session} document={document} /> : activeAssistant === 'claude' ? <GoStudioClaudeChat session={session} document={document} /> : visibleTab === 'structure' ? <GoStudioStructure sessionId={session.id} document={document} /> : visibleTab === 'context' ? <GoStudioLineContext session={session} document={document} /> : <GoStudioProjectOverview session={session} />
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
      {isChatPane(pane) && <div className="flex justify-end border-b border-border-1 px-2"><StudioToolControls session={session.id} tool={pane} defaultPlacement="right" /></div>}
      {!detached && content}
    </aside>
  )
}

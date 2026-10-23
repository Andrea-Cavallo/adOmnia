import { Suspense, lazy, useState, type ComponentType } from 'react'
import { useCodeStudioRuntimeContext } from '@/stores/codeStudioRuntimeContext'
import { Braces, Crosshair, FolderTree, Minus, Sparkles } from 'lucide-react'
import type { GoIDESession } from '@/lib/code-studio-api'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { CodeStudioProjectOverview } from './CodeStudioProjectOverview'
import { CodeStudioStructure } from './CodeStudioStructure'
import { CodeStudioLineContext } from './CodeStudioLineContext'
import { CodeStudioAiHubPanel } from './CodeStudioAiHubPanel'
import { IDE_LANGUAGE_NAMES } from '@/components/ide/languages'
import { projectProfile } from '@/lib/code-studio/projectProfile'
import { isChatPane, useCodeStudioAssistantStore } from '@/stores/codeStudioAssistant'
import { StudioToolControls } from './StudioToolControls'
import { toolKey, useStudioTools } from './studioToolState'

const AICompanion = lazy(() => import('@/components/assistant/AICompanion').then((module) => ({ default: module.AICompanion })))

type SidePaneTab = 'structure' | 'context' | 'project' | 'ai'

interface CodeStudioSidePaneProps {
  session: GoIDESession
  document: GoIDEEditorDocument | null
}

// Copilot, milk e Claude Code non sono più tab separati: vivono nell'hub AI,
// che mostra il provider scelto per ultimo (codeStudioAssistant.lastProvider).
const TABS: ReadonlyArray<{ id: SidePaneTab; label: string; icon: ComponentType<{ size?: number }> }> = [
  { id: 'structure', label: 'Structure', icon: Braces },
  { id: 'context', label: 'Context', icon: Crosshair },
  { id: 'project', label: 'Project', icon: FolderTree },
  { id: 'ai', label: 'AI Assistant', icon: Sparkles },
]

export function CodeStudioSidePane({ session, document }: CodeStudioSidePaneProps) {
  const [tab, setTab] = useState<SidePaneTab>('structure')
  const selectedRuntime = useCodeStudioRuntimeContext(state => state.selected)
  // Context parla di Go (route, SQL, goroutine, go.mod): senza unità Go la scheda non viene mostrata.
  const hasGo = projectProfile(session.project, IDE_LANGUAGE_NAMES).hasGo
  // Jump to Context when a runtime of this session gets selected (adjusted during render, not in an effect).
  const [seenRuntime, setSeenRuntime] = useState({ hasGo, selectedRuntime, sessionId: session.id })
  if (seenRuntime.hasGo !== hasGo || seenRuntime.selectedRuntime !== selectedRuntime || seenRuntime.sessionId !== session.id) {
    setSeenRuntime({ hasGo, selectedRuntime, sessionId: session.id })
    if (hasGo && selectedRuntime?.sessionId === session.id) setTab('context')
  }
  const pane = useCodeStudioAssistantStore((state) => state.pane)
  const detached = useStudioTools((state) => isChatPane(pane) && state.detached.includes(toolKey(session.id, pane)))
  const assistantOpen = isChatPane(pane)
  const tabs = TABS.filter(({ id }) => (assistantOpen ? id === 'ai' : id !== 'ai') && (id !== 'context' || hasGo))
  const visibleTab: SidePaneTab = assistantOpen ? 'ai' : tab === 'ai' || (tab === 'context' && !hasGo) ? 'structure' : tab
  const selectTab = (next: SidePaneTab) => {
    const assistant = useCodeStudioAssistantStore.getState()
    if (next === 'ai') assistant.open(assistant.lastProvider)
    else assistant.close()
    setTab(next)
  }
  const content = pane === 'a0'
    ? <Suspense fallback={<div className="p-3 text-[10px] text-text-4">Loading a0…</div>}><AICompanion /></Suspense>
    : assistantOpen
      ? <CodeStudioAiHubPanel session={session} document={document} />
      : visibleTab === 'structure'
        ? <CodeStudioStructure sessionId={session.id} document={document} />
        : visibleTab === 'context'
          ? <CodeStudioLineContext session={session} document={document} />
          : <CodeStudioProjectOverview session={session} />
  return (
    <aside aria-label={assistantOpen ? 'AI Assistant' : 'Structure and project overview'} className="flex h-full min-h-0 min-w-0 flex-col">
      <div role="tablist" className="code-studio-tool-header min-w-0 shrink-0 gap-1 overflow-x-auto pl-2">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={visibleTab === id} onClick={() => selectTab(id)} className={`relative flex h-9 shrink-0 items-center gap-1.5 px-2 text-[12px] ${visibleTab === id ? 'font-semibold text-text-1' : 'text-text-3 hover:text-text-1'}`}>
            <Icon size={13} /> {label}
            {visibleTab === id && <span className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-accent" aria-hidden="true" />}
          </button>
        ))}
        <button type="button" onClick={() => useCodeStudioStore.getState().updateLayout({ structureOpen: false })} aria-label="Hide Structure pane" title="Hide · Alt+7" className="code-studio-icon-button ml-auto mr-1 h-6 w-6"><Minus size={14} /></button>
      </div>
      {isChatPane(pane) && <div className="flex justify-end border-b border-border-1 px-2"><StudioToolControls session={session.id} tool={pane} defaultPlacement="right" /></div>}
      {!detached && content}
    </aside>
  )
}

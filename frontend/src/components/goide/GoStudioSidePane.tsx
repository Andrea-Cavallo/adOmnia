import { useState } from 'react'
import { Braces, FolderTree, Minus } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { GoStudioProjectOverview } from './GoStudioProjectOverview'
import { GoStudioStructure } from './GoStudioStructure'

type SidePaneTab = 'structure' | 'project'

interface GoStudioSidePaneProps {
  session: GoIDESession
  document: GoIDEEditorDocument | null
}

const TABS: ReadonlyArray<{ id: SidePaneTab; label: string; icon: typeof Braces }> = [
  { id: 'structure', label: 'Structure', icon: Braces },
  { id: 'project', label: 'Project', icon: FolderTree },
]

export function GoStudioSidePane({ session, document }: GoStudioSidePaneProps) {
  const [tab, setTab] = useState<SidePaneTab>('structure')
  return (
    <aside aria-label="Structure and project overview" className="flex h-full min-w-0 flex-col">
      <div role="tablist" className="go-studio-tool-header gap-1 pl-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`relative flex h-9 items-center gap-1.5 px-2 text-[12px] ${tab === id ? 'font-semibold text-text-1' : 'text-text-3 hover:text-text-1'}`}>
            <Icon size={13} /> {label}
            {tab === id && <span className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-accent" aria-hidden="true" />}
          </button>
        ))}
        <button type="button" onClick={() => useGoIDEStore.getState().updateLayout({ structureOpen: false })} aria-label="Hide Structure pane" title="Hide · Alt+7" className="go-studio-icon-button ml-auto mr-1 h-6 w-6"><Minus size={14} /></button>
      </div>
      {tab === 'structure' ? <GoStudioStructure sessionId={session.id} document={document} /> : <GoStudioProjectOverview session={session} />}
    </aside>
  )
}

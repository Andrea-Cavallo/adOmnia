import { useState } from 'react'
import { Braces, FolderTree } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import type { GoIDEEditorDocument } from '@/stores/goide'
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
    <aside aria-label="Structure and project overview" className="flex h-full min-w-0 flex-col bg-surface-1">
      <div role="tablist" className="flex h-8 shrink-0 items-center border-b border-border-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex h-8 items-center gap-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider ${tab === id ? 'border-b border-b-accent text-text-1' : 'text-text-3 hover:text-text-1'}`}>
            <Icon size={11} /> {label}
          </button>
        ))}
      </div>
      {tab === 'structure' ? <GoStudioStructure sessionId={session.id} document={document} /> : <GoStudioProjectOverview session={session} />}
    </aside>
  )
}

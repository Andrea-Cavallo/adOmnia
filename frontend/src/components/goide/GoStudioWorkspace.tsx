import { useMemo, useState } from 'react'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { GoStudioEditor } from './GoStudioEditor'
import { GoStudioSidePane } from './GoStudioSidePane'
import { GoStudioProjectTree } from './GoStudioProjectTree'
import { GoStudioRunPanel } from './GoStudioRunPanel'
import { GoStudioTerminalPanel } from './GoStudioTerminalPanel'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import type { GoIDESession } from '@/lib/goide-api'
import type { GoStudioRunTarget } from './goStudioRunTargets'

interface GoStudioWorkspaceProps {
  session: GoIDESession
  projectWidth: number
  structureWidth: number
  bottomHeight: number
  structureOpen: boolean
  bottomOpen: boolean
  onProjectResize: (event: React.MouseEvent<HTMLDivElement>) => void
  onStructureResize: (event: React.MouseEvent<HTMLDivElement>) => void
  onBottomResize: (event: React.MouseEvent<HTMLDivElement>) => void
  onCursor: (line: number, column: number) => void
  onRequestCloseDocument: (documents: GoIDEEditorDocument[]) => void
  onRunTarget: (target: GoStudioRunTarget) => void
}

export function GoStudioWorkspace({ session, projectWidth, structureWidth, bottomHeight, structureOpen, bottomOpen, onProjectResize, onStructureResize, onBottomResize, onCursor, onRequestCloseDocument, onRunTarget }: GoStudioWorkspaceProps) {
  const allDocuments = useGoIDEStore((state) => state.documents)
  const documents = useMemo(() => allDocuments.filter((item) => item.document.sessionId === session.id), [allDocuments, session.id])
  const activeDocumentId = useGoIDEStore((state) => state.activeDocumentBySession[session.id] ?? null)
  const active = documents.find((item) => item.document.id === activeDocumentId) ?? null
  const [bottomTab, setBottomTab] = useState<'run' | 'terminal'>('run')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <div style={{ width: projectWidth }} className="shrink-0"><GoStudioProjectTree session={session} /></div>
        <ResizeHandle label="Resize project pane" onMouseDown={onProjectResize} />
        <GoStudioEditor documents={documents} active={active} onCursor={onCursor} onRequestClose={onRequestCloseDocument} onRunTarget={onRunTarget} />
        {structureOpen && <><ResizeHandle label="Resize structure pane" onMouseDown={onStructureResize} /><div style={{ width: structureWidth }} className="shrink-0"><GoStudioSidePane session={session} document={active} /></div></>}
      </div>
      {bottomOpen && (
        <>
          <ResizeHandle label="Resize tool window" orientation="horizontal" onMouseDown={onBottomResize} />
          <div style={{ height: bottomHeight }} className="flex min-h-0 shrink-0 flex-col">
            <div className="flex h-7 shrink-0 items-center gap-0.5 border-b border-border-1 bg-surface-1 px-1">
              <ToolWindowTab label="Run" active={bottomTab === 'run'} onSelect={() => setBottomTab('run')} />
              <ToolWindowTab label="Terminal" active={bottomTab === 'terminal'} onSelect={() => setBottomTab('terminal')} />
            </div>
            <div className="min-h-0 flex-1" style={{ display: bottomTab === 'run' ? 'block' : 'none' }}>
              <GoStudioRunPanel sessionId={session.id} />
            </div>
            {/* Il terminale resta montato quando si torna su Run: una shell
                interattiva non va distrutta cambiando scheda. */}
            <div className="min-h-0 flex-1" style={{ display: bottomTab === 'terminal' ? 'block' : 'none' }}>
              <GoStudioTerminalPanel session={session} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ToolWindowTab({ label, active, onSelect }: { label: string; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex h-7 items-center rounded px-2.5 text-[10px] font-semibold uppercase tracking-wider ${
        active ? 'bg-surface-3 text-text-1' : 'text-text-3 hover:bg-surface-2 hover:text-text-1'
      }`}
    >
      {label}
    </button>
  )
}

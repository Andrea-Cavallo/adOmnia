import { useMemo } from 'react'
import { Braces, Info } from 'lucide-react'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { GoStudioEditor } from './GoStudioEditor'
import { GoStudioProjectTree } from './GoStudioProjectTree'
import { GoStudioRunPanel } from './GoStudioRunPanel'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import type { GoIDESession } from '@/lib/goide-api'

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
  onRequestCloseDocument: (document: GoIDEEditorDocument) => void
}

function StructurePane() {
  return (
    <aside aria-label="File structure" className="h-full bg-surface-1">
      <div className="flex h-8 items-center gap-1.5 border-b border-border-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-3"><Braces size={11} /> Structure</div>
      <div className="flex items-start gap-2 p-3 text-[10px] leading-4 text-text-4"><Info size={12} className="mt-0.5 shrink-0" /> Symbol structure becomes available with the real gopls integration in Phase 2.</div>
    </aside>
  )
}

export function GoStudioWorkspace({ session, projectWidth, structureWidth, bottomHeight, structureOpen, bottomOpen, onProjectResize, onStructureResize, onBottomResize, onCursor, onRequestCloseDocument }: GoStudioWorkspaceProps) {
  const allDocuments = useGoIDEStore((state) => state.documents)
  const documents = useMemo(() => allDocuments.filter((item) => item.document.sessionId === session.id), [allDocuments, session.id])
  const activeDocumentId = useGoIDEStore((state) => state.activeDocumentBySession[session.id] ?? null)
  const active = documents.find((item) => item.document.id === activeDocumentId) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <div style={{ width: projectWidth }} className="shrink-0"><GoStudioProjectTree session={session} /></div>
        <ResizeHandle label="Resize project pane" onMouseDown={onProjectResize} />
        <GoStudioEditor documents={documents} active={active} onCursor={onCursor} onRequestClose={onRequestCloseDocument} />
        {structureOpen && <><ResizeHandle label="Resize structure pane" onMouseDown={onStructureResize} /><div style={{ width: structureWidth }} className="shrink-0"><StructurePane /></div></>}
      </div>
      {bottomOpen && <><ResizeHandle label="Resize run panel" orientation="horizontal" onMouseDown={onBottomResize} /><div style={{ height: bottomHeight }} className="shrink-0"><GoStudioRunPanel sessionId={session.id} /></div></>}
    </div>
  )
}

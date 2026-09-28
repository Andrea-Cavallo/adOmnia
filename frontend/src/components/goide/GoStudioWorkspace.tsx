import { useMemo } from 'react'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { GoStudioEditor } from './GoStudioEditor'
import { GoStudioSidePane } from './GoStudioSidePane'
import { GoStudioProjectTree } from './GoStudioProjectTree'
import { GoStudioRunPanel } from './GoStudioRunPanel'
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
  onRequestCloseDocument: (document: GoIDEEditorDocument) => void
  onRunTarget: (target: GoStudioRunTarget) => void
}

export function GoStudioWorkspace({ session, projectWidth, structureWidth, bottomHeight, structureOpen, bottomOpen, onProjectResize, onStructureResize, onBottomResize, onCursor, onRequestCloseDocument, onRunTarget }: GoStudioWorkspaceProps) {
  const allDocuments = useGoIDEStore((state) => state.documents)
  const documents = useMemo(() => allDocuments.filter((item) => item.document.sessionId === session.id), [allDocuments, session.id])
  const activeDocumentId = useGoIDEStore((state) => state.activeDocumentBySession[session.id] ?? null)
  const active = documents.find((item) => item.document.id === activeDocumentId) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <div style={{ width: projectWidth }} className="shrink-0"><GoStudioProjectTree session={session} /></div>
        <ResizeHandle label="Resize project pane" onMouseDown={onProjectResize} />
        <GoStudioEditor documents={documents} active={active} onCursor={onCursor} onRequestClose={onRequestCloseDocument} onRunTarget={onRunTarget} />
        {structureOpen && <><ResizeHandle label="Resize structure pane" onMouseDown={onStructureResize} /><div style={{ width: structureWidth }} className="shrink-0"><GoStudioSidePane session={session} document={active} /></div></>}
      </div>
      {bottomOpen && <><ResizeHandle label="Resize run panel" orientation="horizontal" onMouseDown={onBottomResize} /><div style={{ height: bottomHeight }} className="shrink-0"><GoStudioRunPanel sessionId={session.id} /></div></>}
    </div>
  )
}

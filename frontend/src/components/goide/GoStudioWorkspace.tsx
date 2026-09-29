import { useMemo } from 'react'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { GoStudioEditor } from './GoStudioEditor'
import { GoStudioSidePane } from './GoStudioSidePane'
import { GoStudioProjectTree } from './GoStudioProjectTree'
import { GoStudioRunPanel } from './GoStudioRunPanel'
import { GoStudioLeftStripe, GoStudioRightStripe } from './GoStudioToolStripes'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import type { GoIDESession } from '@/lib/goide-api'
import type { GoStudioRunTargetHandler } from './goStudioRunTargets'

interface GoStudioWorkspaceProps {
  session: GoIDESession
  projectWidth: number
  structureWidth: number
  bottomHeight: number
  projectOpen: boolean
  structureOpen: boolean
  bottomOpen: boolean
  onProjectResize: (event: React.MouseEvent<HTMLDivElement>) => void
  onStructureResize: (event: React.MouseEvent<HTMLDivElement>) => void
  onBottomResize: (event: React.MouseEvent<HTMLDivElement>) => void
  onCursor: (line: number, column: number) => void
  onRequestCloseDocument: (documents: GoIDEEditorDocument[]) => void
  onRunTarget: GoStudioRunTargetHandler
  onCommit: () => void
  onBookmarks: () => void
  onDependencies: () => void
}

export function GoStudioWorkspace({ session, projectWidth, structureWidth, bottomHeight, projectOpen, structureOpen, bottomOpen, onProjectResize, onStructureResize, onBottomResize, onCursor, onRequestCloseDocument, onRunTarget, onCommit, onBookmarks, onDependencies }: GoStudioWorkspaceProps) {
  const allDocuments = useGoIDEStore((state) => state.documents)
  const documents = useMemo(() => allDocuments.filter((item) => item.document.sessionId === session.id), [allDocuments, session.id])
  const activeDocumentId = useGoIDEStore((state) => state.activeDocumentBySession[session.id] ?? null)
  const active = documents.find((item) => item.document.id === activeDocumentId) ?? null

  return (
    <div className="flex min-h-0 flex-1">
      <GoStudioLeftStripe sessionId={session.id} onCommit={onCommit} onBookmarks={onBookmarks} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          {projectOpen && <><div style={{ width: projectWidth }} className="shrink-0"><GoStudioProjectTree session={session} activePath={active?.document.external ? null : active?.document.relativePath ?? null} /></div><ResizeHandle label="Resize project pane" onMouseDown={onProjectResize} /></>}
          <GoStudioEditor documents={documents} active={active} onCursor={onCursor} onRequestClose={onRequestCloseDocument} onRunTarget={onRunTarget} />
          {structureOpen && <><ResizeHandle label="Resize structure pane" onMouseDown={onStructureResize} /><div style={{ width: structureWidth }} className="shrink-0"><GoStudioSidePane session={session} document={active} /></div></>}
        </div>
        {bottomOpen && <><ResizeHandle label="Resize tool window" orientation="horizontal" onMouseDown={onBottomResize} /><div style={{ height: bottomHeight }} className="shrink-0"><GoStudioRunPanel session={session} /></div></>}
      </div>
      <GoStudioRightStripe onDependencies={onDependencies} />
    </div>
  )
}

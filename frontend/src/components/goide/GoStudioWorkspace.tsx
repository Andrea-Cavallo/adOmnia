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
import type { GoStudioCommandId } from './goStudioCommands'

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
  onCommand: (id: GoStudioCommandId) => void
  /** Zen Mode: nessuna striscia laterale, resta solo l'editor. */
  zen?: boolean
}

/** A tall tool window never swallows the editor in a small window: at least 140 px of code stay visible. */
const BOTTOM_PANEL_MAX_HEIGHT = 'calc(100% - 140px)'

export function GoStudioWorkspace({ session, projectWidth, structureWidth, bottomHeight, projectOpen, structureOpen, bottomOpen, onProjectResize, onStructureResize, onBottomResize, onCursor, onRequestCloseDocument, onRunTarget, onCommit, onBookmarks, onDependencies, onCommand, zen = false }: GoStudioWorkspaceProps) {
  const allDocuments = useGoIDEStore((state) => state.documents)
  const documents = useMemo(() => allDocuments.filter((item) => item.document.sessionId === session.id), [allDocuments, session.id])
  const activeDocumentId = useGoIDEStore((state) => state.activeDocumentBySession[session.id] ?? null)
  const active = documents.find((item) => item.document.id === activeDocumentId) ?? null

  return (
    <div className="flex min-h-0 flex-1">
      {!zen && <GoStudioLeftStripe sessionId={session.id} onCommit={onCommit} onBookmarks={onBookmarks} />}
      {/* Stile Islands: ogni pannello è un'isola; i separatori ridimensionabili sono lo spazio tra le isole. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-1.5">
        <div className="flex min-h-0 flex-1">
          {projectOpen && <><div style={{ width: projectWidth }} className="go-studio-island shrink-0"><GoStudioProjectTree session={session} activePath={active?.document.external ? null : active?.document.relativePath ?? null} onCommand={onCommand} /></div><ResizeHandle label="Resize project pane" withLine={false} className="go-studio-gap" onMouseDown={onProjectResize} /></>}
          <div className="go-studio-island flex-1"><GoStudioEditor documents={documents} active={active} onCursor={onCursor} onRequestClose={onRequestCloseDocument} onRunTarget={onRunTarget} /></div>
          {structureOpen && <><ResizeHandle label="Resize structure pane" withLine={false} className="go-studio-gap" onMouseDown={onStructureResize} /><div style={{ width: structureWidth }} className="go-studio-island shrink-0"><GoStudioSidePane session={session} document={active} /></div></>}
        </div>
        {bottomOpen && <><ResizeHandle label="Resize tool window" orientation="horizontal" withLine={false} className="go-studio-gap" onMouseDown={onBottomResize} /><div style={{ height: bottomHeight, maxHeight: BOTTOM_PANEL_MAX_HEIGHT }} className="go-studio-island shrink-0"><GoStudioRunPanel session={session} /></div></>}
      </div>
      {!zen && <GoStudioRightStripe onDependencies={onDependencies} />}
    </div>
  )
}

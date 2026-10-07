import { useMemo } from 'react'
import { studioToolLayout } from './studioToolLayout'
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
import { useGoIDELspStore } from '@/stores/goideLsp'
import { useGoStudioAssistantStore } from '@/stores/goStudioAssistant'
import { toolKey, useStudioTools, useToolView, type ToolPlacement } from './studioToolState'

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

export function GoStudioWorkspace({ session, projectWidth, structureWidth, bottomHeight, projectOpen, structureOpen, bottomOpen, onProjectResize, onStructureResize, onBottomResize, onCursor, onRequestCloseDocument, onRunTarget, onCommit, onBookmarks, onDependencies, onCommand, zen = false }: GoStudioWorkspaceProps) {
  const allDocuments = useGoIDEStore((state) => state.documents)
  const documents = useMemo(() => allDocuments.filter((item) => item.document.sessionId === session.id), [allDocuments, session.id])
  const activeDocumentId = useGoIDEStore((state) => state.activeDocumentBySession[session.id] ?? null)
  const active = documents.find((item) => item.document.id === activeDocumentId) ?? null
  const view = useGoIDELspStore((state) => state.toolWindow)
  const assistant = useGoStudioAssistantStore((state) => state.pane)
  const detached = useStudioTools((state) => state.detached)
  const placements = useStudioTools((state) => state.placements)
  const maximized = useStudioTools((state) => state.maximized)
  const error = useStudioTools((state) => state.error)
  const [logsOpen] = useToolView(session.id, 'logs', 'open', false)
  const bottomKey = toolKey(session.id, view === 'terminal' ? 'terminal' : 'run')
  const sideKey = toolKey(session.id, assistant === 'milk' ? 'milk' : 'copilot')
  const logsKey = toolKey(session.id, 'logs')
  const panes = [
    { id: 'project', key: 'project', position: 'left' as ToolPlacement, open: projectOpen, width: projectWidth },
    { id: 'run', key: bottomKey, position: placements[bottomKey] ?? 'bottom', open: bottomOpen, detached: (view === 'run' || view === 'terminal') && detached.includes(bottomKey), width: Math.max(320, structureWidth) },
    { id: 'side', key: sideKey, position: assistant ? placements[sideKey] ?? 'right' : 'right', open: structureOpen, detached: (assistant === 'milk' || assistant === 'copilot') && detached.includes(sideKey), width: structureWidth },
    { id: 'logs', key: logsKey, position: placements[logsKey] ?? 'bottom', open: logsOpen, detached: detached.includes(logsKey), width: Math.max(320, structureWidth) },
  ]
  const { focused, left, centerColumns, gridStyle, styleFor } = studioToolLayout(panes, zen ? null : maximized, bottomHeight)

  return (
    <div className="flex min-h-0 flex-1">
      {!zen && <GoStudioLeftStripe sessionId={session.id} onCommit={onCommit} onBookmarks={onBookmarks} />}
      {/* Stile Islands: ogni pannello è un'isola; i separatori ridimensionabili sono lo spazio tra le isole. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {error && <div role="alert" className="flex items-center gap-2 p-2 text-xs text-danger"><span className="flex-1">{error}</span><button type="button" onClick={() => useStudioTools.setState({ error: null })}>Dismiss</button></div>}
        <div className="grid min-h-0 min-w-0 flex-1 gap-1.5 pb-1.5" style={gridStyle}>
          <div className="go-studio-island relative" style={styleFor('project')}>
            <GoStudioProjectTree session={session} activePath={active?.document.external ? null : active?.document.relativePath ?? null} onCommand={onCommand} />
            {!focused && <div className="absolute inset-y-0 right-0"><ResizeHandle label="Resize project pane" className="h-full" withLine={false} onMouseDown={onProjectResize} /></div>}
          </div>
          <div className="go-studio-island" style={focused ? { display: 'none' } : { gridColumn: `${left.length + 1} / span ${centerColumns}`, gridRow: 1 }}><GoStudioEditor documents={documents} active={active} onCursor={onCursor} onRequestClose={onRequestCloseDocument} onRunTarget={onRunTarget} /></div>
          <div className="go-studio-island relative" style={styleFor('side')}>
            <GoStudioSidePane session={session} document={active} />
            {!focused && (placements[sideKey] ?? 'right') !== 'bottom' && <div className="absolute inset-y-0 left-0"><ResizeHandle label="Resize structure pane" className="h-full" withLine={false} onMouseDown={onStructureResize} /></div>}
          </div>
          <div className="go-studio-island relative" style={styleFor('run')}>
            <GoStudioRunPanel session={session} visible={bottomOpen} />
            {!focused && (placements[bottomKey] ?? 'bottom') === 'bottom' && <div className="absolute inset-x-0 top-0"><ResizeHandle label="Resize tool window" orientation="horizontal" withLine={false} onMouseDown={onBottomResize} /></div>}
          </div>
          <div className="go-studio-island relative" style={styleFor('logs')}>
            <GoStudioRunPanel session={session} fixedView="run" logsOnly visible={logsOpen} />
          </div>
        </div>
      </div>
      {!zen && <GoStudioRightStripe onDependencies={onDependencies} />}
    </div>
  )
}

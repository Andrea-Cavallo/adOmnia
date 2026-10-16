import { GoStudioModal } from './GoStudioModal'
import { GoStudioFindInFiles } from './GoStudioFindInFiles'
import { useMemo } from 'react'
import { studioToolLayout } from './studioToolLayout'
import { ResizeHandle, type ResizeHandleInteraction } from '@/components/ui/ResizeHandle'
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
import { isChatPane, useGoStudioAssistantStore } from '@/stores/goStudioAssistant'
import { toolKey, useStudioTools, useToolView, type ToolPlacement } from './studioToolState'

interface GoStudioWorkspaceProps {
  session: GoIDESession
  projectWidth: number
  structureWidth: number
  bottomHeight: number
  projectOpen: boolean
  structureOpen: boolean
  bottomOpen: boolean
  onProjectResize: ResizeHandleInteraction
  onStructureResize: ResizeHandleInteraction
  onBottomResize: ResizeHandleInteraction
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
  // La chiave della tool window segue il provider AI corrente (o l'ultimo usato):
  // il bottone unico dell'hub non deve perdere posizione e finestra staccata.
  const lastProvider = useGoStudioAssistantStore((state) => state.lastProvider)
  const detached = useStudioTools((state) => state.detached)
  const placements = useStudioTools((state) => state.placements)
  const maximized = useStudioTools((state) => state.maximized)
  const error = useStudioTools((state) => state.error)
  const [logsOpen] = useToolView(session.id, 'logs', 'open', false)
  const bottomKey = toolKey(session.id, view === 'terminal' ? 'terminal' : 'run')
  const sideKey = toolKey(session.id, isChatPane(assistant) ? assistant : lastProvider)
  const logsKey = toolKey(session.id, 'logs')
  const panes = [
    { id: 'project', key: 'project', position: 'left' as ToolPlacement, open: projectOpen, width: projectWidth },
    { id: 'run', key: bottomKey, position: placements[bottomKey] ?? 'bottom', open: bottomOpen && view !== 'find', detached: (view === 'run' || view === 'terminal') && detached.includes(bottomKey), width: Math.max(320, structureWidth) },
    { id: 'side', key: sideKey, position: assistant ? placements[sideKey] ?? 'right' : 'right', open: structureOpen, detached: isChatPane(assistant) && detached.includes(sideKey), width: structureWidth },
    { id: 'logs', key: logsKey, position: placements[logsKey] ?? 'bottom', open: logsOpen, detached: detached.includes(logsKey), width: Math.max(320, structureWidth) },
  ]
  const { focused, left, centerColumns, gridStyle, styleFor } = studioToolLayout(panes, zen ? null : maximized, bottomHeight)

  return (
    <div className="flex min-h-0 flex-1">
      <GoStudioModal open={bottomOpen && view === 'find'} onClose={() => useGoIDEStore.getState().updateLayout({ bottomOpen: false })} title="Search project" size="xl" tall top flush>
        <GoStudioFindInFiles sessionId={session.id} />
      </GoStudioModal>
      {!zen && <GoStudioLeftStripe session={session} onCommit={onCommit} onBookmarks={onBookmarks} />}
      {/* Stile Islands: ogni pannello è un'isola; i separatori ridimensionabili sono lo spazio tra le isole. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {error && <div role="alert" className="mb-1.5 flex shrink-0 items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger"><span className="flex-1 whitespace-pre-wrap">{error}</span><button type="button" onClick={() => useStudioTools.setState({ error: null })} className="rounded px-1.5 hover:bg-danger/15">Dismiss</button></div>}
        <div className="grid min-h-0 min-w-0 flex-1 gap-1.5 pb-1.5" style={gridStyle}>
          {/* Ogni cella della griglia contiene l'isola (assoluta, così resta ritagliata
              sui suoi angoli) e lo splitter come fratello: l'area di presa può
              sconfinare nel gap senza essere tagliata da overflow: hidden. */}
          <div className="relative" style={styleFor('project')}>
            <div className="go-studio-island absolute inset-0">
              <GoStudioProjectTree session={session} activePath={active?.document.external ? null : active?.document.relativePath ?? null} onCommand={onCommand} />
            </div>
            {!focused && <ResizeHandle variant="splitter" label="Resize project pane" className="absolute inset-y-0 -right-2" {...onProjectResize} />}
          </div>
          <div className="relative" style={focused ? { display: 'none' } : { gridColumn: `${left.length + 1} / span ${centerColumns}`, gridRow: 1 }}>
            <div className="go-studio-island absolute inset-0"><GoStudioEditor documents={documents} active={active} onCursor={onCursor} onRequestClose={onRequestCloseDocument} onRunTarget={onRunTarget} /></div>
          </div>
          <div className="relative" style={styleFor('side')}>
            <div className="go-studio-island absolute inset-0">
              <GoStudioSidePane session={session} document={active} />
            </div>
            {!focused && (placements[sideKey] ?? 'right') !== 'bottom' && <ResizeHandle variant="splitter" label="Resize structure pane" className="absolute inset-y-0 -left-2" {...onStructureResize} />}
          </div>
          <div className="relative" style={styleFor('run')}>
            <div className="go-studio-island absolute inset-0">
              {view !== 'find' && <GoStudioRunPanel session={session} visible={bottomOpen} onCommand={onCommand} />}
            </div>
            {!focused && (placements[bottomKey] ?? 'bottom') === 'bottom' && <ResizeHandle variant="splitter" orientation="horizontal" label="Resize tool window" className="absolute inset-x-0 -top-2" {...onBottomResize} />}
          </div>
          <div className="relative" style={styleFor('logs')}>
            <div className="go-studio-island absolute inset-0">
              <GoStudioRunPanel session={session} fixedView="run" logsOnly visible={logsOpen} />
            </div>
          </div>
        </div>
      </div>
      {!zen && <GoStudioRightStripe onDependencies={onDependencies} />}
    </div>
  )
}

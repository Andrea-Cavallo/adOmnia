import { CodeStudioModal } from './CodeStudioModal'
import { CodeStudioFindInFiles } from './CodeStudioFindInFiles'
import { useMemo } from 'react'
import { studioToolLayout } from './studioToolLayout'
import { ResizeHandle, type ResizeHandleInteraction } from '@/components/ui/ResizeHandle'
import { CodeStudioEditor } from './CodeStudioEditor'
import { CodeStudioSidePane } from './CodeStudioSidePane'
import { CodeStudioProjectTree } from './CodeStudioProjectTree'
import { CodeStudioRunPanel } from './CodeStudioRunPanel'
import { CodeStudioDebugPanel } from './CodeStudioDebugPanel'
import { CodeStudioLeftStripe, CodeStudioRightStripe } from './CodeStudioToolStripes'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { CodeStudioRunTargetHandler } from './codeStudioRunTargets'
import type { CodeStudioCommandId } from './codeStudioCommands'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { activeDebugView, useCodeStudioDebugStore } from '@/stores/codeStudioDebug'
import { isChatPane, useCodeStudioAssistantStore } from '@/stores/codeStudioAssistant'
import { toolKey, useStudioTools, type ToolPlacement } from './studioToolState'

interface CodeStudioWorkspaceProps {
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
  onRunTarget: CodeStudioRunTargetHandler
  onCommit: () => void
  onBookmarks: () => void
  onDependencies: () => void
  onCommand: (id: CodeStudioCommandId) => void
  /** Zen Mode: nessuna striscia laterale, resta solo l'editor. */
  zen?: boolean
}

export function CodeStudioWorkspace({ session, projectWidth, structureWidth, bottomHeight, projectOpen, structureOpen, bottomOpen, onProjectResize, onStructureResize, onBottomResize, onCursor, onRequestCloseDocument, onRunTarget, onCommit, onBookmarks, onDependencies, onCommand, zen = false }: CodeStudioWorkspaceProps) {
  const allDocuments = useCodeStudioStore((state) => state.documents)
  const documents = useMemo(() => allDocuments.filter((item) => item.document.sessionId === session.id), [allDocuments, session.id])
  const activeDocumentId = useCodeStudioStore((state) => state.activeDocumentBySession[session.id] ?? null)
  const active = documents.find((item) => item.document.id === activeDocumentId) ?? null
  const view = useCodeStudioLspStore((state) => state.toolWindow)
  // Il debug prende il posto dell'area centrale solo con una sessione viva: senza, resta il layout normale.
  const hasDebugSession = useCodeStudioDebugStore((state) => activeDebugView(state, session.id) !== null)
  const debugging = !zen && bottomOpen && view === 'debug' && hasDebugSession
  const assistant = useCodeStudioAssistantStore((state) => state.pane)
  // La chiave della tool window segue il provider AI corrente (o l'ultimo usato):
  // il bottone unico dell'hub non deve perdere posizione e finestra staccata.
  const lastProvider = useCodeStudioAssistantStore((state) => state.lastProvider)
  const detached = useStudioTools((state) => state.detached)
  const placements = useStudioTools((state) => state.placements)
  const maximized = useStudioTools((state) => state.maximized)
  const error = useStudioTools((state) => state.error)
  const bottomKey = toolKey(session.id, view === 'terminal' ? 'terminal' : 'run')
  const sideKey = toolKey(session.id, isChatPane(assistant) ? assistant : lastProvider)
  const panes = [
    { id: 'project', key: 'project', position: 'left' as ToolPlacement, open: projectOpen && !debugging, width: projectWidth },
    { id: 'run', key: bottomKey, position: placements[bottomKey] ?? 'bottom', open: bottomOpen && view !== 'find', detached: (view === 'run' || view === 'terminal') && detached.includes(bottomKey), width: Math.max(320, structureWidth) },
    { id: 'side', key: sideKey, position: assistant ? placements[sideKey] ?? 'right' : 'right', open: structureOpen, detached: isChatPane(assistant) && detached.includes(sideKey), width: structureWidth },
  ]
  const debugPanes = debugging ? panes.map(pane => ({ ...pane, open: false })) : panes
  const { focused, left, centerColumns, gridStyle, styleFor } = studioToolLayout(debugPanes, zen || debugging ? null : maximized, bottomHeight)
  const editor = <CodeStudioEditor documents={documents} active={active} onCursor={onCursor} onRequestClose={onRequestCloseDocument} onRunTarget={onRunTarget} />

  return (
    <div className="flex min-h-0 flex-1">
      <CodeStudioModal open={bottomOpen && view === 'find'} onClose={() => useCodeStudioStore.getState().updateLayout({ bottomOpen: false })} title="Search project" size="xl" tall top flush>
        <CodeStudioFindInFiles sessionId={session.id} />
      </CodeStudioModal>
      {!zen && <CodeStudioLeftStripe session={session} onCommit={onCommit} onBookmarks={onBookmarks} />}
      {/* Stile Islands: ogni pannello è un'isola; i separatori ridimensionabili sono lo spazio tra le isole. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {error && <div role="alert" className="mb-1.5 flex shrink-0 items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger"><span className="flex-1 whitespace-pre-wrap">{error}</span><button type="button" onClick={() => useStudioTools.setState({ error: null })} className="rounded px-1.5 hover:bg-danger/15">Dismiss</button></div>}
        <div className="grid min-h-0 min-w-0 flex-1 gap-1.5 pb-1.5" style={gridStyle}>
          {/* Ogni cella della griglia contiene l'isola (assoluta, così resta ritagliata
              sui suoi angoli) e lo splitter come fratello: l'area di presa può
              sconfinare nel gap senza essere tagliata da overflow: hidden. */}
          <div className="relative" style={styleFor('project')}>
            <div className="code-studio-island absolute inset-0">
              <CodeStudioProjectTree session={session} activePath={active?.document.external ? null : active?.document.relativePath ?? null} onCommand={onCommand} />
            </div>
            {!focused && <ResizeHandle variant="splitter" label="Resize project pane" className="absolute inset-y-0 -right-2" {...onProjectResize} />}
          </div>
          <div className="relative" style={focused ? { display: 'none' } : { gridColumn: `${left.length + 1} / span ${centerColumns}`, gridRow: 1 }}>
            <div className="code-studio-island absolute inset-0">{debugging ? <CodeStudioDebugPanel session={session} editor={editor} /> : editor}</div>
          </div>
          <div className="relative" style={styleFor('side')}>
            <div className="code-studio-island absolute inset-0">
              <CodeStudioSidePane session={session} document={active} />
            </div>
            {!focused && (placements[sideKey] ?? 'right') !== 'bottom' && <ResizeHandle variant="splitter" label="Resize structure pane" className="absolute inset-y-0 -left-2" {...onStructureResize} />}
          </div>
          <div className="relative" style={styleFor('run')}>
            <div className="code-studio-island absolute inset-0">
              {view !== 'find' && !debugging && <CodeStudioRunPanel session={session} visible={bottomOpen} onCommand={onCommand} />}
            </div>
            {!focused && (placements[bottomKey] ?? 'bottom') === 'bottom' && <ResizeHandle variant="splitter" orientation="horizontal" label="Resize tool window" className="absolute inset-x-0 -top-2" {...onBottomResize} />}
          </div>
        </div>
      </div>
      {!zen && <CodeStudioRightStripe onDependencies={onDependencies} />}
    </div>
  )
}

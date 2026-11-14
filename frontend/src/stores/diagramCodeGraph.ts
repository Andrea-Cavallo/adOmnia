/**
 * The live workspace behind a generated diagram: one analysis per Code Studio session, the selected
 * view and the actions that walk it (callers, callees, reveal, open source). The graph itself never
 * becomes a second source of truth: it is read once from the Go normalizer and then queried.
 */
import { create } from 'zustand'
import type { WorkspaceAnalysis, WorkspaceEntity } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/diagrams/models'
import { generateWorkspaceDiagram, relatedEntities, resolveEntity, entityAt } from '@/lib/diagrams/workspace'
import type { DiagramCodeRef, DiagramViewKind } from '@/lib/diagrams/model'
import { useDiagramStudio } from '@/stores/diagramStudio'
import { useDiagramUi } from '@/stores/diagramStudioUi'
import { useAppStore } from '@/stores/app'
import { enterDiagramSplit } from '@/lib/workspaceLayout'

type Status = 'idle' | 'analyzing' | 'ready' | 'error'
type Direction = 'callers' | 'callees' | 'both'

interface DiagramCodeState {
  analysis: WorkspaceAnalysis | null
  status: Status
  error: string
  sessionId: string | null
  workspaceId?: string
  projectName?: string
  view: DiagramViewKind
  focusId?: string
  notes: string[]
  /** Bumped on every new analysis: a slower answer for an older request is discarded. */
  request: number

  /** Analyses the active Code Studio project and opens (or refreshes) its diagram. */
  generate: (options?: { view?: DiagramViewKind; focusId?: string; refresh?: boolean; mode?: 'new' | 'refresh' }) => Promise<void>
  /** Reads the active project name so the toolbar can say what Generate will analyse. */
  detectProject: () => Promise<void>
  /** Re-reads the sources and merges the result into the open diagram. */
  refresh: () => Promise<void>
  /** Loads the analysis for the diagram's origin without changing the document (context actions). */
  ensureAnalysis: () => Promise<WorkspaceAnalysis | null>
  /** Loads another session's analysis without switching the active Code Studio project. */
  ensureAnalysisFor: (sessionId: string, workspaceId?: string) => Promise<WorkspaceAnalysis | null>
  setView: (view: DiagramViewKind, focusId?: string) => Promise<void>
  /** Adds the callers/callees of the selected node. Returns how many nodes were added. */
  expand: (direction: Direction) => number
  /** Code Studio â†’ Diagram Studio: highlights the entity a source location belongs to. */
  reveal: (ref: Pick<DiagramCodeRef, 'sessionId' | 'workspaceId' | 'entityId' | 'kind' | 'file' | 'line' | 'symbol'>) => Promise<'shown' | 'missing' | 'error'>
  /** Code Studio â†’ Diagram Studio from the editor caret: find the entity by file and line. */
  revealLocation: (sessionId: string, workspaceId: string | undefined, file: string, line: number) => Promise<'shown' | 'missing' | 'error'>
  /** Hides nothing: opens Diagram Studio and focuses the node of a source location. */
  revealEntityInDocument: (entity: WorkspaceEntity) => string | null
  /** Diagram Studio â†’ Code Studio, in the shared split. */
  openSource: (nodeId: string) => Promise<void>
  reset: () => void
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function activeProject(): Promise<{ sessionId: string; workspaceId?: string; projectName?: string } | null> {
  const { useCodeStudioStore } = await import('@/stores/codeStudio')
  const state = useCodeStudioStore.getState()
  if (!state.initialized) await state.initialize()
  const session = useCodeStudioStore.getState().sessions.find((candidate) => candidate.id === useCodeStudioStore.getState().activeSessionId)
  if (!session) return null
  return { sessionId: session.id, workspaceId: session.workspaceId || undefined, projectName: session.project.name }
}

async function analyze(sessionId: string, refresh: boolean): Promise<WorkspaceAnalysis> {
  const { getDiagramWorkspace } = await import('@/lib/code-studio-api')
  return getDiagramWorkspace(sessionId, refresh)
}

/** Loads the analysis of one session even when another project is active in the IDE. */
async function loadAnalysisFor(sessionId: string, workspaceId?: string): Promise<WorkspaceAnalysis | null> {
  const state = useDiagramCodeGraph.getState()
  if (state.analysis && state.sessionId === sessionId) return state.analysis
  const request = state.request + 1
  useDiagramCodeGraph.setState({ status: 'analyzing', request, sessionId, workspaceId })
  try {
    const analysis = await analyze(sessionId, false)
    if (useDiagramCodeGraph.getState().request !== request) return null
    useDiagramCodeGraph.setState({ analysis, status: 'ready' })
    return analysis
  } catch (error) {
    useDiagramCodeGraph.setState({ status: 'error', error: message(error) })
    return null
  }
}


export const useDiagramCodeGraph = create<DiagramCodeState>((set, get) => ({
  analysis: null,
  status: 'idle',
  error: '',
  sessionId: null,
  view: 'architecture',
  notes: [],
  request: 0,

  async generate(options = {}) {
    let project: Awaited<ReturnType<typeof activeProject>>
    try {
      project = await activeProject()
    } catch (error) {
      set({ status: 'error', error: message(error) })
      return
    }
    if (!project) { set({ status: 'error', error: 'Open a project in Code Studio first.' }); return }
    const view = options.view ?? get().view
    const focusId = options.focusId ?? (view === 'architecture' || view === 'osgi' ? undefined : get().focusId)
    const request = get().request + 1
    set({ status: 'analyzing', error: '', request, sessionId: project.sessionId, workspaceId: project.workspaceId, projectName: project.projectName, view, focusId })
    try {
      const analysis = await analyze(project.sessionId, !!options.refresh)
      if (get().request !== request) return // a newer scan started
      set({ analysis, status: 'ready' })
      const generated = generateWorkspaceDiagram(analysis, {
        sessionId: project.sessionId, workspaceId: project.workspaceId, projectName: project.projectName, view, focusId,
      })
      set({ notes: generated.notes })
      const existingOrigin = useDiagramStudio.getState().doc?.origin
      const mode = options.mode ?? (existingOrigin?.sessionId === project.sessionId ? 'refresh' : 'new')
      await useDiagramStudio.getState().showWorkspaceDiagram(generated, mode, project.projectName)
    } catch (error) {
      set({ status: 'error', error: message(error) })
    }
  },

  async refresh() {
    await get().generate({ refresh: true, mode: 'refresh' })
  },

  async detectProject() {
    if (get().analysis) return
    try {
      const project = await activeProject()
      if (project) set({ sessionId: project.sessionId, workspaceId: project.workspaceId, projectName: project.projectName })
    } catch {
      // The tooltip stays generic; Generate reports the real error.
    }
  },

  async ensureAnalysis() {
    const { analysis, sessionId } = get()
    if (analysis && sessionId) return analysis
    const origin = useDiagramStudio.getState().doc?.origin
    const target = origin?.sessionId ? { sessionId: origin.sessionId, workspaceId: origin.workspaceId, projectName: origin.projectName } : await activeProject()
    if (!target) return null
    const request = get().request + 1
    set({ status: 'analyzing', error: '', request, sessionId: target.sessionId, workspaceId: target.workspaceId, projectName: target.projectName, view: origin?.view ?? get().view })
    try {
      const result = await analyze(target.sessionId, false)
      if (get().request !== request) return null
      set({ analysis: result, status: 'ready' })
      return result
    } catch (error) {
      set({ status: 'error', error: message(error) })
      return null
    }
  },

  async ensureAnalysisFor(sessionId, workspaceId) {
    return loadAnalysisFor(sessionId, workspaceId)
  },

  async setView(view, focusId) {
    set({ view, focusId })
    await get().generate({ view, focusId, mode: 'refresh' })
  },

  expand(direction) {
    const { analysis, sessionId, workspaceId } = get()
    const doc = useDiagramStudio.getState().doc
    if (!analysis || !sessionId || !doc) return 0
    const selected = doc.nodes.find((node) => node.selected)?.data.source
    if (!selected) return 0
    const { entities, links } = relatedEntities(analysis, selected.entityId, direction)
    const added = useDiagramStudio.getState().addRelated(entities, links, { sessionId, workspaceId, fingerprint: analysis.fingerprint })
    if (added === 0) {
      set({ notes: [...get().notes, direction === 'callers' ? 'No caller left to add.' : direction === 'callees' ? 'No callee left to add.' : 'No related entity left to add.'] })
    }
    return added
  },

  async reveal(ref) {
    const loaded = await get().ensureAnalysisFor(ref.sessionId, ref.workspaceId)
    if (!loaded) return 'error'
    await ensureDocumentFor(loaded, ref.sessionId, ref.workspaceId, get().projectName)
    const entity = resolveEntity(loaded, ref)
    if (!entity) return 'missing'
    return get().revealEntityInDocument(entity) ? 'shown' : 'missing'
  },

  async revealLocation(sessionId, workspaceId, file, line) {
    const loaded = await get().ensureAnalysisFor(sessionId, workspaceId)
    if (!loaded) return 'error'
    await ensureDocumentFor(loaded, sessionId, workspaceId, get().projectName)
    const entity = entityAt(loaded, file, line)
    if (!entity) return 'missing'
    return get().revealEntityInDocument(entity) ? 'shown' : 'missing'
  },

  revealEntityInDocument(entity) {
    const state = get()
    const sessionId = state.sessionId
    if (!sessionId) return null
    const doc = useDiagramStudio.getState().doc
    const options = { sessionId, workspaceId: state.workspaceId, fingerprint: state.analysis?.fingerprint }
    // Without a diagram of this workspace, generate the architectural view first.
    if (!doc || doc.origin?.sessionId !== sessionId) return null
    const app = useAppStore.getState()
    if (app.splitView) enterDiagramSplit('diagrams')
    else if (app.activeRail !== 'diagrams') app.setActiveRail('diagrams')
    const nodeId = useDiagramStudio.getState().revealEntity(entity, options)
    if (nodeId) useDiagramUi.getState().focusNode(nodeId)
    return nodeId
  },

  async openSource(nodeId) {
    const ref = useDiagramStudio.getState().nodeSource(nodeId)
    if (!ref?.file) {
      useDiagramStudio.setState({ notice: 'This entity has no source file in the analysed workspace.' })
      return
    }
    enterDiagramSplit('diagrams')
    const { routeToModule } = await import('@/lib/moduleRouting')
    routeToModule('codestudio', { kind: 'open-location', file: ref.file, line: ref.line ?? 1, sessionId: ref.sessionId })
  },

  reset() {
    set({ analysis: null, status: 'idle', error: '', sessionId: null, focusId: undefined, notes: [] })
  },
}))

/** Loads a session's analysis for callers outside the panel (reverse navigation). */
export function loadWorkspaceAnalysis(sessionId: string, workspaceId?: string): Promise<WorkspaceAnalysis | null> {
  return loadAnalysisFor(sessionId, workspaceId)
}

/** Reverse navigation needs a diagram of the same workspace; the architectural view is the default. */
async function ensureDocumentFor(analysis: WorkspaceAnalysis, sessionId: string, workspaceId: string | undefined, projectName: string | undefined): Promise<void> {
  const doc = useDiagramStudio.getState().doc
  if (doc?.origin?.sessionId === sessionId) return
  const generated = generateWorkspaceDiagram(analysis, { sessionId, workspaceId, projectName, view: 'architecture' })
  await useDiagramStudio.getState().showWorkspaceDiagram(generated, 'new', projectName)
  useDiagramCodeGraph.setState({ analysis, sessionId, workspaceId, projectName, view: 'architecture', status: 'ready' })
}

export function useDiagramCodeStatus(): Status {
  return useDiagramCodeGraph((state) => state.status)
}

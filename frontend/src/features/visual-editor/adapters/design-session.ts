import { makeAutoObservable, reaction, runInAction } from 'mobx'
import { EditorMode, type Action, type DomElement, type Frame } from '@onlook/models'
import { getAstFromCodeblock, t } from '@onlook/parser'
import { EditorEngine } from '@ve-client/components/store/editor/engine'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { WorkspaceCodeEditor, type Checkpoint, type IdPlan, type WorkspaceIO } from './file-system'
import { noAnalytics } from './host'
import { notices } from './notices'
import { connectPreview, type PreviewBridge } from './preview-bridge'
import { createWorkspaceIO } from './workspace-io'

export type DesignStatus = 'idle' | 'scanning' | 'needs-ids' | 'writing-ids' | 'ready' | 'failed'

/** What can be edited on the selected element, and why not when it cannot. */
export interface ElementSupport {
  /** Project-relative file and 1-based position of the element, when it maps to source. */
  source: { path: string; line: number; column: number; component: string | null } | null
  style: boolean
  text: boolean
  structure: boolean
  reason: string | null
}

const UNMAPPED: ElementSupport = {
  source: null, style: false, text: false, structure: false,
  reason: 'This element has no source mapping: it is rendered by a library or created at runtime, so it cannot be edited here.',
}

/**
 * ProjectSessionAdapter: the Visual Editor state of one Code Studio session. One engine, one
 * element index and at most one page connection per session; nothing is shared across sessions
 * and everything is released by dispose().
 */
export class DesignSession {
  readonly engine: EditorEngine
  readonly editor: WorkspaceCodeEditor
  readonly frame: Frame
  status: DesignStatus = 'idle'
  plan: IdPlan | null = null
  error: string | null = null
  connected = false
  /** Save every visual edit at once (hot reload). Off: edits stay unsaved editor changes to review. */
  autoSave = true
  /** Reveal the source of the selected element in the editor. */
  followInEditor = false
  /** Let clicks and typing reach the page instead of selecting elements. */
  interact = false
  support: ElementSupport | null = null

  private bridge: PreviewBridge | null = null
  // HistoryAdapter: the file writes of each undoable action, in the order of the engine history.
  private undoGroups: Checkpoint[][] = []
  private redoGroups: Checkpoint[][] = []
  private replaying = false
  private readonly disposers: Array<() => void> = []

  constructor(readonly sessionId: string, root: string, io?: WorkspaceIO) {
    this.editor = new WorkspaceCodeEditor(sessionId, io ?? createWorkspaceIO({ sessionId, root, autoSave: () => this.autoSave }))
    this.engine = new EditorEngine(sessionId, noAnalytics, this.editor)
    this.frame = { id: `preview:${sessionId}`, branchId: sessionId, canvasId: sessionId, position: { x: 0, y: 0 }, dimension: { width: 0, height: 0 }, url: '' }
    makeAutoObservable<this, 'bridge' | 'disposers' | 'undoGroups' | 'redoGroups' | 'replaying'>(this, { engine: false, editor: false, frame: false, bridge: false, disposers: false, undoGroups: false, redoGroups: false, replaying: false })
    void this.engine.init()

    // EditorNavigationAdapter: the engine asks to show a code block, Monaco opens it.
    this.disposers.push(reaction(() => this.engine.ide.codeNavigationOverride, (target) => {
      if (!target) return
      this.engine.ide.clearCodeNavigationOverride()
      this.engine.state.editorMode = EditorMode.DESIGN
      void useCodeStudioStore.getState().openLocation(target.filePath, target.range.start.line, target.range.start.column + 1)
    }))
    // A new entry in the engine history opens a new group of checkpoints for its writes.
    this.disposers.push(reaction(() => this.engine.history.length, (length, previous) => {
      if (this.replaying || length <= previous) return
      const group: Checkpoint[] = []
      this.undoGroups.push(group)
      this.redoGroups = []
      this.editor.recorder = (checkpoint) => group.push(checkpoint)
    }))
    this.disposers.push(reaction(() => this.engine.elements.selected[0], (selected) => { void this.inspect(selected) }))
  }

  /** Indexes the sources. Ends in 'ready', or in 'needs-ids' when files must be annotated first. */
  async prepare(): Promise<void> {
    if (this.status === 'scanning' || this.status === 'writing-ids') return
    this.status = 'scanning'
    this.error = null
    this.engine.clearUI()
    try {
      const plan = await this.editor.scan()
      runInAction(() => {
        this.plan = plan
        this.status = plan.pending.length > 0 ? 'needs-ids' : 'ready'
      })
    } catch (error) {
      this.fail(error)
    }
  }

  /** Writes the element ids into the pending files (after the user confirmed). */
  async addIds(): Promise<void> {
    if (!this.plan || this.status !== 'needs-ids') return
    this.status = 'writing-ids'
    try {
      const failed = await this.editor.addIds(this.plan.pending)
      if (failed.length > 0) notices.error(`${failed.length} file(s) could not be annotated`, failed.slice(0, 5).join(', '))
      runInAction(() => {
        this.plan = this.plan ? { ...this.plan, pending: failed } : null
        this.status = 'ready'
      })
      await this.engine.refreshLayers()
    } catch (error) {
      this.fail(error)
    }
  }

  /** Removes the element ids from the project sources and leaves Design Mode idle. */
  async removeIds(): Promise<string[]> {
    const failed = await this.editor.removeIds()
    runInAction(() => {
      this.status = 'idle'
      this.plan = null
    })
    this.engine.clearUI()
    return failed
  }

  /** Connects the engine to the page currently shown in the preview iframe. */
  attach(iframe: HTMLIFrameElement, origin: string, reload: () => void) {
    this.detach()
    this.frame.url = iframe.src
    const bridge = connectPreview(this.engine, iframe, this.frame, origin, reload)
    this.bridge = bridge
    bridge.ready.then(
      () => runInAction(() => { if (this.bridge === bridge) this.connected = true }),
      () => runInAction(() => { if (this.bridge === bridge) this.connected = false }),
    )
  }

  detach() {
    this.bridge?.close()
    this.bridge = null
    this.connected = false
    this.engine.clearUI()
  }

  /**
   * Undo of the last visual edit. The engine history decides which action is undone; the files
   * go back to the exact text they had before it. Only when a file was edited since does the
   * engine write its inverse action instead (same result on the page, not byte-identical source).
   */
  async undo() {
    await this.replay('before', () => this.engine.history.undo(), this.undoGroups, this.redoGroups)
  }

  async redo() {
    await this.replay('after', () => this.engine.history.redo(), this.redoGroups, this.undoGroups)
  }

  private async replay(side: 'before' | 'after', step: () => Action | null, from: Checkpoint[][], to: Checkpoint[][]) {
    if (this.replaying) return
    this.replaying = true
    this.editor.recorder = null
    try {
      const action = step()
      if (!action) return
      const group = from.pop() ?? []
      to.push(group)
      if (!await this.editor.restore(group, side)) await this.engine.code.write(action)
    } finally {
      this.replaying = false
    }
    await this.engine.overlay.refresh()
  }

  openSource(oid: string | null | undefined) {
    if (oid) void this.engine.ide.openCodeBlock(oid)
  }

  dispose() {
    this.detach()
    for (const dispose of this.disposers.splice(0)) dispose()
    this.engine.clear()
    this.editor.dispose()
    notices.clear()
  }

  private fail(error: unknown) {
    runInAction(() => {
      this.status = 'failed'
      this.error = error instanceof Error ? error.message : String(error)
    })
  }

  /** Decides what the selected element supports, from its source, before any edit is offered. */
  private async inspect(selected: DomElement | undefined) {
    if (!selected) {
      runInAction(() => { this.support = null })
      return
    }
    const oid = selected.instanceId ?? selected.oid
    const metadata = oid ? await this.editor.getJsxElementMetadata(oid) : undefined
    const support = metadata ? supportOf(metadata.code, {
      path: metadata.path, line: metadata.startTag.start.line, column: metadata.startTag.start.column + 1, component: metadata.component,
    }, metadata.dynamicType, metadata.coreElementType) : UNMAPPED
    runInAction(() => { if (this.engine.elements.selected[0]?.domId === selected.domId) this.support = support })
    if (metadata && this.followInEditor) this.openSource(oid)
  }
}

/** Reads the element's own source to tell which edits can be written back faithfully. */
export function supportOf(code: string, source: NonNullable<ElementSupport['source']>, dynamicType: string | null, coreType: string | null): ElementSupport {
  const element = getAstFromCodeblock(code)
  if (!element) return { source, style: false, text: false, structure: false, reason: 'The source of this element could not be parsed.' }

  const className = element.openingElement.attributes.find((attribute) => t.isJSXAttribute(attribute) && attribute.name.name === 'className')
  const value = className && t.isJSXAttribute(className) ? className.value : null
  // Written back as: a string literal, or one more argument to a call such as cn(...)/clsx(...).
  const style = !value || t.isStringLiteral(value)
    || (t.isJSXExpressionContainer(value) && (t.isStringLiteral(value.expression) || t.isCallExpression(value.expression)))

  const children = element.children.filter((child) => !(t.isJSXText(child) && child.value.trim() === ''))
  const text = children.every((child) => t.isJSXText(child) || (t.isJSXElement(child) && t.isJSXIdentifier(child.openingElement.name) && child.openingElement.name.name === 'br'))

  const structure = !dynamicType && !coreType
  const reasons: string[] = []
  if (!style) reasons.push('its className is computed in code, so style changes cannot be written back')
  if (!text) reasons.push('its content comes from other elements or expressions, so the text is edited in code')
  if (dynamicType) reasons.push(`it is rendered by a ${dynamicType === 'array' ? 'list' : 'condition'}, so it cannot be moved or deleted here`)
  if (coreType) reasons.push('it is the root of its component, so it cannot be moved or deleted here')
  return { source, style, text, structure, reason: reasons.length > 0 ? `This element is partly read-only: ${reasons.join('; ')}.` : null }
}

const sessions = new Map<string, DesignSession>()

/** The design session of a Code Studio session, created on first use. */
export function designSession(sessionId: string, root: string): DesignSession {
  let session = sessions.get(sessionId)
  if (!session) {
    session = new DesignSession(sessionId, root)
    sessions.set(sessionId, session)
  }
  return session
}

export function existingDesignSession(sessionId: string): DesignSession | undefined {
  return sessions.get(sessionId)
}

export function disposeDesignSession(sessionId: string) {
  sessions.get(sessionId)?.dispose()
  sessions.delete(sessionId)
}

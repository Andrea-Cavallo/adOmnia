import { create } from 'zustand'
import { monaco } from '@/lib/monacoSetup'
import * as AIEngine from '../../../bindings/adomnia/aiengine'
import { getGoIDEAIPolicy, isLocalAIProvider, listGoIDEAIExcludedPaths } from '@/lib/goide-api'
import { createAIRedactor } from '@/lib/aiRedaction'
import { ensureAIConfigured } from '@/lib/aiEngine'
import { isAICompanionAvailable } from '@/lib/aiAvailability'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { useSettingsStore } from '@/stores/settings'
import { documentForModel } from './goStudioLanguageFeatures'
import { enclosingTopLevelBlock } from './goStudioAIActions'
import {
  INLINE_ASSISTANT_MAX_CONTEXT_LINES, INLINE_ASSISTANT_MAX_FRAGMENT_CHARS, INLINE_ASSISTANT_MAX_TOKENS, buildInlineEditPrompt,
  inlineEditHunks, parseInlineEditResponse, shiftInlineHunks, type InlineAssistantTarget, type InlineEditHunk,
} from './goStudioInlineAssistant'
import './goStudioInlineAssistant.css'

export type GoStudioInlineAssistantPhase = 'prompt' | 'generating' | 'review'

interface GoStudioInlineAssistantState {
  open: boolean
  phase: GoStudioInlineAssistantPhase
  /** Angolo in coordinate finestra sotto la selezione: il popup si apre lì. */
  anchor: { x: number; y: number }
  /** File e righe del frammento in lavorazione. */
  label: string
  instruction: string
  hunks: number
  addedLines: number
  removedLines: number
  setInstruction: (instruction: string) => void
}

export const useGoStudioInlineAssistantStore = create<GoStudioInlineAssistantState>((set) => ({
  open: false,
  phase: 'prompt',
  anchor: { x: 0, y: 0 },
  label: '',
  instruction: '',
  hunks: 0,
  addedLines: 0,
  removedLines: 0,
  setInstruction: (instruction) => set({ instruction }),
}))

interface InlineSession {
  editor: monaco.editor.ICodeEditor
  sessionId: string
  target: InlineAssistantTarget
  hunks: InlineEditHunk[]
  accepted: number
  applying: boolean
  decorations: monaco.editor.IEditorDecorationsCollection
  zoneIds: string[]
  disposables: monaco.IDisposable[]
}

let session: InlineSession | null = null

const BAR_HEIGHT_PX = 18

function report(message: string | null): void {
  useGoIDELspStore.setState({ message })
}

function lineHeightFor(): number {
  return Math.round(useGoIDELspStore.getState().preferences.fontSize * 1.65)
}

function syncCounts(): void {
  if (!session) return
  const addedLines = session.hunks.reduce((total, hunk) => total + hunk.addedLines.length, 0)
  const removedLines = session.hunks.reduce((total, hunk) => total + hunk.removedLines.length, 0)
  useGoStudioInlineAssistantStore.setState({ hunks: session.hunks.length, addedLines, removedLines })
}

/** null se il file può essere inviato all'AI; altrimenti il motivo del rifiuto (.adomnia/aiignore, policy). */
async function blockedByPolicy(sessionId: string, relativePath: string, local: boolean): Promise<string | null> {
  const excluded = await listGoIDEAIExcludedPaths(sessionId, [relativePath], local)
  if (!excluded.includes(relativePath)) return null
  const policy = await getGoIDEAIPolicy(sessionId).catch(() => 'allowed')
  if (policy === 'off') return 'AI is turned off for this project (.adomnia/ai-policy.json)'
  if (policy === 'local-only') return 'this project allows only local AI models (.adomnia/ai-policy.json): use Ollama or a localhost endpoint'
  return `${relativePath} is excluded from AI by .adomnia/aiignore`
}

/** Selezione attiva, oppure la dichiarazione che contiene il cursore, come le AI actions. */
function rangeFor(editor: monaco.editor.ICodeEditor, model: monaco.editor.ITextModel): monaco.IRange | null {
  const selection = editor.getSelection()
  if (selection && !selection.isEmpty()) return selection
  const block = enclosingTopLevelBlock(model.getLinesContent(), editor.getPosition()?.lineNumber ?? 1)
  return block
    ? { startLineNumber: block.startLine, startColumn: 1, endLineNumber: block.endLine, endColumn: model.getLineMaxColumn(block.endLine) }
    : null
}

function targetFor(model: monaco.editor.ITextModel, range: monaco.IRange, relativePath: string, language: string): InlineAssistantTarget {
  const lines = model.getLinesContent()
  const head = model.getLineContent(range.startLineNumber).slice(0, range.startColumn - 1)
  const rest = model.getLineContent(range.endLineNumber).slice(range.endColumn - 1)
  return {
    relativePath,
    language,
    startLine: range.startLineNumber,
    startColumn: range.startColumn,
    oldText: model.getValueInRange(range),
    contextBefore: [...lines.slice(Math.max(0, range.startLineNumber - 1 - INLINE_ASSISTANT_MAX_CONTEXT_LINES), range.startLineNumber - 1), head].filter(Boolean).join('\n'),
    contextAfter: [rest, ...lines.slice(range.endLineNumber, range.endLineNumber + INLINE_ASSISTANT_MAX_CONTEXT_LINES)].filter(Boolean).join('\n'),
    problems: monaco.editor.getModelMarkers({ resource: model.uri })
      .filter((marker) => marker.severity >= monaco.MarkerSeverity.Warning && marker.startLineNumber >= range.startLineNumber && marker.startLineNumber <= range.endLineNumber)
      .map((marker) => ({ line: marker.startLineNumber - range.startLineNumber + 1, message: marker.message })),
  }
}

/**
 * Aperto da Ctrl+Enter sulla selezione (o sulla dichiarazione sotto il cursore): chiede
 * un'istruzione e mostra la proposta dell'AI come diff inline da accettare o scartare.
 * Con una revisione già aperta Ctrl+Enter accetta invece tutto ciò che resta.
 */
export function openInlineAssistant(editor: monaco.editor.ICodeEditor): void {
  if (session) {
    if (useGoStudioInlineAssistantStore.getState().phase === 'review') acceptAllInlineAssistant()
    return
  }
  const model = editor.getModel()
  const document = model ? documentForModel(model) : null
  if (!model || !document) return
  if (document.document.readOnly) return report('Inline Assistant: this file is read-only.')
  const range = rangeFor(editor, model)
  if (!range) return report('Inline Assistant: select the code to edit first.')
  const oldText = model.getValueInRange(range)
  if (oldText.length > INLINE_ASSISTANT_MAX_FRAGMENT_CHARS) {
    return report(`Inline Assistant: the selection is too large to send (limit ${INLINE_ASSISTANT_MAX_FRAGMENT_CHARS / 1000}k characters).`)
  }
  const target = targetFor(model, range, document.document.relativePath, document.document.language)
  const dom = editor.getDomNode()
  const visible = editor.getScrolledVisiblePosition({ lineNumber: range.endLineNumber, column: range.endColumn })
  const rect = dom?.getBoundingClientRect()
  const anchor = rect && visible
    ? { x: rect.left + visible.left, y: rect.top + visible.top + lineHeightFor() }
    : { x: Math.max(12, window.innerWidth / 2 - 210), y: 120 }
  const label = `${document.document.relativePath} · lines ${range.startLineNumber}${range.startLineNumber === range.endLineNumber ? '' : `-${range.endLineNumber}`}`
  session = {
    editor, sessionId: document.document.sessionId, target, hunks: [], accepted: 0, applying: false,
    decorations: editor.createDecorationsCollection(), zoneIds: [],
    disposables: [
      // La proposta vale per il testo che l'ha generata: ogni modifica la rende obsoleta.
      editor.onDidChangeModelContent(() => {
        if (session?.applying) return
        report('Inline Assistant: the file changed, the proposal was discarded.')
        closeInlineAssistant()
      }),
      editor.onDidChangeModel(() => closeInlineAssistant()),
      editor.onDidDispose(() => closeInlineAssistant()),
    ],
  }
  useGoStudioInlineAssistantStore.setState({ open: true, phase: 'prompt', anchor, label, instruction: '', hunks: 0, addedLines: 0, removedLines: 0 })
}

/** Invia l'istruzione all'AI configurata e mette il risultato in revisione inline. */
export async function generateInlineAssistant(instruction: string): Promise<void> {
  const current = session
  if (!current) return
  const request = instruction.trim()
  if (!request) return
  const ai = useSettingsStore.getState().settings.ai
  if (!isAICompanionAvailable(ai)) {
    report('Inline Assistant needs an AI provider: enable and test one in Settings → AI.')
    return closeInlineAssistant()
  }
  const blocked = await blockedByPolicy(current.sessionId, current.target.relativePath, isLocalAIProvider(ai))
  if (blocked) {
    report(`Inline Assistant: ${blocked}.`)
    return closeInlineAssistant()
  }
  useGoStudioInlineAssistantStore.setState({ phase: 'generating' })
  try {
    // I segreti nel codice e nell'istruzione restano sulla macchina; tornano nella proposta.
    const redactor = createAIRedactor()
    const prompt = buildInlineEditPrompt(current.target, redactor.redact(request))
    await ensureAIConfigured()
    const response = redactor.restore(await AIEngine.Complete(redactor.redact(prompt.system), redactor.redact(prompt.user), INLINE_ASSISTANT_MAX_TOKENS))
    if (session !== current) return // annullato o chiuso mentre il provider rispondeva
    const proposed = parseInlineEditResponse(response)
    const hunks = proposed === null ? [] : inlineEditHunks(current.target.oldText, proposed, current.target.startLine, current.target.startColumn)
    if (hunks.length === 0) {
      report('Inline Assistant: the AI did not change the fragment.')
      return closeInlineAssistant()
    }
    current.hunks = hunks
    useGoStudioInlineAssistantStore.setState({ phase: 'review' })
    syncCounts()
    renderReview()
  } catch (error) {
    if (session !== current) return
    report(`Inline Assistant failed: ${error instanceof Error ? error.message : String(error)}`)
    closeInlineAssistant()
  }
}

/** Accetta un blocco della proposta: diventa una modifica dell'editor, annullabile con Ctrl+Z. */
export function acceptInlineHunk(index: number): void {
  const current = session
  if (!current) return
  const hunk = current.hunks[index]
  if (!hunk) return
  applyEdits(current, [hunk.edit])
  current.accepted += 1
  current.hunks = shiftInlineHunks(current.hunks.filter((_item, position) => position !== index), hunk)
  finishOrRender(current)
}

/** Scarta un blocco: le righe restano come sono. */
export function rejectInlineHunk(index: number): void {
  const current = session
  if (!current) return
  if (!current.hunks[index]) return
  current.hunks = current.hunks.filter((_item, position) => position !== index)
  finishOrRender(current)
}

/** Accetta tutto ciò che resta in un'unica modifica annullabile. */
export function acceptAllInlineAssistant(): void {
  const current = session
  if (!current || current.hunks.length === 0) return
  const count = current.hunks.length
  applyEdits(current, current.hunks.map((hunk) => hunk.edit))
  current.accepted += count
  current.hunks = []
  finishOrRender(current)
}

/** Scarta ogni blocco ancora aperto. */
export function rejectAllInlineAssistant(): void {
  const current = session
  if (!current) return
  current.hunks = []
  finishOrRender(current)
}

/** Chiude tutto senza applicare (Esc, o modifica del file mentre la proposta è aperta). */
export function closeInlineAssistant(): void {
  const current = session
  if (!current) return
  clearVisuals(current)
  current.disposables.forEach((disposable) => disposable.dispose())
  session = null
  useGoStudioInlineAssistantStore.setState({ open: false, phase: 'prompt', hunks: 0, addedLines: 0, removedLines: 0 })
}

function finishOrRender(current: InlineSession): void {
  if (current.hunks.length > 0) {
    syncCounts()
    renderReview()
    return
  }
  const { accepted } = current
  closeInlineAssistant()
  report(accepted > 0 ? `Inline Assistant: ${accepted} change${accepted === 1 ? '' : 's'} applied.` : null)
}

function toMonacoEdit(edit: InlineEditHunk['edit']): monaco.editor.IIdentifiedSingleEditOperation {
  return {
    range: { startLineNumber: edit.range.startLine, startColumn: edit.range.startColumn, endLineNumber: edit.range.endLine, endColumn: edit.range.endColumn },
    text: edit.text,
    forceMoveMarkers: true,
  }
}

/** Le modifiche dell'Inline Assistant passano dall'editor: un Ctrl+Z le annulla, i buffer diventano dirty. */
function applyEdits(current: InlineSession, edits: InlineEditHunk['edit'][]): void {
  const editor = current.editor
  current.applying = true
  try {
    editor.pushUndoStop()
    editor.executeEdits('go-studio-inline', edits.map(toMonacoEdit))
    editor.pushUndoStop()
  } finally {
    current.applying = false
  }
}

function clearVisuals(current: InlineSession): void {
  current.decorations.clear()
  if (current.zoneIds.length > 0) {
    const ids = current.zoneIds
    current.zoneIds = []
    current.editor.changeViewZones((accessor) => ids.forEach((id) => accessor.removeZone(id)))
  }
}

/** Diff inline nel corpo dell'editor: righe tolte barrate, righe nuove in zone con accetta/scarta per blocco. */
function renderReview(): void {
  const current = session
  if (!current) return
  clearVisuals(current)
  const editor = current.editor
  const fontSize = useGoIDELspStore.getState().preferences.fontSize
  const lineHeight = Math.round(fontSize * 1.65)
  const contentLeft = editor.getLayoutInfo().contentLeft
  const decorations: monaco.editor.IModelDeltaDecoration[] = []
  current.hunks.forEach((hunk, index) => {
    const { startLine, startColumn, endLine, endColumn } = hunk.edit.range
    if (hunk.removedLines.length > 0) {
      decorations.push({
        range: { startLineNumber: startLine, startColumn, endLineNumber: endLine, endColumn },
        options: { className: 'go-studio-ia-del', inlineClassName: 'go-studio-ia-del-text', linesDecorationsClassName: 'go-studio-ia-del-bar' },
      })
    }
    const zone = document.createElement('div')
    zone.className = 'go-studio-ia-zone'
    const bar = document.createElement('div')
    bar.className = 'go-studio-ia-bar'
    const summary = document.createElement('span')
    summary.className = 'go-studio-ia-summary'
    summary.textContent = [hunk.addedLines.length ? `+${hunk.addedLines.length}` : '', hunk.removedLines.length ? `−${hunk.removedLines.length}` : ''].filter(Boolean).join(' ')
    bar.append(summary, hunkButton('✓', 'Accept this change', () => acceptInlineHunk(index)), hunkButton('✗', 'Reject this change', () => rejectInlineHunk(index)))
    zone.append(bar, ...hunk.addedLines.map((line) => {
      const row = document.createElement('div')
      row.className = 'go-studio-ia-add'
      row.style.height = `${lineHeight}px`
      row.style.lineHeight = `${lineHeight}px`
      row.style.fontSize = `${fontSize}px`
      row.style.paddingLeft = `${contentLeft}px`
      row.textContent = line
      return row
    }))
    const heightInPx = BAR_HEIGHT_PX + hunk.addedLines.length * lineHeight
    editor.changeViewZones((accessor) => {
      current.zoneIds.push(accessor.addZone({ afterLineNumber: hunk.anchorLine, heightInPx, domNode: zone, suppressMouseDown: true }))
    })
  })
  current.decorations.set(decorations)
}

function hunkButton(label: string, title: string, run: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'go-studio-ia-btn'
  button.title = title
  button.textContent = label
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', run)
  return button
}

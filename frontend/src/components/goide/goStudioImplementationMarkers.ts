import { useEffect, useRef, type MutableRefObject } from 'react'
import { monaco } from '@/lib/monacoSetup'
import { requestImplementationMarkers, type GoIDEImplementationMarker } from '@/lib/goide-lsp-api'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { documentForModel, navigateToLocation } from './goStudioLanguageFeatures'
import { symbolPathAt } from './goStudioSymbols'
import { flushGoStudioDocument } from './goStudioLspSync'

const REFRESH_DEBOUNCE_MS = 900

/** Marcatori e decorazioni di ciascun editor: le decorazioni seguono il testo, quindi dicono la riga attuale. */
const markersByEditor = new WeakMap<monaco.editor.ICodeEditor, { markers: GoIDEImplementationMarker[]; collection: monaco.editor.IEditorDecorationsCollection }>()

function describe(marker: GoIDEImplementationMarker): string {
  const count = marker.locations.length
  return marker.direction === 'implementedBy'
    ? `${marker.name} is implemented by ${count} ${count === 1 ? 'type' : 'types'} · click to navigate`
    : `${marker.name} implements ${count} ${count === 1 ? 'interface' : 'interfaces'} · click to navigate`
}

export function implementationDecorations(markers: GoIDEImplementationMarker[]): monaco.editor.IModelDeltaDecoration[] {
  return markers.map((marker) => ({
    range: { startLineNumber: marker.line, startColumn: 1, endLineNumber: marker.line, endColumn: 1 },
    options: {
      glyphMarginClassName: marker.direction === 'implementedBy' ? 'go-studio-impl-glyph go-studio-impl-down' : 'go-studio-impl-glyph go-studio-impl-up',
      glyphMarginHoverMessage: { value: describe(marker) },
    },
  }))
}

/**
 * Clic su un marcatore I↓/I↑: una destinazione si apre subito, più destinazioni aprono il popup
 * delle implementazioni accanto al glifo. Restituisce true se il clic è stato gestito.
 */
export function openImplementationMarker(editor: monaco.editor.ICodeEditor, line: number, anchor: { x: number; y: number }, sessionId: string): boolean {
  const entry = markersByEditor.get(editor)
  const index = entry ? entry.collection.getRanges().findIndex((range) => range.startLineNumber === line) : -1
  const marker = index >= 0 ? entry?.markers[index] : undefined
  if (!marker) return false
  if (marker.locations.length === 1) {
    navigateToLocation(marker.locations[0])
    return true
  }
  const title = marker.direction === 'implementedBy' ? `Implementations of ${marker.name}` : `Interfaces implemented by ${marker.name}`
  const groupLabel = marker.direction === 'implementedBy' ? 'Implementations' : 'Interfaces'
  useGoIDELspStore.getState().showCaretPopup({ kind: 'usages', anchor, sessionId, title, locations: marker.locations, groupLabel })
  return true
}

/** Aggiorna i marcatori del file quando gopls è pronto e dopo una pausa nella scrittura. */
export function useGoStudioImplementationMarkers(editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>, document: GoIDEEditorDocument, mountCount: number): void {
  const { sessionId, id, external, name } = document.document
  const lspReady = useGoIDELspStore((state) => state.status[sessionId]?.state === 'ready')
  const collectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const enabled = lspReady && !external && name.endsWith('.go')

  useEffect(() => {
    const editor = editorRef.current
    if (editor) collectionRef.current ??= editor.createDecorationsCollection()
  }, [editorRef, mountCount])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (!enabled) {
      collectionRef.current?.clear()
      markersByEditor.delete(editor)
      return
    }
    let cancel: (() => void) | null = null
    const timer = window.setTimeout(() => {
      void flushGoStudioDocument(id).then(() => {
        const request = requestImplementationMarkers(sessionId, id)
        cancel = () => { void request.cancel() }
        request.then((markers) => {
          const collection = collectionRef.current
          if (!collection) return
          collection.set(implementationDecorations(markers))
          markersByEditor.set(editor, { markers, collection })
        }).catch(() => undefined)
      })
    }, REFRESH_DEBOUNCE_MS)
    return () => { window.clearTimeout(timer); cancel?.() }
  }, [document.buffer, editorRef, enabled, id, mountCount, sessionId])
}

/** Ctrl+U: dal tipo o metodo sotto il cursore alle interfacce che implementa (Go to Super Method di GoLand). */
export function goToSuperMethod(editor: monaco.editor.ICodeEditor): void {
  const model = editor.getModel()
  const position = editor.getPosition()
  const document = model ? documentForModel(model) : null
  if (!document || !position) return
  const symbols = useGoIDELspStore.getState().symbols[document.document.id] ?? []
  const chain = symbolPathAt(symbols, position.lineNumber, position.column)
  const visible = editor.getScrolledVisiblePosition(position)
  const rect = editor.getDomNode()?.getBoundingClientRect()
  const anchor = { x: (rect?.left ?? 0) + (visible?.left ?? 0), y: (rect?.top ?? 0) + (visible?.top ?? 0) + (visible?.height ?? 0) }
  // Dal simbolo più interno al più esterno: il primo con un marcatore "implements" vince.
  for (const node of [...chain].reverse()) {
    const entry = markersByEditor.get(editor)
    const index = entry?.collection.getRanges().findIndex((range) => range.startLineNumber === node.selectionRange.startLine) ?? -1
    if (index >= 0 && entry?.markers[index]?.direction === 'implements') {
      openImplementationMarker(editor, node.selectionRange.startLine, anchor, document.document.sessionId)
      return
    }
  }
  useGoIDELspStore.setState({ message: 'Go to Super Method: the symbol at the caret does not implement an interface.' })
}

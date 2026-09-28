import { useEffect } from 'react'
import { requestDocumentSymbols, type GoIDESymbolNode } from '@/lib/goide-lsp-api'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { currentGoStudioDocumentVersion, flushGoStudioDocument } from './goStudioLspSync'

const REFRESH_DEBOUNCE_MS = 400
const EMPTY: GoIDESymbolNode[] = []

/** Mantiene aggiornati i simboli del documento attivo nello store: una sola richiesta per Structure e breadcrumb. */
export function useGoStudioDocumentSymbols(document: GoIDEEditorDocument | null): void {
  const sessionId = document?.document.sessionId ?? ''
  const documentId = document?.document.id ?? null
  const isGo = !!document?.document.name.endsWith('.go')
  const lspReady = useGoIDELspStore((state) => state.status[sessionId]?.state === 'ready')

  useEffect(() => {
    if (!documentId || !isGo || !lspReady) return
    let cancel: (() => void) | null = null
    const timer = window.setTimeout(() => {
      void flushGoStudioDocument(documentId).then(() => {
        const request = requestDocumentSymbols(sessionId, documentId)
        cancel = () => { void request.cancel() }
        request.then((result) => {
          const current = currentGoStudioDocumentVersion(documentId)
          if (current !== null && current !== result.version && !document?.document.readOnly) return
          useGoIDELspStore.setState((state) => ({ symbols: { ...state.symbols, [documentId]: result.symbols } }))
        }).catch(() => undefined)
      })
    }, REFRESH_DEBOUNCE_MS)
    return () => { window.clearTimeout(timer); cancel?.() }
  }, [document?.buffer, documentId, isGo, lspReady, sessionId]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function useGoStudioSymbolsFor(documentId: string | null): GoIDESymbolNode[] {
  return useGoIDELspStore((state) => (documentId ? state.symbols[documentId] ?? EMPTY : EMPTY))
}

/** Catena dei simboli che contengono la posizione, dal più esterno al più interno. */
export function symbolPathAt(symbols: GoIDESymbolNode[], line: number, column: number): GoIDESymbolNode[] {
  const contains = (node: GoIDESymbolNode) => {
    const { startLine, startColumn, endLine, endColumn } = node.range
    if (line < startLine || line > endLine) return false
    if (line === startLine && column < startColumn) return false
    return !(line === endLine && column > endColumn)
  }
  const path: GoIDESymbolNode[] = []
  let level = symbols
  for (;;) {
    const match = level.find(contains)
    if (!match) return path
    path.push(match)
    level = match.children ?? []
  }
}

/** Chiave stabile di un simbolo: nome e riga di inizio bastano a distinguerlo nel file. */
export function symbolKey(node: GoIDESymbolNode): string {
  return `${node.name}:${node.range.startLine}`
}

/** Fratelli del simbolo nel file (stesso livello), per saltare da un metodo all'altro dal breadcrumb. */
export function symbolSiblings(symbols: GoIDESymbolNode[], chain: GoIDESymbolNode[], index: number): GoIDESymbolNode[] {
  return index === 0 ? symbols : chain[index - 1]?.children ?? []
}

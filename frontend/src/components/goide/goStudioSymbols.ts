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

/** Chiave stabile di un simbolo: la sua posizione nel file. Non dipende dal nome, che la Structure accorcia per i metodi. */
export function symbolKey(node: GoIDESymbolNode): string {
  return `${node.range.startLine}:${node.range.startColumn}`
}

/** Fratelli del simbolo nel file (stesso livello), per saltare da un metodo all'altro dal breadcrumb. */
export function symbolSiblings(symbols: GoIDESymbolNode[], chain: GoIDESymbolNode[], index: number): GoIDESymbolNode[] {
  return index === 0 ? symbols : chain[index - 1]?.children ?? []
}

/** SymbolKind LSP usati da gopls. */
export const SYMBOL_KIND = {
  class: 5, method: 6, property: 7, field: 8, constructor: 9, interface: 11, function: 12,
  variable: 13, constant: 14, struct: 23, typeParameter: 26,
} as const

const TYPE_KINDS = new Set<number>([SYMBOL_KIND.class, SYMBOL_KIND.interface, SYMBOL_KIND.struct, SYMBOL_KIND.typeParameter])
const FUNCTION_KINDS = new Set<number>([SYMBOL_KIND.function, SYMBOL_KIND.constructor])
const METHOD_NAME = /^\(\*?([A-Za-z_]\w*)(?:\[[^\]]*\])?\)\.([A-Za-z_]\w*)$/

export type StructureSectionId = 'constants' | 'variables' | 'types' | 'functions' | 'methods' | 'other'

export interface StructureSection {
  id: StructureSectionId
  label: string
  nodes: GoIDESymbolNode[]
}

const SECTION_ORDER: { id: StructureSectionId; label: string }[] = [
  { id: 'constants', label: 'Constants' },
  { id: 'variables', label: 'Variables' },
  { id: 'types', label: 'Types' },
  { id: 'functions', label: 'Functions' },
  { id: 'methods', label: 'Methods' },
  { id: 'other', label: 'Other' },
]

function sectionOf(node: GoIDESymbolNode): StructureSectionId {
  if (node.kind === SYMBOL_KIND.constant) return 'constants'
  if (node.kind === SYMBOL_KIND.variable) return 'variables'
  if (TYPE_KINDS.has(node.kind)) return 'types'
  if (FUNCTION_KINDS.has(node.kind)) return 'functions'
  if (node.kind === SYMBOL_KIND.method) return 'methods'
  return 'other'
}

/**
 * Raggruppa i simboli di primo livello per sezione, come la Structure di GoLand.
 * gopls elenca i metodi in cima con nome "(*T).M": finiscono sotto il loro tipo, dopo i campi.
 * Un metodo il cui tipo è in un altro file resta nella sezione Methods.
 */
export function groupStructure(symbols: GoIDESymbolNode[]): StructureSection[] {
  const buckets = new Map<StructureSectionId, GoIDESymbolNode[]>()
  const methodsByType = new Map<string, GoIDESymbolNode[]>()
  const typeNames = new Set(symbols.filter((node) => TYPE_KINDS.has(node.kind)).map((node) => node.name))
  for (const node of symbols) {
    const method = node.kind === SYMBOL_KIND.method ? METHOD_NAME.exec(node.name) : null
    if (method && typeNames.has(method[1])) {
      const renamed = { ...node, name: method[2] }
      methodsByType.set(method[1], [...(methodsByType.get(method[1]) ?? []), renamed])
      continue
    }
    const id = sectionOf(node)
    buckets.set(id, [...(buckets.get(id) ?? []), node])
  }
  const withMethods = (node: GoIDESymbolNode) => {
    const methods = methodsByType.get(node.name)
    return methods ? { ...node, children: [...(node.children ?? []), ...methods] } : node
  }
  return SECTION_ORDER
    .map(({ id, label }) => ({ id, label, nodes: (buckets.get(id) ?? []).map((node) => (id === 'types' ? withMethods(node) : node)) }))
    .filter((section) => section.nodes.length > 0)
}

export interface SymbolSignature {
  /** Parametri tra parentesi, "(v ...any)". */
  params: string
  /** Risultato dopo i parametri, "*Logger" o "(int, error)"; vuoto se la funzione non restituisce nulla. */
  result: string
}

/** Divide il dettaglio di gopls "func(v ...any) error" in parametri e risultato; null se non è una firma. */
export function splitSignature(detail: string): SymbolSignature | null {
  const text = detail.trim().replace(/^func(?=[[(])/, '')
  let start = text.indexOf('(')
  if (text.startsWith('[')) start = text.indexOf('(', closingIndex(text, 0, '[', ']') + 1)
  if (start < 0) return null
  const end = closingIndex(text, start, '(', ')')
  if (end < 0) return null
  return { params: text.slice(start, end + 1), result: text.slice(end + 1).trim() }
}

function closingIndex(text: string, from: number, open: string, close: string): number {
  let depth = 0
  for (let index = from; index < text.length; index++) {
    if (text[index] === open) depth++
    else if (text[index] === close && --depth === 0) return index
  }
  return -1
}

import { useDeferredValue, useEffect, useMemo } from 'react'
import { ideLanguageForEditor, languageServerEditorLanguages } from '@/components/ide/languages'
import { requestDocumentSymbols, type GoIDESymbolNode } from '@/lib/code-studio-lsp-api'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { javaOutline } from '@/components/ide/languages/java/javaLocalOutline'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { serverEntry, useIdeLanguageServersStore } from '@/stores/ideLanguageServers'
import { currentCodeStudioDocumentVersion, flushCodeStudioDocument } from './codeStudioLspSync'

const REFRESH_DEBOUNCE_MS = 400
const EMPTY: GoIDESymbolNode[] = []
const symbolBuffers = new WeakMap<GoIDESymbolNode[], string>()

/** Stato del server che serve il documento, indipendente dagli altri linguaggi del workspace. */
export function useCodeStudioSymbolServer(sessionId: string, editorLanguage: string) {
  const language = ideLanguageForEditor(editorLanguage)
  const provided = useIdeLanguageServersStore((state) => serverEntry(state, sessionId, language?.id ?? ''))
  const coreState = useCodeStudioLspStore((state) => state.status[sessionId]?.state ?? 'stopped')
  return {
    supported: languageServerEditorLanguages().includes(editorLanguage),
    name: language?.name ?? 'Language server',
    state: language?.providedServer ? provided.state : coreState,
    error: language?.providedServer ? provided.error : undefined,
  }
}

/** Mantiene aggiornati i simboli del documento attivo nello store: una sola richiesta per Structure e breadcrumb. */
export function useCodeStudioDocumentSymbols(document: GoIDEEditorDocument | null): void {
  const sessionId = document?.document.sessionId ?? ''
  const documentId = document?.document.id ?? null
  // I simboli arrivano dal language server: ci sono per ogni linguaggio che ne ha uno (Go, Java, web),
  // non solo per Go. Stesso elenco dei provider LSP generici di codeStudioLanguageFeatures.
  const server = useCodeStudioSymbolServer(sessionId, document?.document.language ?? '')
  const hasSymbols = server.supported
  const lspReady = server.state === 'ready'
  const buffer = document?.buffer
  const readOnly = document?.document.readOnly

  useEffect(() => {
    if (!documentId || !hasSymbols || !lspReady) return
    let cancel: (() => void) | null = null
    let disposed = false
    const timer = window.setTimeout(() => {
      void flushCodeStudioDocument(documentId).then(() => {
        if (disposed) return
        const request = requestDocumentSymbols(sessionId, documentId)
        cancel = () => { void request.cancel() }
        request.then((result) => {
          if (disposed) return
          const latest = useCodeStudioStore.getState().documents.find(item => item.document.id === documentId && item.document.sessionId === sessionId)
          if (!latest || latest.buffer !== buffer) return
          const current = currentCodeStudioDocumentVersion(documentId)
          if (current !== null && current !== result.version && !readOnly) return
          symbolBuffers.set(result.symbols, latest.buffer)
          useCodeStudioLspStore.setState((state) => ({ symbols: { ...state.symbols, [documentId]: result.symbols } }))
        }).catch(() => undefined)
      }).catch(() => undefined)
    }, REFRESH_DEBOUNCE_MS)
    return () => { disposed = true; window.clearTimeout(timer); cancel?.() }
  }, [buffer, readOnly, documentId, hasSymbols, lspReady, sessionId])
}

/** Same snapshot for Structure and breadcrumbs; local syntax remains available during JDT import. */
export function useCodeStudioSymbolSnapshot(documentId: string | null, fallbackDocument?: GoIDEEditorDocument | null) {
  const storedDocument = useCodeStudioStore(state => state.documents.find(item => item.document.id === documentId))
  const document = fallbackDocument ?? storedDocument
  const server = useCodeStudioSymbolServer(document?.document.sessionId ?? '', document?.document.language ?? '')
  const symbols = useCodeStudioLspStore(state => documentId ? state.symbols[documentId] : undefined)
  const buffer = document?.buffer ?? ''
  const java = document?.document.language === 'java'
  const input = useMemo(() => ({ id: documentId, buffer }), [documentId, buffer])
  const deferred = useDeferredValue(input)
  const text = deferred.id === documentId ? deferred.buffer : buffer
  const pending = text !== buffer
  return useMemo(() => java
    ? { ...javaOutline(text, pending ? 'starting' : server.state, symbols, symbols ? symbolBuffers.get(symbols) : undefined), pending }
    : { symbols: symbols ?? EMPTY, source: 'server' as const, limited: false, pending: false }, [text, pending, java, server.state, symbols])
}

export function useCodeStudioSymbolsFor(documentId: string | null): GoIDESymbolNode[] {
  return useCodeStudioSymbolSnapshot(documentId).symbols
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
  class: 5, enum: 10, method: 6, property: 7, field: 8, constructor: 9, interface: 11, function: 12,
  variable: 13, constant: 14, struct: 23, typeParameter: 26,
} as const

const TYPE_KINDS = new Set<number>([SYMBOL_KIND.class, SYMBOL_KIND.enum, SYMBOL_KIND.interface, SYMBOL_KIND.struct, SYMBOL_KIND.typeParameter])
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
 * Raggruppa i simboli di primo livello per sezione.
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

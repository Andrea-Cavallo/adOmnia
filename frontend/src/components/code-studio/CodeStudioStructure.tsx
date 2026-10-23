import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Info } from 'lucide-react'
import type { GoIDESymbolNode } from '@/lib/code-studio-lsp-api'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { CodeStudioSymbolIcon } from './CodeStudioSymbolIcon'
import { SYMBOL_KIND, groupStructure, splitSignature, symbolKey, symbolPathAt, useCodeStudioSymbolSnapshot, useCodeStudioSymbolServer, type StructureSection } from './codeStudioSymbols'
import { useCodeStudioCursorStore } from './codeStudioCursor'


interface CodeStudioStructureProps {
  sessionId: string
  document: GoIDEEditorDocument | null
}

interface SymbolRowProps {
  node: GoIDESymbolNode
  depth: number
  documentId: string
  /** Chiavi dei simboli che contengono il cursore, dal più esterno al più interno. */
  caretPath: string[]
}

const CALLABLE_KINDS = new Set<number>([SYMBOL_KIND.function, SYMBOL_KIND.method, SYMBOL_KIND.constructor])
const ROW_INDENT_PX = 14

/** Nome e dettaglio del simbolo: firma per le funzioni, tipo o valore per campi e costanti. */
function SymbolLabel({ node }: { node: GoIDESymbolNode }) {
  const signature = CALLABLE_KINDS.has(node.kind) && node.detail ? splitSignature(node.detail) : null
  if (signature) {
    return (
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="min-w-0 truncate"><span className="text-text-1">{node.name}</span><span className="text-text-3">{signature.params}</span></span>
        {signature.result && <span className="shrink-0 truncate font-mono text-[10px] text-text-4">{signature.result}</span>}
      </span>
    )
  }
  const showDetail = node.detail && !node.detail.startsWith('struct{') && !node.detail.startsWith('interface{')
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="min-w-0 shrink-0 truncate text-text-1">{node.name}</span>
      {showDetail && <span className="ml-auto min-w-0 truncate font-mono text-[10px] text-info/80">{node.detail}</span>}
    </span>
  )
}

/** Riga della struttura: il simbolo sotto il cursore resta evidenziato e visibile. */
const SymbolRow = memo(function SymbolRow({ node, depth, documentId, caretPath }: SymbolRowProps) {
  const key = symbolKey(node)
  const onCaretPath = caretPath.includes(key)
  const current = caretPath[caretPath.length - 1] === key
  const children = node.children ?? []
  const revealChildren = onCaretPath && children.length > 0
  const [open, setOpen] = useState(!CALLABLE_KINDS.has(node.kind) || revealChildren)
  const [wasRevealing, setWasRevealing] = useState(revealChildren)
  if (wasRevealing !== revealChildren) {
    setWasRevealing(revealChildren)
    if (revealChildren) setOpen(true)
  }
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (current) rowRef.current?.scrollIntoView({ block: 'nearest' }) }, [current])
  const reveal = () => useCodeStudioStore.setState({ revealLocation: { documentId, line: node.selectionRange.startLine, column: node.selectionRange.startColumn } })
  return (
    <>
      <div ref={rowRef} aria-current={current ? 'location' : undefined} className={`group relative flex h-[26px] items-center rounded-md pr-2 text-[12px] ${current ? 'bg-accent/15' : 'hover:bg-surface-3'}`} style={{ paddingLeft: 6 + depth * ROW_INDENT_PX }}>
        {depth > 1 && <span aria-hidden className="absolute bottom-0 top-0 w-px bg-border-1" style={{ left: 13 + (depth - 1) * ROW_INDENT_PX }} />}
        {children.length > 0
          ? <button type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? 'Collapse' : 'Expand'} className="grid h-4 w-4 shrink-0 place-items-center text-text-4 hover:text-text-1">{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
          : <span className="w-4 shrink-0" />}
        <button type="button" onClick={reveal} title={node.detail ? `${node.name} ${node.detail}` : node.name} className="ml-0.5 flex min-w-0 flex-1 items-center gap-2 text-left">
          <CodeStudioSymbolIcon kind={node.kind} size={12} />
          <SymbolLabel node={node} />
        </button>
      </div>
      {open && children.map((child) => <SymbolRow key={symbolKey(child)} node={child} depth={depth + 1} documentId={documentId} caretPath={caretPath.includes(symbolKey(child)) ? caretPath : NO_PATH} />)}
    </>
  )
})

/** Il cursore è nel simbolo o in uno dei suoi figli diretti (i metodi spostati sotto il loro tipo). */
function ownsCaret(node: GoIDESymbolNode, caretPath: string[]): boolean {
  if (caretPath.length === 0) return false
  const key = symbolKey(node)
  return caretPath[0] === key || (node.children ?? []).some((child) => symbolKey(child) === caretPath[0])
}

/** Sezione Constants / Types / Functions con conteggio, comprimibile. */
function StructureGroup({ section, documentId, caretPath }: { section: StructureSection; documentId: string; caretPath: string[] }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="mb-1.5">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-[12px] font-semibold text-text-2 hover:bg-surface-3 hover:text-text-1">
        {open ? <ChevronDown size={12} className="text-text-4" /> : <ChevronRight size={12} className="text-text-4" />}
        <span>{section.label}</span>
        <span className="font-normal text-text-4">({section.nodes.length})</span>
      </button>
      {open && section.nodes.map((node) => <SymbolRow key={symbolKey(node)} node={node} depth={1} documentId={documentId} caretPath={ownsCaret(node, caretPath) ? caretPath : NO_PATH} />)}
    </section>
  )
}

const NO_PATH: string[] = []

/** Struttura del file attivo dal suo language server; i simboli arrivano dallo store condiviso con il breadcrumb. */
export function CodeStudioStructure({ sessionId, document }: CodeStudioStructureProps) {
  const server = useCodeStudioSymbolServer(sessionId, document?.document.language ?? '')
  const snapshot = useCodeStudioSymbolSnapshot(document?.document.id ?? null, document)
  const { symbols } = snapshot
  const local = snapshot.source === 'local'
  const loaded = useCodeStudioLspStore((state) => !!document && state.symbols[document.document.id] !== undefined)
  // Solo la chiave cambia quando il cursore passa a un altro simbolo: niente ridisegni a ogni tasto.
  const caretKey = useCodeStudioCursorStore((state) => symbolPathAt(symbols, state.line, state.column).map(symbolKey).join('|'))
  const caretPath = caretKey ? caretKey.split('|') : NO_PATH
  const sections = useMemo(() => groupStructure(symbols), [symbols])

  if (!document) return <Hint text="Open a source file to see its structure." />
  if (!server.supported) return <Hint text="Structure is available for languages with a language server." />
  if (!local && server.state !== 'ready') return <Hint text={server.error || (server.state === 'starting' ? `${server.name} language server is loading the workspace…` : `Start the ${server.name} language server to see types, functions and methods.`)} />
  return (
    <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5">
      {document.document.language === 'java' && <div role="status" className="mb-1 border-b border-border-1 px-2 py-1 text-[10px] text-text-4">{local ? (snapshot.pending ? 'Local Java · updating…' : server.state === 'starting' ? 'Local Java · language server loading the workspace…' : 'Local Java · current file') : 'Java language server'}</div>}
      {local && server.error && <Hint text={server.error} />}
      {snapshot.limited && <Hint text="Local Java analysis is limited to 256,000 characters and 50,000 tokens. Use the language server for this file." />}
      {sections.map((section) => <StructureGroup key={section.id} section={section} documentId={document.document.id} caretPath={caretPath} />)}
      {symbols.length === 0 && <Hint text={loaded || local ? 'No top-level symbols.' : 'Reading the file structure…'} />}
    </div>
  )
}

function Hint({ text }: { text: string }) {
  return <div className="flex items-start gap-2 p-3 text-[10px] leading-4 text-text-4"><Info size={12} className="mt-0.5 shrink-0" />{text}</div>
}

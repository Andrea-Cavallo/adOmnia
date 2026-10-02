import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Info } from 'lucide-react'
import type { GoIDESymbolNode } from '@/lib/goide-lsp-api'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { GoStudioSymbolIcon } from './GoStudioSymbolIcon'
import { SYMBOL_KIND, groupStructure, splitSignature, symbolKey, symbolPathAt, useGoStudioSymbolsFor, type StructureSection } from './goStudioSymbols'
import { useGoStudioCursorStore } from './goStudioCursor'


interface GoStudioStructureProps {
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

/** Riga della struttura: il simbolo sotto il cursore resta evidenziato e visibile, come in GoLand. */
const SymbolRow = memo(function SymbolRow({ node, depth, documentId, caretPath }: SymbolRowProps) {
  const key = symbolKey(node)
  const onCaretPath = caretPath.includes(key)
  const current = caretPath[caretPath.length - 1] === key
  const children = node.children ?? []
  const [open, setOpen] = useState(!CALLABLE_KINDS.has(node.kind))
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (onCaretPath && children.length > 0) setOpen(true) }, [onCaretPath, children.length])
  useEffect(() => { if (current) rowRef.current?.scrollIntoView({ block: 'nearest' }) }, [current])
  const reveal = () => useGoIDEStore.setState({ revealLocation: { documentId, line: node.selectionRange.startLine, column: node.selectionRange.startColumn } })
  return (
    <>
      <div ref={rowRef} aria-current={current ? 'location' : undefined} className={`group relative flex h-[26px] items-center rounded-md pr-2 text-[12px] ${current ? 'bg-accent/15' : 'hover:bg-surface-3'}`} style={{ paddingLeft: 6 + depth * ROW_INDENT_PX }}>
        {depth > 1 && <span aria-hidden className="absolute bottom-0 top-0 w-px bg-border-1" style={{ left: 13 + (depth - 1) * ROW_INDENT_PX }} />}
        {children.length > 0
          ? <button type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? 'Collapse' : 'Expand'} className="grid h-4 w-4 shrink-0 place-items-center text-text-4 hover:text-text-1">{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
          : <span className="w-4 shrink-0" />}
        <button type="button" onClick={reveal} title={node.detail ? `${node.name} ${node.detail}` : node.name} className="ml-0.5 flex min-w-0 flex-1 items-center gap-2 text-left">
          <GoStudioSymbolIcon kind={node.kind} size={12} />
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

/** Sezione Constants / Types / Functions con conteggio, comprimibile come in GoLand. */
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

/** Struttura del file attivo da gopls; i simboli arrivano dallo store condiviso con il breadcrumb. */
export function GoStudioStructure({ sessionId, document }: GoStudioStructureProps) {
  const lspState = useGoIDELspStore((state) => state.status[sessionId]?.state ?? 'stopped')
  const symbols = useGoStudioSymbolsFor(document?.document.id ?? null)
  const loaded = useGoIDELspStore((state) => !!document && state.symbols[document.document.id] !== undefined)
  const isGo = !!document?.document.name.endsWith('.go')
  // Solo la chiave cambia quando il cursore passa a un altro simbolo: niente ridisegni a ogni tasto.
  const caretKey = useGoStudioCursorStore((state) => symbolPathAt(symbols, state.line, state.column).map(symbolKey).join('|'))
  const caretPath = caretKey ? caretKey.split('|') : NO_PATH
  const sections = useMemo(() => groupStructure(symbols), [symbols])

  if (!document) return <Hint text="Open a Go file to see its structure." />
  if (!isGo) return <Hint text="Structure is available for .go files." />
  if (lspState !== 'ready') return <Hint text={lspState === 'starting' ? 'gopls is loading the workspace…' : 'Start gopls (Go → Start Language Server) to see types, functions and methods.'} />
  return (
    <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5">
      {sections.map((section) => <StructureGroup key={section.id} section={section} documentId={document.document.id} caretPath={caretPath} />)}
      {symbols.length === 0 && <Hint text={loaded ? 'No top-level symbols.' : 'Reading the file structure…'} />}
    </div>
  )
}

function Hint({ text }: { text: string }) {
  return <div className="flex items-start gap-2 p-3 text-[10px] leading-4 text-text-4"><Info size={12} className="mt-0.5 shrink-0" />{text}</div>
}

import { useState } from 'react'
import { ChevronDown, ChevronRight, Info } from 'lucide-react'
import type { GoIDESymbolNode } from '@/lib/goide-lsp-api'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { GoStudioSymbolIcon } from './GoStudioSymbolIcon'
import { useGoStudioSymbolsFor } from './goStudioSymbols'


interface GoStudioStructureProps {
  sessionId: string
  document: GoIDEEditorDocument | null
}

function SymbolRow({ node, depth, documentId }: { node: GoIDESymbolNode; depth: number; documentId: string }) {
  const [open, setOpen] = useState(depth < 1)
  const children = node.children ?? []
  const reveal = () => useGoIDEStore.setState({ revealLocation: { documentId, line: node.selectionRange.startLine, column: node.selectionRange.startColumn } })
  return (
    <>
      <div className="group flex h-6 items-center pr-2 text-[11px] text-text-2 hover:bg-surface-3" style={{ paddingLeft: 4 + depth * 12 }}>
        {children.length > 0
          ? <button type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? 'Collapse' : 'Expand'} className="grid h-4 w-4 shrink-0 place-items-center text-text-4 hover:text-text-1">{open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}</button>
          : <span className="w-4 shrink-0" />}
        <button type="button" onClick={reveal} title={node.detail || node.name} className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-text-1">
          <GoStudioSymbolIcon kind={node.kind} />
          <span className="truncate">{node.name}</span>
          {node.detail && <span className="min-w-0 truncate font-mono text-[9px] text-text-4">{node.detail}</span>}
        </button>
      </div>
      {open && children.map((child) => <SymbolRow key={`${child.name}:${child.range.startLine}`} node={child} depth={depth + 1} documentId={documentId} />)}
    </>
  )
}

/** Struttura del file attivo da gopls; i simboli arrivano dallo store condiviso con il breadcrumb. */
export function GoStudioStructure({ sessionId, document }: GoStudioStructureProps) {
  const lspState = useGoIDELspStore((state) => state.status[sessionId]?.state ?? 'stopped')
  const symbols = useGoStudioSymbolsFor(document?.document.id ?? null)
  const isGo = !!document?.document.name.endsWith('.go')

  if (!document) return <Hint text="Open a Go file to see its structure." />
  if (!isGo) return <Hint text="Structure is available for .go files." />
  if (lspState !== 'ready') return <Hint text={lspState === 'starting' ? 'gopls is loading the workspace…' : 'Start gopls (Go → Start Language Server) to see types, functions and methods.'} />
  return (
    <div className="min-h-0 flex-1 overflow-auto py-1">
      {symbols.map((node) => <SymbolRow key={`${node.name}:${node.range.startLine}`} node={node} depth={0} documentId={document.document.id} />)}
      {symbols.length === 0 && <Hint text="No top-level symbols." />}
    </div>
  )
}

function Hint({ text }: { text: string }) {
  return <div className="flex items-start gap-2 p-3 text-[10px] leading-4 text-text-4"><Info size={12} className="mt-0.5 shrink-0" />{text}</div>
}

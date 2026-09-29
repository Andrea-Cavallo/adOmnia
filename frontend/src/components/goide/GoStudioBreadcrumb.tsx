import { useState } from 'react'
import { Lock, Save } from 'lucide-react'
import type { GoIDESymbolNode } from '@/lib/goide-lsp-api'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { GoStudioSymbolIcon } from './GoStudioSymbolIcon'
import { symbolKey, symbolPathAt, symbolSiblings, useGoStudioSymbolsFor } from './goStudioSymbols'

interface GoStudioBreadcrumbProps {
  document: GoIDEEditorDocument
  cursor: { line: number; column: number }
  onSave: () => void
}

/** Percorso del file seguito dal simbolo che contiene il cursore (tipo › metodo); ogni simbolo apre l'elenco dei suoi fratelli. */
export function GoStudioBreadcrumb({ document, cursor, onSave }: GoStudioBreadcrumbProps) {
  const symbols = useGoStudioSymbolsFor(document.document.id)
  const chain = symbolPathAt(symbols, cursor.line, cursor.column)
  const reveal = (line: number, column: number) => useGoIDEStore.setState({ revealLocation: { documentId: document.document.id, line, column } })
  const segments = document.document.relativePath.split('/').filter(Boolean)
  const [menu, setMenu] = useState<{ x: number; y: number; current: string; siblings: GoIDESymbolNode[] } | null>(null)
  const openSiblings = (index: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect()
    setMenu({ x: rect.left, y: rect.bottom + 2, current: symbolKey(chain[index]), siblings: symbolSiblings(symbols, chain, index) })
  }

  return (
    <nav aria-label="Breadcrumb" className="flex h-7 shrink-0 items-center gap-1 overflow-hidden px-4 text-[12px] text-text-4">
      {document.document.readOnly && <span className="mr-1 flex shrink-0 items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-medium text-text-3" title="SDK and module cache sources open read-only"><Lock size={9} /> Read-only · Go SDK</span>}
      {segments.map((segment, index) => <span key={`${segment}-${index}`} className="shrink-0">{index > 0 && <span className="px-1 text-border-2">›</span>}{segment}</span>)}
      {chain.map((node) => (
        <span key={`${node.name}:${node.range.startLine}`} className="flex min-w-0 items-center">
          <span className="px-1 text-border-2">›</span>
          <button type="button" aria-haspopup="menu" title="Jump to another symbol at this level" onClick={(event) => openSiblings(chain.indexOf(node), event.currentTarget)} className="flex min-w-0 items-center gap-1 rounded px-0.5 text-text-3 hover:bg-surface-2 hover:text-text-1">
            <GoStudioSymbolIcon kind={node.kind} size={12} /><span className="truncate">{node.name}</span>
          </button>
        </span>
      ))}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.siblings.map((sibling) => ({ id: symbolKey(sibling), label: `${symbolKey(sibling) === menu.current ? '● ' : ''}${sibling.name}${sibling.detail ? `  ${sibling.detail}` : ''}` }))}
          onSelect={(id) => {
            const target = menu.siblings.find((sibling) => symbolKey(sibling) === id)
            setMenu(null)
            if (target) reveal(target.selectionRange.startLine, target.selectionRange.startColumn)
          }}
          onClose={() => setMenu(null)}
        />
      )}
      <button type="button" disabled={!document.dirty || document.saving || document.document.readOnly} onClick={onSave} title="Save · Ctrl/Cmd+S" className="ml-auto flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"><Save size={12} /> Save</button>
    </nav>
  )
}

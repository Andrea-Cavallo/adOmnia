import { useState } from 'react'
import { Lock } from 'lucide-react'
import type { GoIDESymbolNode } from '@/lib/goide-lsp-api'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { useGoIDEStore } from '@/stores/goide'
import { GoStudioSymbolIcon } from './GoStudioSymbolIcon'
import { symbolKey, symbolPathAt, symbolSiblings, useGoStudioSymbolsFor } from './goStudioSymbols'

interface GoStudioBreadcrumbProps {
  documentId: string
  relativePath: string
  readOnly: boolean
  cursor: { line: number; column: number }
}

/**
 * Percorso del file seguito dal simbolo che contiene il cursore (tipo › metodo), nella status bar come in IntelliJ:
 * il codice non perde una riga. Ogni simbolo apre l'elenco dei suoi fratelli.
 */
export function GoStudioBreadcrumb({ documentId, relativePath, readOnly, cursor }: GoStudioBreadcrumbProps) {
  const symbols = useGoStudioSymbolsFor(documentId)
  const chain = symbolPathAt(symbols, cursor.line, cursor.column)
  const reveal = (line: number, column: number) => useGoIDEStore.setState({ revealLocation: { documentId, line, column } })
  const segments = relativePath.split('/').filter(Boolean)
  const [menu, setMenu] = useState<{ x: number; y: number; current: string; siblings: GoIDESymbolNode[] } | null>(null)
  const openSiblings = (index: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect()
    setMenu({ x: rect.left, y: rect.bottom + 2, current: symbolKey(chain[index]), siblings: symbolSiblings(symbols, chain, index) })
  }

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center overflow-hidden whitespace-nowrap px-1.5 text-text-3">
      {readOnly && <span className="mr-1.5 flex shrink-0 items-center gap-1 text-text-4" title="SDK and module cache sources open read-only"><Lock size={11} /> Read-only</span>}
      {segments.map((segment, index) => <span key={`${segment}-${index}`} className={index === segments.length - 1 ? 'shrink-0 text-text-2' : 'min-w-0 truncate'}>{index > 0 && <span className="px-1 text-text-4">›</span>}{segment}</span>)}
      {chain.map((node) => (
        <span key={`${node.name}:${node.range.startLine}`} className="flex min-w-0 items-center">
          <span className="px-1 text-text-4">›</span>
          <button type="button" aria-haspopup="menu" title="Jump to another symbol at this level" onClick={(event) => openSiblings(chain.indexOf(node), event.currentTarget)} className="flex h-5 min-w-0 items-center gap-1 rounded px-1 text-text-2 hover:bg-surface-3 hover:text-text-1">
            <GoStudioSymbolIcon kind={node.kind} size={11} /><span className="truncate">{node.name}</span>
          </button>
        </span>
      ))}
      {menu && (
        <ContextMenu
          appearance="studio"
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
    </nav>
  )
}

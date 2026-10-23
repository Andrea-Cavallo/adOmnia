import { useEffect, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { JsonTree } from '@/components/loginspector/JsonTree'
import { bsonScalarText } from './dbValue'
import { DocumentCard } from './mongo/DocumentCard'
import { formatBytes } from './mongo/ui'

/** Richiesta dell'Inspector: una cella (valore) oppure una riga intera (`document`). */
export interface CellInspectorRequest {
  /** Colonna o "Document": nell'header. */
  title: string
  /** Valore grezzo: i tipi BSON devono sopravvivere alla copia. */
  value: unknown
  /** Tipo e dimensione del valore, già leggibili. */
  kind: string
  driver?: string
  /** Riga intera in sola lettura (vista documento, Mongo). */
  document?: Record<string, unknown>
  /** JSON della riga copiabile dal footer. */
  copyText?: string
}

interface ValueInspectorProps {
  request: CellInspectorRequest
  onClose: () => void
}

/**
 * Cell Inspector: drawer di destra con il contenuto della cella (o della riga)
 * navigabile come albero. Esc chiude; "Copy JSON" porta via la struttura vera.
 */
export function ValueInspector({ request, onClose }: ValueInspectorProps) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const copyRow = () => {
    const text = request.copyText ?? ''
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      },
      () => setCopied(false),
    )
  }

  const prettyLength = (() => {
    try {
      return JSON.stringify(request.value ?? request.document ?? null)?.length ?? 0
    } catch {
      return 0
    }
  })()

  return (
    <div className="fixed inset-0 z-[260] flex justify-end bg-black/40" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside role="dialog" aria-modal="true" aria-label={`${request.title} inspector`} className="flex h-full w-[min(560px,65vw)] flex-col border-l border-border-2 bg-surface-1 shadow-2xl">
        <header className="flex h-11 flex-none items-center gap-2 border-b border-border-1 px-3.5">
          <span className="truncate font-mono text-[12px] font-semibold text-text-1">{request.title}</span>
          <span className="rounded border border-border-2 px-1.5 py-px text-[9.5px] uppercase tracking-wide text-text-4">{request.kind}</span>
          <span className="text-[10px] text-text-4">{formatBytes(prettyLength)}</span>
          <button type="button" onClick={onClose} aria-label="Close inspector" className="ml-auto grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={14} /></button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          {request.document ? (
            <div className="min-h-0 flex-1 overflow-auto p-2">
              <DocumentCard doc={request.document} />
            </div>
          ) : (
            <JsonTree
              value={request.value}
              className="min-h-0 flex-1"
              startExpanded={2}
              renderScalar={(value) => bsonScalarText(value) ?? undefined}
            />
          )}
        </div>
        {request.copyText && (
          <footer className="flex h-11 flex-none items-center justify-end gap-2 border-t border-border-1 px-3.5">
            <button
              type="button"
              onClick={copyRow}
              className="flex h-7 items-center gap-1.5 rounded-md border border-border-2 px-2.5 text-[11px] text-text-2 hover:bg-surface-2 hover:text-text-1"
            >
              {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
              Copy row JSON
            </button>
          </footer>
        )}
      </aside>
    </div>
  )
}

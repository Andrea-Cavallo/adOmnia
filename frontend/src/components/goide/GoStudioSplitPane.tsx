import { useState } from 'react'
import { X } from 'lucide-react'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { GoGopherIcon, isGoSource } from './GoGopherIcon'
import { GoStudioCodeEditor } from './GoStudioCodeEditor'
import type { GoStudioRunTarget } from './goStudioRunTargets'

interface GoStudioSplitPaneProps {
  documents: GoIDEEditorDocument[]
  document: GoIDEEditorDocument
  onRunTarget: (target: GoStudioRunTarget) => void
  onCursor: (line: number, column: number) => void
}

/** Secondo pannello editor: stesso modello del file, cursore e scroll indipendenti. */
export function GoStudioSplitPane({ documents, document, onRunTarget, onCursor }: GoStudioSplitPaneProps) {
  const setSplitDocument = useGoIDEStore((state) => state.setSplitDocument)
  const setSplit = useGoIDEStore((state) => state.setSplit)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  return (
    <section aria-label="Split editor" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-0">
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border-1 bg-surface-1 px-2 text-[10px]">
        {isGoSource(document.document.name) && <GoGopherIcon size={12} />}
        <select aria-label="File in split editor" value={document.document.id} onChange={(event) => setSplitDocument(event.target.value)} className="h-6 min-w-0 max-w-64 rounded border border-border-1 bg-surface-2 px-1.5 text-[10px] text-text-1">
          {documents.map((item) => <option key={item.document.id} value={item.document.id}>{item.document.relativePath}{item.dirty ? ' •' : ''}</option>)}
        </select>
        <span className="text-[9px] text-text-4">Ln {cursor.line}, Col {cursor.column}</span>
        <button type="button" onClick={() => setSplit(null)} title="Close split" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={11} /></button>
      </div>
      <div className="min-h-0 flex-1">
        <GoStudioCodeEditor document={document} handlesReveal={false} onRunTarget={onRunTarget} onCursor={(line, column) => { setCursor({ line, column }); onCursor(line, column) }} />
      </div>
    </section>
  )
}

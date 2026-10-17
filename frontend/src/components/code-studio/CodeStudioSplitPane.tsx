import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { CodeStudioFileIcon } from './CodeStudioFileIcon'
import { CodeStudioCodeEditor } from './CodeStudioCodeEditor'
import { CodeStudioMarkdownDocument, isMarkdownDocument } from './CodeStudioMarkdownView'
import type { CodeStudioRunTargetHandler } from './codeStudioRunTargets'

interface CodeStudioSplitPaneProps {
  documents: GoIDEEditorDocument[]
  document: GoIDEEditorDocument
  onRunTarget: CodeStudioRunTargetHandler
  onCursor: (line: number, column: number) => void
}

/**
 * Secondo pannello editor con il proprio gruppo di tab: stesso modello del file del pannello principale,
 * ma cursore, scroll e selezione indipendenti. Chiudere un tab qui non chiude il file.
 */
export function CodeStudioSplitPane({ documents, document, onRunTarget, onCursor }: CodeStudioSplitPaneProps) {
  const setSplitDocument = useCodeStudioStore((state) => state.setSplitDocument)
  const closeSplitTab = useCodeStudioStore((state) => state.closeSplitTab)
  const setSplit = useCodeStudioStore((state) => state.setSplit)
  const tabIds = useCodeStudioStore((state) => (state.activeSessionId ? state.splitBySession[state.activeSessionId]?.tabs : undefined))
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null)
  const tabs = (tabIds ?? [document.document.id]).map((id) => documents.find((item) => item.document.id === id)).filter((item): item is GoIDEEditorDocument => !!item)
  const addable = documents.filter((item) => !tabs.some((tab) => tab.document.id === item.document.id))

  return (
    <section aria-label="Split editor" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div role="tablist" aria-label="Split editor tabs" className="flex h-8 shrink-0 items-stretch border-b border-border-1 text-[10px]">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tabs.map((tab) => {
            const selected = tab.document.id === document.document.id
            return (
              <div key={tab.document.id} role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} onClick={() => setSplitDocument(tab.document.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSplitDocument(tab.document.id); return }
                  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
                  if (!step) return
                  event.preventDefault()
                  const target = tabs[(tabs.findIndex((item) => item.document.id === tab.document.id) + step + tabs.length) % tabs.length]
                  setSplitDocument(target.document.id)
                  requestAnimationFrame(() => (event.currentTarget.parentElement?.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus())
                }}
                title={tab.document.relativePath}
                className={`group flex max-w-48 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border-1 px-2 ${selected ? 'border-b border-b-accent bg-[var(--gs-raised)] text-text-1' : 'text-text-3 hover:text-text-1'}`}>
                <CodeStudioFileIcon name={tab.document.name} relativePath={tab.document.relativePath} size={11} />
                <span className="truncate">{tab.document.name}</span>
                {tab.dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="unsaved" />}
                <button type="button" aria-label={`Close ${tab.document.name} in split`} title="Close in split" onClick={(event) => { event.stopPropagation(); closeSplitTab(tab.document.id) }}
                  className="grid h-4 w-4 shrink-0 place-items-center rounded text-text-4 opacity-0 hover:bg-surface-3 hover:text-text-1 group-hover:opacity-100 focus:opacity-100"><X size={9} /></button>
              </div>
            )
          })}
        </div>
        {addable.length > 0 && (
          <button type="button" aria-haspopup="menu" aria-expanded={!!addMenu} aria-label="Open file in split" title="Open another file in the split" className="grid w-7 shrink-0 place-items-center border-l border-border-1 text-text-3 hover:bg-surface-3 hover:text-text-1"
            onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setAddMenu({ x: rect.left, y: rect.bottom + 4 }) }}><Plus size={12} /></button>
        )}
        <span className="flex shrink-0 items-center px-2 text-[9px] text-text-4">Ln {cursor.line}, Col {cursor.column}</span>
        <button type="button" onClick={() => setSplit(null)} title="Close split" aria-label="Close split" className="grid w-7 shrink-0 place-items-center text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={11} /></button>
      </div>
      {addMenu && <ContextMenu appearance="studio" x={addMenu.x} y={addMenu.y} items={addable.map((item) => ({ id: item.document.id, label: `${item.document.relativePath}${item.dirty ? ' •' : ''}` }))} onSelect={(id) => { setAddMenu(null); setSplitDocument(id) }} onClose={() => setAddMenu(null)} />}
      <div className="min-h-0 flex-1">
        {(() => {
          const editor = <CodeStudioCodeEditor document={document} handlesReveal={false} onRunTarget={onRunTarget} onCursor={(line, column) => { setCursor({ line, column }); onCursor(line, column) }} />
          return isMarkdownDocument(document) ? <CodeStudioMarkdownDocument document={document} editor={editor} /> : editor
        })()}
      </div>
    </section>
  )
}

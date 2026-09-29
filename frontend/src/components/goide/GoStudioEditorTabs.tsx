import { useMemo, useState } from 'react'
import { ArrowRightToLine, Columns2, Lock, Pin, RotateCcw, Rows2, SquareDashed, Trash2, X } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { GoStudioFileIcon } from './GoStudioFileIcon'

interface GoStudioEditorTabsProps {
  documents: GoIDEEditorDocument[]
  activeId: string
  onRequestClose: (documents: GoIDEEditorDocument[]) => void
}

type TabAction = 'pin' | 'close' | 'closeOthers' | 'closeRight' | 'closeAll' | 'reopen' | 'splitRight' | 'splitDown'

/** Ordina le tab con quelle fissate in testa, mantenendo l'ordine di apertura. */
export function orderTabs(documents: GoIDEEditorDocument[], pinned: Record<string, boolean>): GoIDEEditorDocument[] {
  return [...documents.filter((item) => pinned[item.document.id]), ...documents.filter((item) => !pinned[item.document.id])]
}

/** Per i nomi ripetuti (es. due main.go) restituisce la cartella che li distingue, come GoLand. */
export function tabQualifiers(documents: GoIDEEditorDocument[]): Record<string, string> {
  const counts = new Map<string, number>()
  for (const item of documents) counts.set(item.document.name, (counts.get(item.document.name) ?? 0) + 1)
  const qualifiers: Record<string, string> = {}
  for (const item of documents) {
    if ((counts.get(item.document.name) ?? 0) < 2) continue
    const parts = (item.document.relativePath || item.document.path).split('/')
    qualifiers[item.document.id] = parts.length > 1 ? parts[parts.length - 2] : '/'
  }
  return qualifiers
}

/** Documenti interessati da un'azione di chiusura multipla: le tab fissate restano aperte. */
export function documentsToClose(action: TabAction, ordered: GoIDEEditorDocument[], target: GoIDEEditorDocument, pinned: Record<string, boolean>): GoIDEEditorDocument[] {
  const closable = (item: GoIDEEditorDocument) => !pinned[item.document.id]
  switch (action) {
    case 'close': return [target]
    case 'closeOthers': return ordered.filter((item) => item.document.id !== target.document.id && closable(item))
    case 'closeRight': return ordered.slice(ordered.findIndex((item) => item.document.id === target.document.id) + 1).filter(closable)
    case 'closeAll': return ordered.filter(closable)
    default: return []
  }
}

export function GoStudioEditorTabs({ documents, activeId, onRequestClose }: GoStudioEditorTabsProps) {
  const pinned = useGoIDEStore((state) => state.pinnedDocuments)
  const hasClosed = useGoIDEStore((state) => (state.activeSessionId ? (state.closedDocuments[state.activeSessionId]?.length ?? 0) > 0 : false))
  const selectDocument = useGoIDEStore((state) => state.selectDocument)
  const [menu, setMenu] = useState<{ x: number; y: number; document: GoIDEEditorDocument } | null>(null)
  const ordered = useMemo(() => orderTabs(documents, pinned), [documents, pinned])
  const qualifiers = useMemo(() => tabQualifiers(documents), [documents])

  const items = (target: GoIDEEditorDocument): ContextMenuItem[] => {
    const index = ordered.findIndex((item) => item.document.id === target.document.id)
    return [
      { id: 'pin', label: pinned[target.document.id] ? 'Unpin Tab' : 'Pin Tab', icon: Pin },
      { id: 'close', label: 'Close', shortcut: 'Ctrl+W', icon: X, separatorBefore: true },
      { id: 'closeOthers', label: 'Close Other Tabs', icon: SquareDashed, disabled: ordered.length < 2 },
      { id: 'closeRight', label: 'Close Tabs to the Right', icon: ArrowRightToLine, disabled: index === ordered.length - 1 },
      { id: 'closeAll', label: 'Close All Tabs', icon: Trash2 },
      { id: 'reopen', label: 'Reopen Closed Tab', icon: RotateCcw, shortcut: 'Ctrl+Shift+T', disabled: !hasClosed, disabledReason: 'No recently closed tabs', separatorBefore: true },
      { id: 'splitRight', label: 'Split Right', icon: Columns2, separatorBefore: true },
      { id: 'splitDown', label: 'Split Down', icon: Rows2 },
    ]
  }

  const run = (action: TabAction, target: GoIDEEditorDocument) => {
    setMenu(null)
    const store = useGoIDEStore.getState()
    if (action === 'pin') return store.togglePinned(target.document.id)
    if (action === 'reopen') return void store.reopenClosedDocument()
    if (action === 'splitRight' || action === 'splitDown') {
      store.selectDocument(target.document.id)
      return store.setSplit(action === 'splitRight' ? 'right' : 'down')
    }
    const targets = documentsToClose(action, ordered, target, pinned)
    if (targets.length) onRequestClose(targets)
  }

  return (
    <div role="tablist" aria-label="Open files" className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto px-2">
      {ordered.map((item) => {
        const active = item.document.id === activeId
        const isPinned = !!pinned[item.document.id]
        return (
          <button
            key={item.document.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => selectDocument(item.document.id)}
            // Come negli IDE JetBrains: doppio clic sulla tab massimizza l'editor, un altro lo ripristina.
            onDoubleClick={() => useGoIDEStore.getState().toggleEditorMaximized()}
            onAuxClick={(event) => { if (event.button === 1 && !isPinned) onRequestClose([item]) }}
            onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, document: item }) }}
            className="go-studio-tab group"
            title={item.document.relativePath}
          >
            <GoStudioFileIcon name={item.document.name} relativePath={item.document.relativePath} size={13} />
            {item.document.readOnly && <Lock size={11} className="shrink-0 text-text-4" />}
            <span className="truncate">{item.document.name}</span>
            {qualifiers[item.document.id] && <span className="shrink-0 text-[11px] text-text-4">{qualifiers[item.document.id]}</span>}
            {item.dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="Unsaved changes" />}
            {isPinned
              ? <Pin size={11} className="shrink-0 rotate-45 text-accent" aria-label="Pinned" />
              : <span role="button" tabIndex={-1} aria-label={`Close ${item.document.name}`} onClick={(event) => { event.stopPropagation(); onRequestClose([item]) }} className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded hover:bg-surface-3 hover:text-text-1 ${active ? 'opacity-80' : 'opacity-0 group-hover:opacity-100'}`}><X size={12} /></span>}
          </button>
        )
      })}
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={items(menu.document)} onSelect={(id) => run(id as TabAction, menu.document)} onClose={() => setMenu(null)} />}
    </div>
  )
}

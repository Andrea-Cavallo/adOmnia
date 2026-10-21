import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowRightToLine, Columns2, Globe, Lock, Pin, RotateCcw, Rows2, SquareDashed, Trash2, X } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { CodeStudioFileIcon } from './CodeStudioFileIcon'

interface CodeStudioEditorTabsProps {
  documents: GoIDEEditorDocument[]
  activeId: string
  onRequestClose: (documents: GoIDEEditorDocument[]) => void
  /** Azioni fisse a destra della riga: restano visibili anche quando le tab scorrono. */
  actions?: ReactNode
  /** Tab virtuale della Live Preview accanto ai file; assente se la preview non è in una tab. */
  previewTab?: { active: boolean; label: string; onSelect: () => void; onClose: () => void }
  /** Chiamata quando si seleziona un file: la tab della preview smette di essere quella attiva. */
  onSelectDocument?: () => void
}

type TabAction = 'pin' | 'close' | 'closeOthers' | 'closeRight' | 'closeAll' | 'reopen' | 'splitRight' | 'splitDown'

/** Ordina le tab con quelle fissate in testa, mantenendo l'ordine di apertura. */
export function orderTabs(documents: GoIDEEditorDocument[], pinned: Record<string, boolean>): GoIDEEditorDocument[] {
  return [...documents.filter((item) => pinned[item.document.id]), ...documents.filter((item) => !pinned[item.document.id])]
}

/** Per i nomi ripetuti (es. due main.go) restituisce la cartella che li distingue. */
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

/** Slot di chiusura a larghezza fissa: a riposo mostra il punto di modifica, al passaggio del mouse la X. */
function TabCloseButton({ label, dirty = false, onClose }: { label: string; dirty?: boolean; onClose: () => void }) {
  return (
    <span role="button" tabIndex={-1} aria-label={label} onClick={(event) => { event.stopPropagation(); onClose() }} className="code-studio-tab-close">
      {dirty && <span className="code-studio-tab-dirty" title="Unsaved changes" />}
      <X size={12} className="code-studio-tab-x" />
    </span>
  )
}

export function CodeStudioEditorTabs({ documents, activeId, onRequestClose, actions, previewTab, onSelectDocument }: CodeStudioEditorTabsProps) {
  const pinned = useCodeStudioStore((state) => state.pinnedDocuments)
  const multiline = useCodeStudioLspStore((state) => state.preferences.multilineTabs)
  const hasClosed = useCodeStudioStore((state) => (state.activeSessionId ? (state.closedDocuments[state.activeSessionId]?.length ?? 0) > 0 : false))
  const selectDocument = useCodeStudioStore((state) => state.selectDocument)
  const [menu, setMenu] = useState<{ x: number; y: number; document: GoIDEEditorDocument } | null>(null)
  const ordered = useMemo(() => orderTabs(documents, pinned), [documents, pinned])
  const listRef = useRef<HTMLDivElement>(null)
  // Con molte tab aperte quella attiva (Ctrl+Tab, Search Everywhere…) può stare fuori dalla riga visibile.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [activeId])
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number | undefined> = { ArrowRight: 1, ArrowLeft: -1 }
    const current = ordered.findIndex((item) => item.document.id === activeId)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? ordered.length - 1 : keys[event.key] === undefined ? -1 : current + (keys[event.key] as number)
    if (next < 0 || next >= ordered.length || current < 0) return
    event.preventDefault()
    selectDocument(ordered[next].document.id)
    onSelectDocument?.()
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus())
  }
  const previewId = useCodeStudioStore((state) => (ordered[0] ? state.previewDocumentBySession[ordered[0].document.sessionId] ?? null : null))
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
    const store = useCodeStudioStore.getState()
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
    <div className={`code-studio-editor-tabbar flex min-w-0 shrink-0 items-stretch border-b border-border-1 ${multiline ? 'code-studio-editor-tabbar--multiline' : 'h-[36px]'}`}>
    <div ref={listRef} role="tablist" aria-label="Open files" onKeyDown={moveFocus} className="code-studio-editor-tablist flex min-w-0 flex-1 items-stretch overflow-x-auto px-1">
      {ordered.map((item) => {
        const active = item.document.id === activeId && !previewTab?.active
        const isPinned = !!pinned[item.document.id]
        return (
          <button
            key={item.document.id}
            type="button"
            role="tab"
            aria-selected={active && !previewTab?.active}
            tabIndex={active ? 0 : -1}
            onClick={() => { selectDocument(item.document.id); onSelectDocument?.() }}
            // Doppio clic sulla tab massimizza l'editor, un altro lo ripristina.
            onDoubleClick={() => useCodeStudioStore.getState().toggleEditorMaximized()}
            onAuxClick={(event) => { if (event.button === 1 && !isPinned) onRequestClose([item]) }}
            onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, document: item }) }}
            className="code-studio-tab group"
            title={item.document.relativePath}
          >
            <CodeStudioFileIcon name={item.document.name} relativePath={item.document.relativePath} size={13} />
            {item.document.readOnly && <Lock size={11} className="shrink-0 text-text-4" />}
            <span className={`truncate ${item.document.id === previewId ? 'italic' : ''}`} title={item.document.id === previewId ? 'Preview tab: edit it or double-click the file to keep it open' : undefined}>{item.document.name}</span>
            {qualifiers[item.document.id] && <span className="shrink-0 text-[11px] text-text-4">{qualifiers[item.document.id]}</span>}
            {isPinned
              ? <span className="code-studio-tab-close" aria-label="Pinned">{item.dirty ? <span className="code-studio-tab-dirty" title="Unsaved changes" /> : <Pin size={11} className="rotate-45 text-text-3" />}</span>
              : <TabCloseButton label={`Close ${item.document.name}`} dirty={item.dirty} onClose={() => onRequestClose([item])} />}
          </button>
        )
      })}
      {previewTab && (
        <button type="button" role="tab" aria-selected={previewTab.active} onClick={previewTab.onSelect} className="code-studio-tab group" title="Live Preview">
          <Globe size={13} className="shrink-0 text-text-3" aria-hidden="true" />
          <span className="truncate">{previewTab.label}</span>
          <TabCloseButton label="Close Live Preview" onClose={previewTab.onClose} />
        </button>
      )}
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={items(menu.document)} onSelect={(id) => run(id as TabAction, menu.document)} onClose={() => setMenu(null)} />}
    </div>
    {actions}
    </div>
  )
}

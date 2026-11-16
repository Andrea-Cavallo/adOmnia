import { useState, type ReactNode } from 'react'
import { observer } from 'mobx-react-lite'
import {
  ArrowDown, ArrowUp, Code2, Copy, Group, Loader2, MousePointerClick, Redo2, Save, Square, Trash2, Type, Undo2, Ungroup, X,
  type LucideIcon,
} from 'lucide-react'
import { EditorMode, InsertMode } from '@onlook/models'
import { confirm } from '@/lib/confirmDialog'
import { useCodeStudioStore } from '@/stores/codeStudio'
import type { DesignSession } from '../adapters/design-session'
import { notices } from '../adapters/notices'
import { DesignInspector } from './DesignInspector'
import { DesignLayers } from './DesignLayers'

const ICON_BUTTON = 'code-studio-icon-button h-6 w-6 shrink-0'
const TEXT_BUTTON = 'h-6 rounded px-2 text-[11px] text-text-2 hover:bg-surface-3 hover:text-text-1 disabled:pointer-events-none disabled:opacity-40'
const PRIMARY_BUTTON = 'h-7 rounded bg-accent px-2.5 text-[11.5px] font-semibold text-on-accent hover:opacity-90 disabled:opacity-50'

type Tab = 'style' | 'layers'

interface ToolProps {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
}

function Tool({ icon: Icon, label, onClick, disabled, pressed }: ToolProps) {
  return (
    <button type="button" className={`${ICON_BUTTON} ${pressed ? 'bg-surface-3 text-accent' : ''}`} disabled={disabled} aria-pressed={pressed} aria-label={label} title={label} onClick={onClick}>
      <Icon size={13} />
    </button>
  )
}

function Check({ checked, onChange, children, title }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode; title: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-2" title={title}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="accent-[var(--color-accent)]" />
      {children}
    </label>
  )
}

/** Text of the selected element, written back as JSX text when the source allows it. */
const TextField = observer(function TextField({ session }: { session: DesignSession }) {
  const { engine, frame } = session
  const selected = engine.elements.selected[0]
  const layer = selected ? engine.ast.mappings.getLayerNode(frame.id, selected.domId) : undefined
  const original = layer?.textContent ?? ''
  const [draft, setDraft] = useState(original)
  if (!selected || !session.support?.text) return null
  const commit = () => {
    if (draft === original) return
    void engine.action.run({
      type: 'edit-text',
      targets: [{ frameId: selected.frameId, branchId: selected.branchId, domId: selected.domId, oid: selected.oid }],
      originalContent: original,
      newContent: draft,
    })
  }
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-text-2">Text</span>
      <textarea
        value={draft} rows={2} spellCheck={false} onChange={(event) => setDraft(event.target.value)} onBlur={commit}
        className="min-h-[44px] resize-y rounded bg-[var(--gs-ground)] px-1.5 py-1 text-[11.5px] text-text-1 outline-none focus:ring-1 focus:ring-accent"
      />
    </label>
  )
})

/** Unsaved visual edits waiting in the editor (review mode). */
function PendingChanges({ sessionId }: { sessionId: string }) {
  const dirty = useCodeStudioStore((state) => state.documents.filter((item) => item.document.sessionId === sessionId && item.dirty).length)
  if (dirty === 0) return null
  return (
    <div className="flex items-center gap-2 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] text-text-2" role="status">
      <span className="min-w-0 flex-1">{dirty} file{dirty === 1 ? '' : 's'} changed, not saved. Review the diff in the editor tabs.</span>
      <button type="button" className={TEXT_BUTTON} onClick={() => { void useCodeStudioStore.getState().saveAllDocuments(sessionId) }}><Save size={11} className="mr-1 inline" />Save all</button>
    </div>
  )
}

interface DesignPanelProps {
  session: DesignSession
  onClose: () => void
}

/**
 * Design Mode side panel: setup, the actions on the selection, the style inspector and the
 * layers. All state lives in the session; the panel only renders it and calls the engine.
 */
const DesignPanel = observer(function DesignPanel({ session, onClose }: DesignPanelProps) {
  const { engine } = session
  const [tab, setTab] = useState<Tab>('style')
  const selected = engine.elements.selected[0]
  const support = session.support
  const structure = !!selected && !!support?.structure
  const history = engine.history

  const arm = (mode: InsertMode) => {
    const active = engine.state.insertMode === mode
    engine.state.insertMode = active ? null : mode
    // Any mode but Design makes the next press on the canvas draw the new element.
    engine.state.editorMode = active ? EditorMode.DESIGN : EditorMode.PAN
  }

  const removeIds = async () => {
    const ok = await confirm({
      title: 'Remove design ids',
      message: 'This removes the data-oid attributes Design Mode added to the JSX of this project and turns Design Mode off. Your other changes stay.',
      confirmLabel: 'Remove ids',
    })
    if (!ok) return
    const failed = await session.removeIds()
    if (failed.length > 0) notices.error(`${failed.length} file(s) still contain ids`, failed.slice(0, 5).join(', '))
    else onClose()
  }

  return (
    <aside aria-label="Design Mode" className="flex h-full w-64 shrink-0 flex-col border-l border-border-1 bg-surface-1">
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-border-1 px-2">
        <span className="flex-1 text-[11.5px] font-medium text-text-1">Design</span>
        <Tool icon={Undo2} label="Undo design change (Ctrl+Z on the canvas)" disabled={!history.canUndo} onClick={() => { void session.undo() }} />
        <Tool icon={Redo2} label="Redo design change (Ctrl+Shift+Z on the canvas)" disabled={!history.canRedo} onClick={() => { void session.redo() }} />
        <Tool icon={X} label="Close Design Mode" onClick={onClose} />
      </header>

      {session.status === 'scanning' && <p className="flex items-center gap-2 p-3 text-[11.5px] text-text-3" role="status"><Loader2 size={12} className="animate-spin" /> Reading the project sources…</p>}

      {session.status === 'failed' && (
        <div className="flex flex-col gap-2 p-3 text-[11.5px] text-text-2" role="alert">
          <p>Design Mode could not read the project: {session.error}</p>
          <button type="button" className={PRIMARY_BUTTON} onClick={() => { void session.prepare() }}>Try again</button>
        </div>
      )}

      {(session.status === 'needs-ids' || session.status === 'writing-ids') && session.plan && (
        <div className="flex flex-col gap-2 p-3 text-[11.5px] leading-relaxed text-text-2">
          <p className="font-medium text-text-1">Link the page to your source</p>
          <p>To know which line renders each element, Design Mode adds a <code className="font-mono text-text-1">data-oid</code> attribute to the JSX elements of {session.plan.pending.length} of {session.plan.total} source file{session.plan.total === 1 ? '' : 's'}.</p>
          <p className="text-text-3">Nothing else in those files changes, the files are saved, and you can remove the ids at any time. They show up as ordinary changes in Git.</p>
          <button type="button" className={PRIMARY_BUTTON} disabled={session.status === 'writing-ids'} onClick={() => { void session.addIds() }}>
            {session.status === 'writing-ids' ? 'Adding ids…' : `Add ids to ${session.plan.pending.length} file${session.plan.pending.length === 1 ? '' : 's'}`}
          </button>
          <button type="button" className={TEXT_BUTTON} disabled={session.status === 'writing-ids'} onClick={onClose}>Not now</button>
        </div>
      )}

      {session.status === 'ready' && (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border-1 px-2 py-1" role="toolbar" aria-label="Design tools">
            <Tool icon={MousePointerClick} label="Interact with the page instead of selecting" pressed={session.interact} onClick={() => { session.interact = !session.interact }} />
            <Tool icon={Square} label="Draw a box" pressed={engine.state.insertMode === InsertMode.INSERT_DIV} onClick={() => arm(InsertMode.INSERT_DIV)} />
            <Tool icon={Type} label="Draw a text block" pressed={engine.state.insertMode === InsertMode.INSERT_TEXT} onClick={() => arm(InsertMode.INSERT_TEXT)} />
            <span className="mx-1 h-4 w-px bg-border-1" aria-hidden="true" />
            <Tool icon={Code2} label="Open the source of the selection (Enter, or double-click)" disabled={!support?.source} onClick={() => session.openSource(selected?.instanceId ?? selected?.oid)} />
            <Tool icon={Copy} label="Duplicate (Ctrl+D)" disabled={!structure} onClick={() => { void engine.copy.duplicate() }} />
            <Tool icon={ArrowUp} label="Move before the previous element" disabled={!structure} onClick={() => { void engine.move.moveSelected('up') }} />
            <Tool icon={ArrowDown} label="Move after the next element" disabled={!structure} onClick={() => { void engine.move.moveSelected('down') }} />
            <Tool icon={Group} label="Wrap in a container" disabled={!structure || !engine.group.canGroupElements()} onClick={() => { void engine.group.groupSelectedElements() }} />
            <Tool icon={Ungroup} label="Unwrap the container" disabled={!structure || !engine.group.canUngroupElement()} onClick={() => { void engine.group.ungroupSelectedElement() }} />
            <Tool icon={Trash2} label="Delete (Del)" disabled={!structure} onClick={() => { void engine.elements.delete() }} />
          </div>

          <div className="flex shrink-0 items-center gap-1 border-b border-border-1 px-2" role="tablist" aria-label="Design panel">
            {(['style', 'layers'] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`h-7 border-b-2 px-1.5 text-[11.5px] capitalize ${tab === id ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-1'}`}>{id}</button>
            ))}
            {!session.connected && <span className="ml-auto flex items-center gap-1 text-[10.5px] text-text-4" role="status"><Loader2 size={10} className="animate-spin" /> Connecting</span>}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2">
            {notices.items.map((notice) => (
              <div key={notice.id} role={notice.kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-1 rounded border px-2 py-1 text-[11px] ${notice.kind === 'error' ? 'border-danger/30 bg-danger/10' : 'border-border-2 bg-surface-2'} text-text-2`}>
                <span className="min-w-0 flex-1"><span className="font-medium text-text-1">{notice.title}</span>{notice.description ? `: ${notice.description}` : ''}</span>
                <button type="button" className="shrink-0 text-text-4 hover:text-text-1" aria-label="Dismiss" onClick={() => notices.dismiss(notice.id)}><X size={11} /></button>
              </div>
            ))}
            {!session.autoSave && <PendingChanges sessionId={session.sessionId} />}

            {tab === 'layers' && <DesignLayers session={session} />}

            {tab === 'style' && !selected && <p className="px-1 text-[11.5px] leading-relaxed text-text-3">Click an element in the page to select it. Double-click opens its source; drag the selected element to reorder it.</p>}

            {tab === 'style' && selected && (
              <>
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[11.5px] text-text-1">&lt;{selected.tagName.toLowerCase()}&gt;{support?.source?.component ? ` in ${support.source.component}` : ''}</span>
                  {support?.source && (
                    <button type="button" className="truncate text-left font-mono text-[10.5px] text-accent hover:underline" title="Open in the editor" onClick={() => session.openSource(selected.instanceId ?? selected.oid)}>
                      {support.source.path}:{support.source.line}
                    </button>
                  )}
                  <span className="font-mono text-[10.5px] text-text-4">{Math.round(selected.rect.width)} × {Math.round(selected.rect.height)}</span>
                </div>
                {support?.reason && <p className="rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] leading-relaxed text-text-2" role="note">{support.reason}</p>}
                {support && !support.source && <button type="button" className={`${TEXT_BUTTON} self-start`} title="Read the project sources again, for example after reverting files or switching branch" onClick={() => { void session.prepare() }}>Rescan sources</button>}
                <TextField key={selected.domId} session={session} />
                <DesignInspector session={session} />
              </>
            )}
          </div>

          <footer className="flex shrink-0 flex-col gap-1 border-t border-border-1 px-2 py-1.5">
            <Check checked={session.autoSave} onChange={(value) => { session.autoSave = value }} title="On: every change is saved and hot-reloaded. Off: changes stay unsaved in the editor so you can review the diff first.">Save changes automatically</Check>
            <Check checked={session.followInEditor} onChange={(value) => { session.followInEditor = value }} title="Reveal the source of each element you select">Follow selection in the editor</Check>
            <button type="button" className={`${TEXT_BUTTON} self-start px-0 text-text-4`} onClick={() => { void removeIds() }}>Remove design ids…</button>
          </footer>
        </>
      )}
    </aside>
  )
})

export default DesignPanel

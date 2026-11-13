/**
 * The Diagram Studio command bar: pick, create, import and export diagrams, undo/redo, auto-layout,
 * the save state and the inspector toggle.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDownFromLine, ArrowRightFromLine, Check, ChevronDown, CloudAlert, Download, FilePlus2, FolderOpen, Loader2, PanelRight, Redo2, Trash2, Undo2, Upload,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { confirm } from '@/lib/confirmDialog'
import { exportDiagram, type ExportFormat } from '@/lib/diagrams/export'
import { DIAGRAM_TEMPLATES } from '@/lib/diagrams/templates'
import { useDiagramStudio } from '@/stores/diagramStudio'
import { useDiagramUi } from '@/stores/diagramStudioUi'
import { shortcutLabel } from './diagramActions'

/** A button that opens a small list below it; closes on pick, outside click or Escape. */
function Dropdown({ label, icon, title, children }: { label: string; icon: ReactNode; title: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (event: Event) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div ref={ref} className="diagram-dropdown">
      <button type="button" className="diagram-bar-button" title={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {icon}<span>{label}</span><ChevronDown size={11} />
      </button>
      {open && <div className="diagram-menu diagram-menu--dropdown" role="menu">{children(() => setOpen(false))}</div>}
    </div>
  )
}

function SaveState() {
  const status = useDiagramStudio((state) => state.saveStatus)
  const error = useDiagramStudio((state) => state.saveError)
  const flush = useDiagramStudio((state) => state.flush)
  if (status === 'error') {
    return (
      <button type="button" className="diagram-save diagram-save--error" onClick={() => void flush()} title={`${error} · click to retry`}>
        <CloudAlert size={12} /> Not saved · retry
      </button>
    )
  }
  const label = { saved: 'Saved', pending: 'Unsaved changes', saving: 'Saving…' }[status]
  return (
    <span className={cn('diagram-save', status === 'saved' && 'diagram-save--ok')} role="status">
      {status === 'saving' ? <Loader2 size={12} className="animate-spin" /> : status === 'saved' ? <Check size={12} /> : <span className="diagram-save-dot" />}
      {label}
    </span>
  )
}

export function DiagramTopBar({ canvas }: { canvas: () => HTMLElement | null }) {
  const doc = useDiagramStudio((state) => state.doc)
  const summaries = useDiagramStudio((state) => state.summaries)
  const canUndo = useDiagramStudio((state) => state.history.past.length > 0)
  const canRedo = useDiagramStudio((state) => state.history.future.length > 0)
  const store = useDiagramStudio.getState
  const inspectorOpen = useDiagramUi((state) => state.inspectorOpen)
  const toggleInspector = useDiagramUi((state) => state.toggleInspector)
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const runExport = async (format: ExportFormat) => {
    if (!doc) return
    setBusy(true)
    try {
      await store().flush()
      const background = getComputedStyle(document.documentElement).getPropertyValue('--color-surface-0').trim() || '#111214'
      const viewport = canvas()?.querySelector<HTMLElement>('.react-flow__viewport') ?? null
      await exportDiagram(store().doc ?? doc, format, viewport, background)
    } catch (error) {
      useDiagramStudio.setState({ notice: `Export failed: ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setBusy(false)
    }
  }

  const removeCurrent = async () => {
    if (!doc) return
    const ok = await confirm({ title: 'Delete diagram', message: `Delete “${doc.name}”? It cannot be undone.`, confirmLabel: 'Delete', variant: 'danger' })
    if (ok) await store().remove(doc.id)
  }

  return (
    <div className="diagram-bar" role="toolbar" aria-label="Diagram">
      <Dropdown label={doc?.name ?? 'Diagrams'} icon={<FolderOpen size={13} />} title="Open a saved diagram">
        {(close) => (
          <>
            {summaries.map((summary) => (
              <button key={summary.id} type="button" role="menuitem" className={summary.id === doc?.id ? 'is-current' : undefined} onClick={() => { close(); void store().open(summary.id) }}>
                <span className="truncate">{summary.name}</span>
                <kbd>{summary.nodeCount} shapes</kbd>
              </button>
            ))}
            {summaries.length === 0 && <p className="diagram-empty-hint">No saved diagrams yet.</p>}
          </>
        )}
      </Dropdown>
      <Dropdown label="New" icon={<FilePlus2 size={13} />} title="New diagram, blank or from a template">
        {(close) => (
          <>
            <button type="button" role="menuitem" onClick={() => { close(); void store().create() }}>Blank diagram</button>
            <div className="diagram-menu-divider" role="separator" />
            {DIAGRAM_TEMPLATES.map((template) => (
              <button key={template.id} type="button" role="menuitem" title={template.description} onClick={() => { close(); void store().create(template.id) }}>
                <span className="diagram-menu-title">{template.label}<small>{template.description}</small></span>
              </button>
            ))}
          </>
        )}
      </Dropdown>
      <span className="diagram-bar-divider" aria-hidden="true" />
      <button type="button" className="diagram-bar-icon" onClick={() => store().undo()} disabled={!canUndo} title={`Undo (${shortcutLabel('Mod+Z')})`} aria-label="Undo"><Undo2 size={14} /></button>
      <button type="button" className="diagram-bar-icon" onClick={() => store().redo()} disabled={!canRedo} title={`Redo (${shortcutLabel('Mod+Shift+Z')})`} aria-label="Redo"><Redo2 size={14} /></button>
      <span className="diagram-bar-divider" aria-hidden="true" />
      <button type="button" className="diagram-bar-button" onClick={() => void store().layout('RIGHT')} disabled={!doc?.nodes.length} title="Auto-layout left to right (ELK)"><ArrowRightFromLine size={13} /><span>Layout</span></button>
      <button type="button" className="diagram-bar-icon" onClick={() => void store().layout('DOWN')} disabled={!doc?.nodes.length} title="Auto-layout top to bottom (ELK)" aria-label="Auto-layout top to bottom"><ArrowDownFromLine size={14} /></button>
      <div className="diagram-bar-spacer" />
      <SaveState />
      <button type="button" className="diagram-bar-button" onClick={() => fileInput.current?.click()} title="Import an .adomnia-diagram.json file"><Upload size={13} /><span>Import</span></button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void file.text().then((text) => store().importJson(text))
        }}
      />
      <Dropdown label={busy ? 'Exporting…' : 'Export'} icon={<Download size={13} />} title="Export the whole diagram">
        {(close) => (
          <>
            <button type="button" role="menuitem" onClick={() => { close(); void runExport('png') }}>PNG image<kbd>2×</kbd></button>
            <button type="button" role="menuitem" onClick={() => { close(); void runExport('svg') }}>SVG vector</button>
            <button type="button" role="menuitem" onClick={() => { close(); void runExport('json') }}>adOmnia JSON<kbd>re-importable</kbd></button>
          </>
        )}
      </Dropdown>
      <button type="button" className="diagram-bar-icon" onClick={() => void removeCurrent()} disabled={!doc} title="Delete this diagram" aria-label="Delete this diagram"><Trash2 size={14} /></button>
      <button type="button" className={cn('diagram-bar-icon', inspectorOpen && 'is-active')} onClick={toggleInspector} title="Show or hide the properties" aria-label="Toggle properties" aria-pressed={inspectorOpen}><PanelRight size={14} /></button>
    </div>
  )
}

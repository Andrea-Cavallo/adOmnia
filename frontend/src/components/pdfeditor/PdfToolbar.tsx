import {
  MousePointer2, Type, Highlighter, Square, Circle, Minus, ArrowUpRight,
  Pencil, PenTool, Save, Download, FolderOpen, ZoomIn, ZoomOut, Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PdfToolId } from '@/lib/pdf/annotationModel'

interface ToolDef {
  id: PdfToolId
  icon: React.ElementType
  label: string
}

const TOOLS: ToolDef[] = [
  { id: 'select', icon: MousePointer2, label: 'Select / move' },
  { id: 'text', icon: Type, label: 'Text' },
  { id: 'highlight', icon: Highlighter, label: 'Highlight' },
  { id: 'rect', icon: Square, label: 'Rectangle' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse' },
  { id: 'line', icon: Minus, label: 'Line' },
  { id: 'arrow', icon: ArrowUpRight, label: 'Arrow' },
  { id: 'ink', icon: Pencil, label: 'Draw' },
  { id: 'signature', icon: PenTool, label: 'Signature' },
]

const SWATCHES = ['#e11d48', '#2563eb', '#16a34a', '#facc15', '#111111', '#ffffff']

interface PdfToolbarProps {
  hasDoc: boolean
  tool: PdfToolId
  color: string
  zoom: number
  pageCount: number
  selectedId: string | null
  saving: boolean
  exporting: boolean
  onToolChange: (t: PdfToolId) => void
  onColorChange: (c: string) => void
  onZoom: (dir: 'in' | 'out' | 'reset') => void
  onOpenFile: () => void
  onSave: () => void
  onExport: () => void
  onDeleteSelected: () => void
}

export function PdfToolbar({
  hasDoc, tool, color, zoom, pageCount, selectedId, saving, exporting,
  onToolChange, onColorChange, onZoom, onOpenFile, onSave, onExport, onDeleteSelected,
}: PdfToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border-1 bg-surface-1 px-2.5 py-1.5">
      <button
        onClick={onOpenFile}
        className="flex h-7 items-center gap-1.5 rounded-md border border-border-2 bg-surface-2 px-2.5 text-[11px] font-medium text-text-2 hover:text-text-1"
        title="Open a PDF file"
      >
        <FolderOpen size={13} /> Open
      </button>

      <div className="mx-1 h-5 w-px bg-border-2" />

      {/* Tools */}
      <div className="flex items-center gap-0.5">
        {TOOLS.map((t) => {
          const active = tool === t.id
          return (
            <button
              key={t.id}
              onClick={() => onToolChange(t.id)}
              disabled={!hasDoc}
              title={t.label}
              className={cn(
                'grid h-7 w-7 place-items-center rounded-md transition-colors disabled:opacity-30',
                active ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
              )}
            >
              <t.icon size={14} />
            </button>
          )
        })}
      </div>

      <div className="mx-1 h-5 w-px bg-border-2" />

      {/* Colors */}
      <div className="flex items-center gap-1">
        {SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => onColorChange(c)}
            title={c}
            className={cn('h-5 w-5 rounded-full border', color === c ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface-1' : 'border-border-2')}
            style={{ background: c }}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => onColorChange(e.target.value)}
          title="Custom color"
          className="h-5 w-6 cursor-pointer rounded border border-border-2 bg-transparent p-0"
        />
      </div>

      <div className="mx-1 h-5 w-px bg-border-2" />

      <button
        onClick={onDeleteSelected}
        disabled={!selectedId}
        title="Delete selected (Del)"
        className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-error disabled:opacity-30"
      >
        <Trash2 size={14} />
      </button>

      <div className="flex-1" />

      {/* Zoom */}
      <div className="flex items-center gap-0.5">
        <button onClick={() => onZoom('out')} disabled={!hasDoc} className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30" title="Zoom out">
          <ZoomOut size={14} />
        </button>
        <button onClick={() => onZoom('reset')} disabled={!hasDoc} className="h-7 min-w-[48px] rounded-md px-1 text-[11px] font-medium text-text-2 hover:bg-surface-2 disabled:opacity-30" title="Reset zoom">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={() => onZoom('in')} disabled={!hasDoc} className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30" title="Zoom in">
          <ZoomIn size={14} />
        </button>
      </div>

      <span className="px-1 text-[11px] text-text-4">{pageCount > 0 ? `${pageCount} pages` : ''}</span>

      <div className="mx-1 h-5 w-px bg-border-2" />

      <button
        onClick={onSave}
        disabled={!hasDoc || saving}
        className="flex h-7 items-center gap-1.5 rounded-md border border-border-2 bg-surface-2 px-2.5 text-[11px] font-medium text-text-2 hover:text-text-1 disabled:opacity-40"
        title="Save project (re-editable)"
      >
        <Save size={13} /> {saving ? 'Saving…' : 'Save'}
      </button>
      <button
        onClick={onExport}
        disabled={!hasDoc || exporting}
        className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[11px] font-bold text-white hover:bg-accent-hover disabled:opacity-40"
        title="Export a flattened PDF"
      >
        <Download size={13} /> {exporting ? 'Exporting…' : 'Export PDF'}
      </button>
    </div>
  )
}

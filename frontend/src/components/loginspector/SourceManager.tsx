import { useRef, useState } from 'react'
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { LogSessionSource } from './useLogImport'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatRange(source: LogSessionSource): string {
  if (source.firstTs === null || source.lastTs === null) return 'No timestamp range'
  const first = new Date(source.firstTs).toLocaleString()
  const last = new Date(source.lastTs).toLocaleString()
  return first === last ? first : `${first} → ${last}`
}

interface SourceManagerProps {
  sources: LogSessionSource[]
  onAdd: () => void
  onRename: (id: string, name: string) => void
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  onReplace: (id: string, file: File) => void
}

/** Session-local source controls. Log bytes stay in memory and are never uploaded. */
export function SourceManager({ sources, onAdd, onRename, onToggle, onRemove, onReplace }: SourceManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const replacingIdRef = useRef<string | null>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const startRename = (source: LogSessionSource) => {
    setEditingId(source.id)
    setDraft(source.displayName)
  }

  const finishRename = () => {
    if (editingId && draft.trim()) onRename(editingId, draft)
    setEditingId(null)
  }

  return (
    <div className="flex max-h-[420px] w-[560px] max-w-[calc(100vw-32px)] flex-col overflow-hidden">
      <input
        ref={replaceInputRef}
        type="file"
        accept="*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          const id = replacingIdRef.current
          if (file && id) onReplace(id, file)
          event.target.value = ''
          replacingIdRef.current = null
        }}
      />
      <div className="flex items-center gap-2 border-b border-border-2 px-2 pb-2 pt-1">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-text-1">Investigation sources</p>
          <p className="text-[10px] text-text-4">Add files without losing the current query. Disabled sources remain in the session.</p>
        </div>
        <button onClick={onAdd} className="flex h-7 shrink-0 items-center gap-1 rounded border border-accent/40 bg-accent/10 px-2 text-[10px] text-accent-light hover:bg-accent/20">
          <Plus size={11} /> Add files
        </button>
      </div>

      <div className="min-h-0 overflow-auto py-1">
        {sources.map((source) => (
          <div key={source.id} className="group border-b border-border-1 px-2 py-2 last:border-b-0 hover:bg-surface-2/50">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={source.enabled} onChange={() => onToggle(source.id)} aria-label={`${source.enabled ? 'Disable' : 'Enable'} ${source.displayName}`} />
              {editingId === source.id ? (
                <form className="min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); finishRename() }}>
                  <input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={finishRename}
                    onKeyDown={(event) => { if (event.key === 'Escape') setEditingId(null) }}
                    className="h-6 w-full rounded border border-accent bg-surface-0 px-1.5 font-mono text-[10px] text-text-1 outline-none"
                  />
                </form>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11px] text-text-1" title={source.displayName}>{source.displayName}</p>
                  {source.displayName !== source.name && <p className="truncate font-mono text-[9px] text-text-4">{source.name}</p>}
                </div>
              )}
              <button onClick={() => startRename(source)} title="Rename source" className="grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-text-1"><Pencil size={11} /></button>
              <button
                onClick={() => { replacingIdRef.current = source.id; replaceInputRef.current?.click() }}
                title="Reload or replace this source"
                className="grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-text-1"
              >
                <RefreshCw size={11} />
              </button>
              <button onClick={() => onRemove(source.id)} title="Remove source" className="grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-error/10 hover:text-error"><Trash2 size={11} /></button>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-6 font-mono text-[9px] text-text-4">
              <span>{source.format}</span>
              <span>{formatBytes(source.bytes)}</span>
              <span>{source.eventCount.toLocaleString()} events</span>
              {source.errorCount > 0 && <span className="text-error">{source.errorCount} errors</span>}
              {source.warningCount > 0 && <span className="text-warning">{source.warningCount} warnings</span>}
              <span className="basis-full truncate" title={formatRange(source)}>{formatRange(source)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

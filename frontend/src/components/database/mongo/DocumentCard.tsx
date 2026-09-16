import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, CopyPlus, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { bsonDisplay, bsonKind, isContainer, stringifyEditable, type BsonDoc } from './bson'
import { DocumentEditor } from './DocumentEditor'

const FIELD_PREVIEW = 12

export const KIND_CLASS: Partial<Record<string, string>> = {
  ObjectId: 'text-accent',
  String: 'text-json-string',
  Int32: 'text-json-number tabular-nums',
  Int64: 'text-json-number tabular-nums',
  Double: 'text-json-number tabular-nums',
  Decimal128: 'text-json-number tabular-nums',
  Boolean: 'text-json-bool',
  Date: 'text-info',
  Null: 'italic text-json-null',
}

/** One-line rendering of a value, used by list rows and table cells. */
export function BsonInline({ value, className }: { value: unknown; className?: string }) {
  const kind = bsonKind(value)
  const text = bsonDisplay(value)
  return (
    <span title={`${kind}: ${text}`} className={cn('font-mono', KIND_CLASS[kind] ?? 'text-text-3', className)}>
      {kind === 'String' ? `"${text}"` : text}
    </span>
  )
}

function BsonField({ name, value, depth }: { name: string; value: unknown; depth: number }) {
  const container = isContainer(value)
  const [open, setOpen] = useState(false)
  const entries = container
    ? Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as BsonDoc)
    : []
  return (
    <>
      <div className="group/field flex min-h-[22px] items-start gap-1.5" style={{ paddingLeft: depth * 16 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={!container || entries.length === 0}
          aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
          className="mt-[3px] grid h-4 w-4 flex-none place-items-center rounded text-text-4 hover:text-text-1 disabled:invisible"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="flex-none font-mono text-[11.5px] leading-[22px] text-text-1">{name}:</span>
        <BsonInline value={value} className="min-w-0 break-all text-[11.5px] leading-[22px]" />
        <span className="ml-auto flex-none pl-2 text-[9.5px] leading-[22px] text-text-4 opacity-0 group-hover/field:opacity-100">{bsonKind(value)}</span>
      </div>
      {open && entries.map(([k, v]) => <BsonField key={k} name={k} value={v} depth={depth + 1} />)}
    </>
  )
}

interface DocumentCardProps {
  doc: BsonDoc
  busy?: boolean
  /** Omit the handlers for read-only results (aggregations, samples). */
  onSave?: (text: string) => Promise<void>
  onDelete?: () => Promise<void>
  onClone?: () => void
}

export function DocumentCard({ doc, busy = false, onSave, onDelete, onClone }: DocumentCardProps) {
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view')
  const [showAll, setShowAll] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const entries = Object.entries(doc)
  const visible = showAll ? entries : entries.slice(0, FIELD_PREVIEW)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(stringifyEditable(doc))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setError('Clipboard is not available')
    }
  }

  const run = async (action: () => Promise<void>) => {
    setError('')
    try {
      await action()
      setMode('view')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const actionClass = 'grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1'

  return (
    <div className={cn(
      'group relative rounded-md border bg-surface-1 transition-colors',
      mode === 'edit' ? 'border-accent/50' : mode === 'delete' ? 'border-error/50' : 'border-border-1 hover:border-border-2',
    )}>
      {mode === 'edit' && onSave ? (
        <DocumentEditor
          initial={stringifyEditable(doc)}
          busy={busy}
          submitLabel="Update"
          onCancel={() => { setMode('view'); setError('') }}
          onSubmit={(text) => run(() => onSave(text))}
        />
      ) : (
        <>
          <div className="px-2 py-2">
            {visible.map(([k, v]) => <BsonField key={k} name={k} value={v} depth={0} />)}
            {entries.length > FIELD_PREVIEW && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="ml-6 mt-1 text-[11px] font-medium text-accent hover:text-accent-light">
                {showAll ? 'Show fewer fields' : `Show ${entries.length - FIELD_PREVIEW} more fields`}
              </button>
            )}
          </div>
          {mode === 'view' && (
            <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md border border-border-2 bg-surface-2 p-0.5 opacity-0 shadow-sm transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              {onSave && <button type="button" title="Edit document" aria-label="Edit document" onClick={() => setMode('edit')} className={actionClass}><Pencil size={12} /></button>}
              <button type="button" title="Copy document" aria-label="Copy document" onClick={() => void copy()} className={actionClass}>{copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}</button>
              {onClone && <button type="button" title="Clone document" aria-label="Clone document" onClick={onClone} className={actionClass}><CopyPlus size={12} /></button>}
              {onDelete && <button type="button" title="Delete document" aria-label="Delete document" onClick={() => setMode('delete')} className={cn(actionClass, 'hover:text-error')}><Trash2 size={12} /></button>}
            </div>
          )}
          {mode === 'delete' && onDelete && (
            <div className="flex items-center gap-2 rounded-b-md border-t border-error/30 bg-error/10 px-3 py-2">
              <span className="text-[11.5px] text-error">Document flagged for deletion.</span>
              <button type="button" onClick={() => { setMode('view'); setError('') }} className="ml-auto h-7 rounded-md border border-border-2 px-2.5 text-[11.5px] text-text-2 hover:bg-surface-3">Cancel</button>
              <button type="button" disabled={busy} onClick={() => void run(onDelete)} className="h-7 rounded-md bg-error px-2.5 text-[11.5px] font-semibold text-white hover:opacity-90 disabled:opacity-40">Delete</button>
            </div>
          )}
        </>
      )}
      {error && <div className="border-t border-error/30 px-3 py-1.5 text-[11px] text-error">{error}</div>}
    </div>
  )
}

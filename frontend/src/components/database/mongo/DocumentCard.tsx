import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, CopyPlus, Eraser, Link2, Pencil, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { bsonDisplay, bsonKind, isContainer, parseShellDoc, stringifyEditable, toEditable, type BsonDoc } from './bson'
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

/** Copies text and flashes a check on the button for a moment. */
function CopyButton({ text, label, icon }: { text: string; label: string; icon: 'path' | 'value' }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 1000) } catch { /* clipboard unavailable: nothing to copy into */ }
  }
  return (
    <button type="button" title={label} aria-label={label} onClick={() => void copy()} className="grid h-[18px] w-[18px] flex-none place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-text-1">
      {done ? <Check size={11} className="text-success" /> : icon === 'path' ? <Link2 size={11} /> : <Copy size={11} />}
    </button>
  )
}

const valueText = (value: unknown): string => {
  const plain = toEditable(value)
  return typeof plain === 'string' ? plain : JSON.stringify(plain, null, 2)
}

/** Parses one value typed inline (shell syntax: 'text', 42, true, ObjectId('…'), ISODate('…'), { … }). */
export function parseFieldValue(text: string): unknown {
  const doc = parseShellDoc(`{ "v": ${text.trim() || 'null'} }`, 'Value')
  return doc?.v
}

/** Single-field writes, available only on editable documents. */
export interface FieldEdit {
  set: (path: string, value: unknown) => Promise<void>
  unset: (path: string) => Promise<void>
}

function InlineValueEditor({ value, onSave, onCancel }: { value: unknown; onSave: (v: unknown) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState(() => JSON.stringify(toEditable(value)))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async () => {
    let parsed: unknown
    try { parsed = parseFieldValue(text) } catch (e) { setError(e instanceof Error ? e.message : String(e)); return }
    setSaving(true)
    try { await onSave(parsed) } catch (e) { setError(e instanceof Error ? e.message : String(e)); setSaving(false) }
  }
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex min-w-0 items-center gap-1">
        <input
          autoFocus
          value={text}
          spellCheck={false}
          aria-label="Field value"
          onChange={(e) => { setText(e.target.value); setError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') onCancel() }}
          className={cn('h-[22px] min-w-0 flex-1 rounded border bg-surface-0 px-1.5 font-mono text-[11.5px] text-text-1 outline-none', error ? 'border-error/70' : 'border-accent/50')}
        />
        <button type="button" disabled={saving} onClick={() => void save()} aria-label="Save field" title="Save (Enter)" className="grid h-[22px] w-[22px] flex-none place-items-center rounded text-success hover:bg-surface-3 disabled:opacity-40"><Check size={12} /></button>
        <button type="button" onClick={onCancel} aria-label="Cancel edit" title="Cancel (Esc)" className="grid h-[22px] w-[22px] flex-none place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
      </span>
      {error && <span className="pt-0.5 text-[10.5px] text-error">{error}</span>}
    </span>
  )
}

function BsonField({ name, value, depth, path, defaultOpen, edit }: { name: string; value: unknown; depth: number; path: string; defaultOpen: boolean; edit?: FieldEdit }) {
  const container = isContainer(value)
  const [open, setOpen] = useState(defaultOpen)
  const [editing, setEditing] = useState(false)
  // _id è immutabile in MongoDB: niente modifica inline.
  const editable = !!edit && path !== '_id'
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
        {editing && edit ? (
          <InlineValueEditor value={value} onCancel={() => setEditing(false)} onSave={async (v) => { await edit.set(path, v); setEditing(false) }} />
        ) : (
          <BsonInline value={value} className="min-w-0 break-all text-[11.5px] leading-[22px]" />
        )}
        {!editing && <span className="ml-auto flex flex-none items-center gap-0.5 pl-2 opacity-0 focus-within:opacity-100 group-hover/field:opacity-100">
          <span className="pr-1 text-[9.5px] leading-[22px] text-text-4">{bsonKind(value)}</span>
          {editable && <button type="button" title="Edit value" aria-label={`Edit ${path}`} onClick={() => setEditing(true)} className="grid h-[18px] w-[18px] flex-none place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-text-1"><Pencil size={11} /></button>}
          {editable && <button type="button" title="Remove field" aria-label={`Remove ${path}`} onClick={() => void edit.unset(path)} className="grid h-[18px] w-[18px] flex-none place-items-center rounded text-text-4 hover:bg-surface-3 hover:text-error"><Eraser size={11} /></button>}
          <CopyButton text={path} label={`Copy path ${path}`} icon="path" />
          <CopyButton text={valueText(value)} label="Copy value" icon="value" />
        </span>}
      </div>
      {open && entries.map(([k, v]) => <BsonField key={k} name={k} value={v} depth={depth + 1} path={`${path}.${k}`} defaultOpen={defaultOpen} edit={edit} />)}
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
  /** Start with every nested field expanded (Expand all). Remount the card to apply a change. */
  defaultOpen?: boolean
  /** Inline single-field edits ($set / $unset). */
  fieldEdit?: FieldEdit
}

export function DocumentCard({ doc, busy = false, onSave, onDelete, onClone, defaultOpen = false, fieldEdit }: DocumentCardProps) {
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view')
  const [showAll, setShowAll] = useState(defaultOpen)
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
            {visible.map(([k, v]) => <BsonField key={k} name={k} value={v} depth={0} path={k} defaultOpen={defaultOpen} edit={mode === 'view' ? fieldEdit : undefined} />)}
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

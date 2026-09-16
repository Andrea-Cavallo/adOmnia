import { useCallback, useEffect, useState } from 'react'
import { Loader2, RotateCcw, Save, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { parseShellDoc, stringifyEditable, type BsonDoc } from './bson'
import type { RunMongo } from './useMongoBrowser'
import { ErrorBox, errorText, fieldInput, firstDocument, primaryButton, secondaryButton } from './ui'

const EXAMPLE = `{
  $jsonSchema: {
    bsonType: 'object',
    required: ['name'],
    properties: {
      name: { bsonType: 'string', description: 'required string' }
    }
  }
}`

interface ValidationTabProps {
  runMongo: RunMongo
  db: string
  collection: string
}

export function ValidationTab({ runMongo, db, collection }: ValidationTabProps) {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState({ text: '', level: 'strict', action: 'error' })
  const [level, setLevel] = useState('strict')
  const [action, setAction] = useState('error')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = firstDocument(await runMongo({ operation: 'runCommand', database: db, command: { listCollections: 1, filter: { name: collection } }, canonical: true }))
      const info = (((r.cursor as BsonDoc | undefined)?.firstBatch ?? []) as BsonDoc[])[0]
      const options = (info?.options ?? {}) as BsonDoc
      const validator = options.validator as BsonDoc | undefined
      const next = {
        text: validator && Object.keys(validator).length ? stringifyEditable(validator) : '',
        level: String(options.validationLevel ?? 'strict'),
        action: String(options.validationAction ?? 'error'),
      }
      setSaved(next)
      setText(next.text)
      setLevel(next.level)
      setAction(next.action)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [collection, db, runMongo])

  useEffect(() => { void load() }, [load])

  const dirty = text !== saved.text || level !== saved.level || action !== saved.action

  const save = async () => {
    setError('')
    setMessage('')
    try {
      const validator = parseShellDoc(text, 'Validator') ?? {}
      setSaving(true)
      await runMongo({ operation: 'runCommand', database: db, command: { collMod: collection, validator, validationLevel: level, validationAction: action } })
      setMessage(Object.keys(validator).length ? 'Validation rules updated' : 'Validation rules removed')
      await load()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 flex-none items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
        <label className="flex items-center gap-1.5 text-[11.5px] text-text-3">Level
          <select value={level} onChange={(e) => setLevel(e.target.value)} className={cn(fieldInput, 'h-7')}>
            <option value="strict">strict</option><option value="moderate">moderate</option><option value="off">off</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11.5px] text-text-3">Action
          <select value={action} onChange={(e) => setAction(e.target.value)} className={cn(fieldInput, 'h-7')}>
            <option value="error">error</option><option value="warn">warn</option>
          </select>
        </label>
        {!text.trim() && <button type="button" onClick={() => setText(EXAMPLE)} className={secondaryButton}>Insert $jsonSchema example</button>}
        <div className="ml-auto flex items-center gap-2">
          {message && !dirty && <span className="text-[11px] text-success">{message}</span>}
          <button type="button" onClick={() => { setText(saved.text); setLevel(saved.level); setAction(saved.action) }} disabled={!dirty} className={secondaryButton}><RotateCcw size={12} /> Revert</button>
          <button type="button" onClick={() => void save()} disabled={!dirty || saving} className={primaryButton}>{saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Apply</button>
        </div>
      </div>
      <ErrorBox message={error} className="m-3" />
      {loading ? (
        <div className="grid h-40 place-items-center"><Loader2 size={16} className="animate-spin text-text-4" /></div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          {!saved.text && !text.trim() && (
            <div className="mb-3 flex items-center gap-2 text-[11.5px] text-text-3"><ShieldCheck size={14} className="text-text-4" /> No validation rules. Documents of any shape are accepted.</div>
          )}
          <textarea
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            aria-label="Validation rules"
            placeholder="{ $jsonSchema: { … } }  — leave empty to remove validation"
            className="min-h-[240px] flex-1 resize-none rounded-md border border-border-1 bg-surface-0 px-3 py-2 font-mono text-[11.5px] leading-5 text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
          />
        </div>
      )}
    </div>
  )
}

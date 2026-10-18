import { useEffect, useId, useState } from 'react'
import { getRunSchema, type GoIDERunConfiguration } from '@/lib/code-studio-api'
import type { RunField } from '@/lib/code-studio/runFormTypes'
import { CodeStudioEntryList } from './CodeStudioEntryList'

interface Props {
  draft: GoIDERunConfiguration
  patch: (change: Partial<GoIDERunConfiguration>) => void
  onReady?: (ready: boolean) => void
}
export function CodeStudioRunSchemaFields({ draft, patch, onReady }: Props) {
  const [fields, setFields] = useState<RunField[]>([])
  const [status, setStatus] = useState('loading')
  const [retry, setRetry] = useState(0)
  const language = draft.language ?? ''
  const nested = language !== '' && language !== 'go'
  const options = (nested && draft.languageOptions && typeof draft.languageOptions === 'object' ? draft.languageOptions : {}) as Record<string, unknown>
  const values = nested ? options : draft as unknown as Record<string, unknown>
  useEffect(() => {
    let live = true
    setStatus('loading'); setFields([]); onReady?.(false)
    getRunSchema(language, draft.kind).then(schema => {
      if (!live) return
      const found = schema.fields ?? []
      setFields(found); setStatus('ready'); onReady?.(true)
    }).catch(() => { if (live) { setStatus('error'); onReady?.(false) } })
    return () => { live = false }
  }, [language, draft.kind, retry, onReady])
  const set = (key: string, value: unknown) => patch((nested ? { languageOptions: { ...options, [key]: value } } : { [key]: value }) as Partial<GoIDERunConfiguration>)
  // Defaults must be in the saved payload, not only painted into an input.
  useEffect(() => {
    if (status !== 'ready') return
    const defaults = Object.fromEntries(fields.filter(field => field.default !== undefined && values[field.key] === undefined).map(field => [field.key, field.default]))
    if (Object.keys(defaults).length) patch((nested ? { languageOptions: { ...options, ...defaults } } : defaults) as Partial<GoIDERunConfiguration>)
  }, [fields, status, values, nested, options, patch])
  if (status === 'loading') return <p role="status" className="gs-hint">Loading provider fields…</p>
  if (status === 'error') return <p role="alert" className="gs-hint text-danger">Provider fields could not be loaded. <button type="button" className="gs-btn gs-btn-ghost gs-btn-sm" onClick={() => setRetry(value => value + 1)}>Retry</button></p>
  const visible = fields.filter(field => !field.visibleWhen || field.visibleWhen.equals.includes(String(values[field.visibleWhen.field] ?? '')))
  const basic = visible.filter(field => field.section === 'basic')
  const advanced = visible.filter(field => field.section !== 'basic')
  return <div className="space-y-3">
    <SchemaGrid fields={basic} values={values} set={set} />
    {advanced.length > 0 && <details className="rounded-md border border-border-1 px-3 py-2">
      <summary className="cursor-pointer text-[12px] font-medium text-text-2">Advanced</summary>
      <div className="mt-3"><SchemaGrid fields={advanced} values={values} set={set} /></div>
    </details>}
  </div>
}
interface GridProps { fields: RunField[]; values: Record<string, unknown>; set: (key: string, value: unknown) => void }
export function SchemaGrid({ fields, values, set }: GridProps) {
  const id = useId()
  return <div className="grid grid-cols-2 gap-3">
    {fields.map(field => {
      const value = values[field.key] ?? field.default
      const helpId = `${id}-${field.key}-help`
      if (field.type === 'keyvalue') {
        const entries = Array.isArray(value) ? value.filter((entry): entry is { key: string; value: string; secret: boolean } => !!entry && typeof entry === 'object' && 'key' in entry && 'value' in entry) : []
        return <div key={field.key} className="col-span-2"><CodeStudioEntryList label={field.label} empty="No entries." entries={entries} onChange={next => set(field.key, next)} /></div>
      }
      return <label key={field.key} className={`gs-field-label ${field.type === 'list' || field.type === 'keyvalue' ? 'col-span-2' : ''}`}>
        <span>{field.label}{field.required && <span className="text-accent"> *</span>}</span>
        {field.type === 'toggle' ? <input type="checkbox" checked={!!value} onChange={event => set(field.key, event.target.checked)} className="gs-switch" />
        : field.type === 'select' ? <select required={field.required} aria-describedby={helpId} value={String(value ?? '')} onChange={event => set(field.key, event.target.value)} className="gs-input">
          {(field.options ?? []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        : field.type === 'list' ? <textarea required={field.required} aria-describedby={helpId} rows={2} value={Array.isArray(value) ? value.join('\n') : ''} onChange={event => set(field.key, event.target.value.split(/\r?\n/))} className="gs-input gs-mono resize-y" />
        : <input required={field.required} aria-describedby={helpId} value={String(value ?? '')} onChange={event => set(field.key, event.target.value)} className="gs-input gs-mono" />}
        {field.help && <span id={helpId} className="gs-hint font-normal">{field.help}</span>}
      </label>
    })}
  </div>
}

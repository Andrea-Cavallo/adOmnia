import { useEffect, useState } from 'react'
import { getRunSchema, type GoIDERunConfiguration } from '@/lib/code-studio-api'
import type { Field } from '../../../bindings/adomnia/internal/ide/run/models'

interface Props {
  draft: GoIDERunConfiguration
  patch: (change: Partial<GoIDERunConfiguration>) => void
}

const input = 'gs-input gs-mono'
const label = 'gs-field-label'

type DraftValues = Record<string, unknown>

/** Schema fields come from the language adapter; their keys match the run configuration JSON keys. */
export function CodeStudioRunSchemaFields({ draft, patch }: Props) {
  const [fields, setFields] = useState<Field[]>([])
  const language = draft.language ?? ''
  useEffect(() => {
    let live = true
    getRunSchema(language, draft.kind)
      .then((schema) => { if (live) setFields(schema.fields ?? []) })
      .catch(() => { if (live) setFields([]) })
    return () => { live = false }
  }, [language, draft.kind])

  if (fields.length === 0) return null
  const values = draft as unknown as DraftValues
  const set = (key: string, value: unknown) => patch({ [key]: value } as Partial<GoIDERunConfiguration>)
  const toggles = fields.filter((field) => String(field.type) === 'toggle')
  const others = fields.filter((field) => String(field.type) !== 'toggle')

  return (
    <details className="mt-3 rounded-md border border-border-1 px-3 py-2">
      <summary className="cursor-pointer select-none text-[12.5px] text-text-2">Advanced</summary>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {others.map((field) => (
          <label key={field.key} className={label} title={field.help}>{field.label}
            {String(field.type) === 'select' ? (
              <select value={String(values[field.key] ?? '')} onChange={(event) => set(field.key, event.target.value)} className={input}>
                {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : String(field.type) === 'list' ? (
              <input value={((values[field.key] as string[] | null | undefined) ?? []).join(' ')} placeholder={field.help}
                onChange={(event) => set(field.key, event.target.value.split(/\s+/).filter(Boolean))} className={input} />
            ) : (
              <input value={String(values[field.key] ?? '')} onChange={(event) => set(field.key, event.target.value.trim())} className={input} />
            )}
          </label>
        ))}
        {toggles.length > 0 && (
          <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-text-2">
            {toggles.map((field) => (
              <label key={field.key} className="flex items-center gap-2" title={field.help}>
                <input type="checkbox" checked={!!values[field.key]} onChange={(event) => set(field.key, event.target.checked)} className="h-[15px] w-[15px] accent-[var(--color-accent)]" />{field.label}
              </label>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}

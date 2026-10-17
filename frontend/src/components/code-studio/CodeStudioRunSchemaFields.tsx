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

/** Go keeps its flat configuration keys; every other language stores its fields in `languageOptions`. */
const usesLanguageOptions = (language: string) => language !== '' && language !== 'go'

/** Schema fields come from the language adapter; their keys match the run configuration (or `languageOptions`) JSON keys. */
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
  const nested = usesLanguageOptions(language)
  const options = (nested && draft.languageOptions && typeof draft.languageOptions === 'object' ? draft.languageOptions : {}) as DraftValues
  const values = nested ? options : (draft as unknown as DraftValues)
  const set = (key: string, value: unknown) => patch((nested ? { languageOptions: { ...options, [key]: value } } : { [key]: value }) as Partial<GoIDERunConfiguration>)
  const basic = fields.filter((field) => String(field.section) === 'basic')
  const advanced = fields.filter((field) => String(field.section) !== 'basic')
  const grid = (list: Field[]) => <SchemaGrid fields={list} values={values} set={set} />

  return (
    <>
      {basic.length > 0 && <div className="mt-3">{grid(basic)}</div>}
      {advanced.length > 0 && (
        <details className="mt-3 rounded-md border border-border-1 px-3 py-2">
          <summary className="cursor-pointer select-none text-[12.5px] text-text-2">Advanced</summary>
          <div className="mt-3">{grid(advanced)}</div>
        </details>
      )}
    </>
  )
}

interface GridProps { fields: Field[]; values: DraftValues; set: (key: string, value: unknown) => void }

function SchemaGrid({ fields, values, set }: GridProps) {
  const toggles = fields.filter((field) => String(field.type) === 'toggle')
  const others = fields.filter((field) => String(field.type) !== 'toggle')
  return (
      <div className="grid grid-cols-2 gap-3">
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
              <input value={String(values[field.key] ?? field.default ?? '')} placeholder={field.help} onChange={(event) => set(field.key, event.target.value.trim())} className={input} />
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
  )
}

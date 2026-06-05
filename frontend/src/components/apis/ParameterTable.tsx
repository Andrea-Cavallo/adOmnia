import { Plus, Trash2 } from 'lucide-react'

export interface OASParam {
  name: string
  in: 'path' | 'query' | 'header'
  required: boolean
  type: string
  description: string
}

interface Props {
  params: OASParam[]
  onChange: (params: OASParam[]) => void
  /** true for path params: `in` is locked to `path` and `required` is implicit. */
  disableInChange?: boolean
}

const BLANK: OASParam = { name: '', in: 'query', required: false, type: 'string', description: '' }

export function ParameterTable({ params, onChange, disableInChange }: Props) {
  const add = () => onChange([...params, { ...BLANK }])
  const remove = (i: number) => onChange(params.filter((_, idx) => idx !== i))
  const update = (i: number, patch: Partial<OASParam>) =>
    onChange(params.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))

  return (
    <div className="space-y-1.5">
      {params.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 flex-wrap">
          <input
            value={p.name}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="name"
            className="h-6 px-2 text-[9px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none w-[90px]"
          />
          {!disableInChange ? (
            <select
              value={p.in}
              onChange={(e) => update(i, { in: e.target.value as OASParam['in'] })}
              className="h-6 px-1.5 text-[9px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
            >
              <option value="query">query</option>
              <option value="header">header</option>
              <option value="path">path</option>
            </select>
          ) : (
            <span className="h-6 px-2 text-[9px] font-mono bg-surface-1 border border-border-1 rounded text-text-4 flex items-center">
              path
            </span>
          )}
          <select
            value={p.type}
            onChange={(e) => update(i, { type: e.target.value })}
            className="h-6 px-1.5 text-[9px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
          >
            <option value="string">string</option>
            <option value="integer">integer</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
          </select>
          {!disableInChange && (
            <label className="flex items-center gap-1 text-[9px] text-text-3 cursor-pointer">
              <input
                type="checkbox"
                checked={p.required}
                onChange={(e) => update(i, { required: e.target.checked })}
                className="w-3 h-3 accent-[var(--color-accent)]"
              />
              required
            </label>
          )}
          <input
            value={p.description}
            onChange={(e) => update(i, { description: e.target.value })}
            placeholder="description"
            className="h-6 px-2 text-[9px] bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none flex-1 min-w-[80px]"
          />
          <button
            onClick={() => remove(i)}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-surface-3 text-text-4 hover:text-error transition-colors shrink-0"
            title="Remove parameter"
          >
            <Trash2 size={10} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="flex items-center gap-1.5 h-6 px-2 text-[9px] text-text-3 hover:text-text-1 hover:bg-surface-2 rounded transition-colors"
      >
        <Plus size={11} />
        Add parameter
      </button>
    </div>
  )
}

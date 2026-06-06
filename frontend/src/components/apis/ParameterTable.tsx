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
        <div
          key={i}
          className="grid grid-cols-[minmax(120px,180px)_92px_96px_92px_minmax(180px,1fr)_28px] items-center gap-2 rounded-md border border-border-1 bg-surface-1 px-2 py-1.5"
        >
          <input
            value={p.name}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="name"
            className="h-7 min-w-0 px-2 text-[11px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
          />
          {!disableInChange ? (
            <select
              value={p.in}
              onChange={(e) => update(i, { in: e.target.value as OASParam['in'] })}
              className="h-7 px-2 text-[11px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
            >
              <option value="query">query</option>
              <option value="header">header</option>
              <option value="path">path</option>
            </select>
          ) : (
            <span className="h-7 px-2 text-[11px] font-mono bg-surface-2 border border-border-2 rounded text-text-4 flex items-center">
              path
            </span>
          )}
          <select
            value={p.type}
            onChange={(e) => update(i, { type: e.target.value })}
            className="h-7 px-2 text-[11px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
          >
            <option value="string">string</option>
            <option value="integer">integer</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
          </select>
          <div className="flex items-center">
            {!disableInChange ? (
              <label className="flex items-center gap-1.5 text-[10px] text-text-3 cursor-pointer">
              <input
                type="checkbox"
                checked={p.required}
                onChange={(e) => update(i, { required: e.target.checked })}
                className="w-3 h-3 accent-[var(--color-accent)]"
              />
              required
            </label>
            ) : (
              <span className="text-[10px] text-text-4">required</span>
            )}
          </div>
          <input
            value={p.description}
            onChange={(e) => update(i, { description: e.target.value })}
            placeholder="description"
            className="h-7 min-w-0 px-2 text-[11px] bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
          />
          <button
            onClick={() => remove(i)}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-surface-3 text-text-4 hover:text-error transition-colors shrink-0"
            title="Remove parameter"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="flex items-center gap-1.5 h-7 px-2 text-[11px] text-text-3 hover:text-text-1 hover:bg-surface-2 rounded transition-colors"
      >
        <Plus size={13} />
        Add parameter
      </button>
    </div>
  )
}

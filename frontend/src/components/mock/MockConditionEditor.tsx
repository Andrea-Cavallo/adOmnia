import { Plus, Trash2 } from 'lucide-react'
import type { MockCondition } from '@/lib/types'

interface MockConditionEditorProps {
  conditions: MockCondition[]
  onChange: (conditions: MockCondition[]) => void
}

const SOURCE_OPTIONS: { value: MockCondition['source']; label: string }[] = [
  { value: 'query', label: 'Query' },
  { value: 'header', label: 'Header' },
  { value: 'path_param', label: 'Path param' },
  { value: 'body_jsonpath', label: 'Body JSONPath' },
]

const OPERATOR_OPTIONS: { value: MockCondition['operator']; label: string }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'not contains' },
  { value: 'regex', label: 'regex' },
  { value: 'exists', label: 'exists' },
  { value: 'not_exists', label: 'not exists' },
]

const BLANK_CONDITION: MockCondition = {
  source: 'query',
  field: '',
  operator: 'eq',
  value: '',
}

function hidesValue(operator: MockCondition['operator']): boolean {
  return operator === 'exists' || operator === 'not_exists'
}

function fieldPlaceholder(source: MockCondition['source']): string {
  if (source === 'body_jsonpath') return '.user.role'
  if (source === 'path_param') return 'id'
  if (source === 'header') return 'X-Request-Type'
  return 'role'
}

export function MockConditionEditor({ conditions, onChange }: MockConditionEditorProps) {
  const add = () => onChange([...conditions, { ...BLANK_CONDITION }])
  const remove = (index: number) => onChange(conditions.filter((_, i) => i !== index))
  const update = (index: number, patch: Partial<MockCondition>) =>
    onChange(conditions.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)))

  return (
    <div className="flex flex-col gap-2">
      {conditions.length === 0 && (
        <div className="rounded border border-dashed border-border-2 bg-surface-1 px-2 py-2 text-[10px] text-text-4">
          No conditions. This response always matches and can be used as a fallback.
        </div>
      )}

      {conditions.map((condition, index) => (
        <div key={index} className="grid grid-cols-[minmax(96px,0.8fr)_minmax(96px,1fr)_minmax(104px,0.8fr)_minmax(96px,1fr)_24px] gap-1.5 items-center">
          <select
            value={condition.source}
            onChange={(event) => update(index, { source: event.target.value as MockCondition['source'] })}
            className="h-6 px-1.5 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 outline-none focus:border-accent"
          >
            {SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <input
            value={condition.field}
            onChange={(event) => update(index, { field: event.target.value })}
            placeholder={fieldPlaceholder(condition.source)}
            className="h-6 px-2 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4"
          />

          <select
            value={condition.operator}
            onChange={(event) => update(index, { operator: event.target.value as MockCondition['operator'] })}
            className="h-6 px-1.5 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 outline-none focus:border-accent"
          >
            {OPERATOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          {hidesValue(condition.operator) ? (
            <div className="h-6 rounded border border-border-1 bg-surface-1 px-2 text-[10px] text-text-4 flex items-center">
              no value
            </div>
          ) : (
            <input
              value={condition.value}
              onChange={(event) => update(index, { value: event.target.value })}
              placeholder="expected"
              className="h-6 px-2 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 font-mono outline-none focus:border-accent placeholder:text-text-4"
            />
          )}

          <button
            onClick={() => remove(index)}
            className="w-6 h-6 flex items-center justify-center rounded text-text-4 hover:text-error hover:bg-surface-3"
            type="button"
          >
            <Trash2 size={10} />
          </button>
        </div>
      ))}

      <div className="flex items-center justify-between gap-2">
        <button
          onClick={add}
          className="flex items-center gap-1 text-[10px] text-accent hover:text-accent-light"
          type="button"
        >
          <Plus size={10} /> Add condition
        </button>
        {conditions.length > 0 && (
          <span className="text-[9px] text-text-4">All rows must match. Empty conditions always match.</span>
        )}
      </div>
    </div>
  )
}

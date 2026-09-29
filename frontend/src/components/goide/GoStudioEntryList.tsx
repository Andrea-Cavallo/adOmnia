import { KeyRound, Plus, Trash2 } from 'lucide-react'
import type { GoIDEEnvironmentEntry } from '@/lib/goide-api'

interface GoStudioEntryListProps {
  label: string
  empty: string
  entries: GoIDEEnvironmentEntry[]
  onChange: (entries: GoIDEEnvironmentEntry[]) => void
}

/** Elenco chiave/valore con segreti (variabili d'ambiente, build arg): un segreto salva solo il nome. */
export function GoStudioEntryList({ label, empty, entries, onChange }: GoStudioEntryListProps) {
  const update = (index: number, change: Partial<GoIDEEnvironmentEntry>) =>
    onChange(entries.map((entry, position) => position === index ? { ...entry, ...change } : entry))

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] font-medium text-text-3">{label}</span>
        <button
          type="button"
          onClick={() => onChange([...entries, { key: '', value: '', secret: false }])}
          className="grid h-5 w-5 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1"
          title={`Add ${label.toLowerCase()}`}
        >
          <Plus size={11} />
        </button>
      </div>
      {entries.length === 0 && <p className="text-[10px] text-text-4">{empty}</p>}
      {entries.map((entry, index) => (
        <div key={index} className="mb-1 flex items-center gap-1.5">
          <input
            value={entry.key}
            onChange={(event) => update(index, { key: event.target.value })}
            placeholder="NAME"
            className="h-7 w-40 rounded border border-border-1 bg-surface-0 px-2 font-mono text-[10px] text-text-1 outline-none focus:border-accent"
          />
          <input
            value={entry.secret ? '' : entry.value ?? ''}
            onChange={(event) => update(index, { value: event.target.value })}
            disabled={entry.secret}
            placeholder={entry.secret ? 'asked when you launch' : 'value'}
            className="h-7 min-w-0 flex-1 rounded border border-border-1 bg-surface-0 px-2 font-mono text-[10px] text-text-1 outline-none focus:border-accent disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => update(index, { secret: !entry.secret, value: '' })}
            title={entry.secret ? 'Stored as a secret: value is asked at launch' : 'Mark as secret'}
            className={`grid h-7 w-7 place-items-center rounded border ${
              entry.secret ? 'border-accent text-accent' : 'border-border-1 text-text-4 hover:text-text-1'
            }`}
          >
            <KeyRound size={11} />
          </button>
          <button
            type="button"
            onClick={() => onChange(entries.filter((_, position) => position !== index))}
            title="Remove"
            className="grid h-7 w-7 place-items-center rounded text-text-4 hover:text-danger"
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}

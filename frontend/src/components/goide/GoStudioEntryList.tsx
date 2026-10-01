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
    <div className="mt-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="gs-label">{label}</span>
        <button
          type="button"
          onClick={() => onChange([...entries, { key: '', value: '', secret: false }])}
          className="gs-btn gs-btn-ghost gs-btn-sm gs-btn-icon"
          title={`Add ${label.toLowerCase()}`}
        >
          <Plus size={14} />
        </button>
      </div>
      {entries.length === 0 && <p className="gs-hint">{empty}</p>}
      {entries.map((entry, index) => (
        <div key={index} className="mb-1.5 flex items-center gap-2">
          <input
            value={entry.key}
            onChange={(event) => update(index, { key: event.target.value })}
            placeholder="NAME"
            className="gs-input gs-mono w-44 shrink-0"
          />
          <input
            value={entry.secret ? '' : entry.value ?? ''}
            onChange={(event) => update(index, { value: event.target.value })}
            disabled={entry.secret}
            placeholder={entry.secret ? 'asked when you launch' : 'value'}
            className="gs-input gs-mono flex-1"
          />
          <button
            type="button"
            onClick={() => update(index, { secret: !entry.secret, value: '' })}
            title={entry.secret ? 'Stored as a secret: value is asked at launch' : 'Mark as secret'}
            aria-pressed={entry.secret}
            className={`gs-btn gs-btn-icon ${entry.secret ? 'gs-btn-secondary border-accent text-accent' : 'gs-btn-ghost'}`}
          >
            <KeyRound size={14} />
          </button>
          <button
            type="button"
            onClick={() => onChange(entries.filter((_, position) => position !== index))}
            title="Remove"
            className="gs-btn gs-btn-danger-ghost gs-btn-icon"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

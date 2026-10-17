import { useEffect, useState } from 'react'
import { Plus, Sparkles } from 'lucide-react'
import { getRunSuggestions } from '@/lib/code-studio-api'
import type { GoIDERunConfiguration } from '@/lib/code-studio-api'
import type { Suggestion } from '../../../bindings/adomnia/internal/ide/run/models'

interface Props {
  sessionId: string
  /** Cambia quando le configurazioni salvate cambiano: le proposte già salvate spariscono. */
  savedCount: number
  onAdd: (configuration: Partial<GoIDERunConfiguration>) => Promise<void>
}

const MAX_VISIBLE = 6

/** Proposte di configurazione rilevate dai marker del progetto (go.mod, package.json…): un click le salva. */
export function CodeStudioRunSuggestions({ sessionId, savedCount, onAdd }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [adding, setAdding] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getRunSuggestions(sessionId)
      .then((found) => { if (live) setSuggestions(found ?? []) })
      .catch(() => { if (live) setSuggestions([]) })
    return () => { live = false }
  }, [sessionId, savedCount])

  const pending = suggestions.filter((suggestion) => !suggestion.saved)
  if (pending.length === 0) return null

  const add = async (suggestion: Suggestion) => {
    setAdding(suggestion.id)
    try { await onAdd(suggestion.configuration as unknown as Partial<GoIDERunConfiguration>) } finally { setAdding(null) }
  }

  return (
    <div className="shrink-0 border-t border-border-1 p-1.5">
      <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-text-4"><Sparkles size={11} /> Detected</div>
      {pending.slice(0, MAX_VISIBLE).map((suggestion) => (
        <button
          key={suggestion.id}
          type="button"
          disabled={adding !== null}
          onClick={() => void add(suggestion)}
          title={`Add "${suggestion.configuration.name}"`}
          className="group flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12.5px] text-text-2 hover:bg-surface-2/60 hover:text-text-1 disabled:opacity-60"
        >
          <span className="min-w-0 flex-1 truncate">{suggestion.title}</span>
          <Plus size={13} className="shrink-0 text-accent opacity-0 group-hover:opacity-100" />
        </button>
      ))}
    </div>
  )
}

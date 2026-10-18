import { useEffect, useState } from 'react'
import { getRunSuggestions, type GoIDERunConfiguration } from '@/lib/code-studio-api'
import { cleanRunConfiguration, emptyRunConfiguration } from '@/lib/code-studio/runFormTypes'
import { useCodeStudioStore } from '@/stores/codeStudio'
import type { Suggestion } from '../../../bindings/adomnia/internal/ide/run/models'

const MAX_ITEMS = 4

/**
 * Proposte non ancora salvate per la barra Run vuota ("Trovato Vite · pnpm run dev → Aggiungi").
 * Si caricano solo quando il menu delle configurazioni è aperto e il progetto non ne ha nessuna.
 */
export function useDetectedRunItems(sessionId: string, active: boolean) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  useEffect(() => {
    if (!active) return
    let live = true
    getRunSuggestions(sessionId)
      .then((found) => { if (live) setSuggestions((found ?? []).filter((item) => !item.saved).slice(0, MAX_ITEMS)) })
      .catch(() => { if (live) setSuggestions([]) })
    return () => { live = false }
  }, [sessionId, active])

  /** Salva la proposta come configurazione e la rende attiva. */
  const add = async (id: string): Promise<void> => {
    const found = suggestions.find((item) => item.id === id)
    if (!found) return
    const draft = { ...emptyRunConfiguration(sessionId), ...(found.configuration as unknown as Partial<GoIDERunConfiguration>), sessionId }
    const saved = await useCodeStudioStore.getState().saveRunConfiguration(cleanRunConfiguration(draft))
    if (saved) useCodeStudioStore.getState().selectRunConfiguration(saved.id)
  }
  return { suggestions, add }
}

import { create } from 'zustand'
import { useEffect, useMemo } from 'react'
import { closeGoIDEDocument, openGoIDEDocument } from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { EMPTY_PROJECT_SETTINGS, PROJECT_SETTINGS_PATH, parseProjectSettings, type ProjectSettingsResult } from '@/lib/code-studio/projectSettings'
import { useCodeStudioKeymap } from '@/components/code-studio/codeStudioKeymap'

/**
 * `.adomnia/settings.json` per sessione: caricato dal buffer aperto nell'editor (appena salvato
 * o in modifica) oppure dal disco. Le scorciatoie del progetto finiscono nella keymap; le
 * impostazioni dell'editor le consuma `CodeStudioCodeEditor`. Nessuna scrittura: il file è del
 * progetto e si modifica nell'editor, come `.editorconfig`.
 */

const DEFAULT_RESULT: ProjectSettingsResult = { settings: EMPTY_PROJECT_SETTINGS, errors: [], empty: true }

interface CodeStudioProjectSettingsState {
  bySession: Record<string, ProjectSettingsResult>
  apply: (sessionId: string, result: ProjectSettingsResult) => void
  refresh: (sessionId: string) => Promise<void>
  forget: (sessionId: string) => void
}

async function readSettingsFile(sessionId: string): Promise<string> {
  try {
    const opened = await openGoIDEDocument(sessionId, PROJECT_SETTINGS_PATH)
    await closeGoIDEDocument(sessionId, opened.document.id).catch(() => undefined)
    return opened.content
  } catch {
    return '' // file assente: nessuna impostazione di progetto
  }
}

export const useCodeStudioProjectSettings = create<CodeStudioProjectSettingsState>((set, get) => ({
  bySession: {},
  apply: (sessionId, result) => {
    set({ bySession: { ...get().bySession, [sessionId]: result } })
    // Le scorciatoie del progetto valgono per la sessione caricata per ultima (quella attiva).
    useCodeStudioKeymap.getState().setProjectKeymap(result.settings.keymap)
  },
  refresh: async (sessionId) => {
    get().apply(sessionId, parseProjectSettings(await readSettingsFile(sessionId)))
  },
  forget: (sessionId) => {
    const bySession = { ...get().bySession }
    delete bySession[sessionId]
    set({ bySession })
    useCodeStudioKeymap.getState().setProjectKeymap({})
  },
}))

/** Impostazioni di progetto effettive per la sessione: il buffer aperto vale più del disco. */
export function useProjectSettings(sessionId: string): ProjectSettingsResult {
  const openBuffer = useCodeStudioStore((state) => state.documents.find((item) => item.document.sessionId === sessionId && item.document.relativePath === PROJECT_SETTINGS_PATH)?.buffer)
  const stored = useCodeStudioProjectSettings((state) => state.bySession[sessionId])
  useEffect(() => {
    if (openBuffer !== undefined) useCodeStudioProjectSettings.getState().apply(sessionId, parseProjectSettings(openBuffer))
    else void useCodeStudioProjectSettings.getState().refresh(sessionId)
  }, [openBuffer, sessionId])
  return useMemo(() => (openBuffer !== undefined ? parseProjectSettings(openBuffer) : stored ?? DEFAULT_RESULT), [openBuffer, stored])
}

/** Versione sincrona per codice non React (risoluzione scorciatoie, eventi tastiera). */
export function projectSettingsFor(sessionId: string): ProjectSettingsResult {
  return useCodeStudioProjectSettings.getState().bySession[sessionId] ?? DEFAULT_RESULT
}

import { create } from 'zustand'
import {
  copilotSignIn,
  copilotSignOut,
  getCopilotSettings,
  getCopilotStatus,
  installCopilotServer,
  restartCopilot,
  saveCopilotSettings,
  subscribeCopilotEvents,
  type CopilotInstallProgress,
  type CopilotSettings,
  type CopilotSignInPrompt,
  type CopilotStatus,
} from '@/lib/copilot-api'
import { useGoIDELspStore } from '@/stores/goideLsp'

interface CopilotState {
  status: CopilotStatus | null
  settings: CopilotSettings | null
  install: CopilotInstallProgress | null
  signIn: CopilotSignInPrompt | null
  busy: boolean
  error: string | null
  dialogOpen: boolean
  /** Carica stato e impostazioni e si iscrive agli eventi, una volta sola. */
  ensure: () => Promise<void>
  saveSettings: (settings: CopilotSettings) => Promise<boolean>
  setEnabled: (enabled: boolean) => Promise<boolean>
  toggleCompletions: () => Promise<boolean>
  installServer: () => Promise<void>
  startSignIn: () => Promise<void>
  signOut: () => Promise<void>
  restart: () => Promise<void>
  setDialogOpen: (open: boolean) => void
  clearSignIn: () => void
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

let subscribed = false

/** Toast discreto di Go Studio: Copilot è un livello in più, non deve interrompere il lavoro. */
function notify(text: string): void {
  useGoIDELspStore.setState({ message: text })
}

export const useCopilotStore = create<CopilotState>((set, get) => {
  const run = async (action: () => Promise<void>) => {
    set({ busy: true, error: null })
    try {
      await action()
      return true
    } catch (error) {
      set({ error: message(error) })
      return false
    } finally {
      set({ busy: false })
    }
  }

  return {
    status: null,
    settings: null,
    install: null,
    signIn: null,
    busy: false,
    error: null,
    dialogOpen: false,

    ensure: async () => {
      if (!subscribed) {
        subscribed = true
        subscribeCopilotEvents({
          status: (status) => {
            set({ status })
            // Login completato: il codice del device flow non serve più.
            if (status.state === 'ready' && get().signIn) set({ signIn: null })
          },
          install: (install) => set({ install }),
          message: (event) => notify(`GitHub Copilot: ${event.message}`),
        })
      }
      try {
        const [status, settings] = await Promise.all([getCopilotStatus(), getCopilotSettings()])
        set({ status, settings })
      } catch (error) {
        set({ error: message(error) })
      }
    },

    saveSettings: (settings) => run(async () => set({ settings: await saveCopilotSettings(settings) })),

    setEnabled: async (enabled) => {
      const settings = get().settings
      return settings ? get().saveSettings({ ...settings, enabled }) : false
    },

    toggleCompletions: async () => {
      const settings = get().settings
      if (!settings) return false
      const ok = await get().saveSettings({ ...settings, inlineCompletion: !settings.inlineCompletion })
      if (ok) notify(`Copilot inline completions ${settings.inlineCompletion ? 'disabled' : 'enabled'}`)
      return ok
    },

    installServer: async () => {
      await run(async () => {
        await installCopilotServer()
        set({ install: null })
      })
    },

    startSignIn: async () => {
      await run(async () => {
        const prompt = await copilotSignIn()
        set({ signIn: prompt.userCode ? prompt : null })
        if (prompt.userCode) await navigator.clipboard?.writeText(prompt.userCode).catch(() => undefined)
      })
    },

    signOut: async () => { await run(copilotSignOut) },
    restart: async () => { await run(restartCopilot) },
    setDialogOpen: (dialogOpen) => set({ dialogOpen, error: null }),
    clearSignIn: () => set({ signIn: null }),
  }
})

/** Copilot è pronto a suggerire: attivo, autenticato e con il completamento inline acceso. */
export function copilotCompletionsActive(state: Pick<CopilotState, 'status' | 'settings'>): boolean {
  return state.status?.state === 'ready' && !!state.settings?.enabled && !!state.settings?.inlineCompletion
}

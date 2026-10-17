import { create } from 'zustand'
import { subscribeGoIDEEvents, type GoIDEEvent } from '@/lib/code-studio-api'
import { logBackgroundError } from '@/lib/code-studio/backgroundError'
import { webLanguageServers, startWebLanguageServer, stopWebLanguageServer, installWebTools, type WebLanguageServer, type WebLanguageServerStatus } from '@/lib/livepreview-api'
import { ideLanguageForEditor } from '@/components/ide/languages'
import { WEB_LANGUAGE_IDS } from '@/components/ide/languages/web'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { confirm } from '@/lib/confirmDialog'
import { studioToast } from '@/stores/codeStudioToast'
import { WEB_TOOLS_TASK, beginToolInstall, endToolInstall } from '@/stores/codeStudioToolInstall'

export type WebServerState = 'stopped' | 'starting' | 'ready' | 'crashed' | 'missing'

export interface WebServerEntry {
  state: WebServerState
  /** Il server non c'è o non parte: il messaggio spiega come ottenerlo; l'editor usa le funzioni di Monaco. */
  error?: string
  version?: string
  /** L'utente l'ha fermato: non riparte da solo. */
  userStopped?: boolean
}

interface WebServersState {
  /** sessione → linguaggio → stato del language server. */
  servers: Record<string, Record<string, WebServerEntry>>
  /** Avvisi "server mancante" chiusi dall'utente, per sessione e linguaggio. */
  dismissed: Record<string, Record<string, boolean>>
  installing: Record<string, string | null>
  ensureStarted: (sessionId: string, languageId: string) => Promise<void>
  restart: (sessionId: string, languageId: string) => Promise<void>
  stop: (sessionId: string, languageId: string) => Promise<void>
  install: (sessionId: string) => Promise<void>
  /** Chiede conferma con il comando esatto, poi installa. */
  confirmInstall: (sessionId: string) => Promise<void>
  dismiss: (sessionId: string, languageId: string) => void
  handleEvent: (event: GoIDEEvent) => void
}

const EMPTY: WebServerEntry = { state: 'stopped' }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function webServerEntry(state: Pick<WebServersState, 'servers'>, sessionId: string, languageId: string): WebServerEntry {
  return state.servers[sessionId]?.[languageId] ?? EMPTY
}

/** Linguaggio web (ID dell'adapter) che serve un file con questo ID Monaco; undefined per Go e gli altri. */
export function webLanguageForEditor(editorLanguage: string): string | undefined {
  const language = ideLanguageForEditor(editorLanguage)
  return language && WEB_LANGUAGE_IDS.includes(language.id) ? language.id : undefined
}

export function isWebServerReady(sessionId: string, languageId: string): boolean {
  return webServerEntry(useIdeWebServersStore.getState(), sessionId, languageId).state === 'ready'
}

let unsubscribe: (() => void) | null = null

export const useIdeWebServersStore = create<WebServersState>((set, get) => {
  const setEntry = (sessionId: string, languageId: string, entry: Partial<WebServerEntry>) => set((state) => {
    const session = state.servers[sessionId] ?? {}
    return { servers: { ...state.servers, [sessionId]: { ...session, [languageId]: { ...(session[languageId] ?? EMPTY), ...entry } } } }
  })
  const fromStatus = (status: WebLanguageServerStatus): Partial<WebServerEntry> => ({
    state: status.state === 'ready' || status.state === 'starting' || status.state === 'crashed' ? status.state : 'stopped',
    version: status.version || undefined,
    error: status.state === 'crashed' ? status.error || 'The language server stopped unexpectedly' : undefined,
  })
  const ensureSubscribed = () => {
    if (!unsubscribe) unsubscribe = subscribeGoIDEEvents((event) => get().handleEvent(event))
  }

  return {
    servers: {},
    dismissed: {},
    installing: {},

    ensureStarted: async (sessionId, languageId) => {
      ensureSubscribed()
      const current = webServerEntry(get(), sessionId, languageId)
      if (current.state === 'ready' || current.state === 'starting' || current.state === 'missing' || current.state === 'crashed' || current.userStopped) return
      const session = useCodeStudioStore.getState().sessions.find((item) => item.id === sessionId)
      if (session?.project.authorization !== 'tooling-permitted') return
      setEntry(sessionId, languageId, { state: 'starting', error: undefined })
      try {
        const known: WebLanguageServer[] = await webLanguageServers(sessionId)
        const info = known.find((item) => item.language === languageId)
        if (!info?.available) {
          setEntry(sessionId, languageId, { state: 'missing', error: info?.error || 'Language server not found' })
          return
        }
        setEntry(sessionId, languageId, fromStatus(await startWebLanguageServer(sessionId, languageId)))
      } catch (error) {
        setEntry(sessionId, languageId, { state: 'crashed', error: errorMessage(error) })
      }
    },

    restart: async (sessionId, languageId) => {
      setEntry(sessionId, languageId, { userStopped: false })
      try { await stopWebLanguageServer(sessionId, languageId) } catch (error) { logBackgroundError('stop web language server')(error) }
      setEntry(sessionId, languageId, { state: 'stopped' })
      await get().ensureStarted(sessionId, languageId)
    },

    stop: async (sessionId, languageId) => {
      setEntry(sessionId, languageId, { userStopped: true, state: 'stopped' })
      try { await stopWebLanguageServer(sessionId, languageId) } catch (error) { logBackgroundError('stop web language server')(error) }
    },

    install: async (sessionId) => {
      ensureSubscribed()
      try {
        const execution = await installWebTools(sessionId)
        set((state) => ({ installing: { ...state.installing, [sessionId]: execution.id } }))
        beginToolInstall(sessionId, WEB_TOOLS_TASK, 'Installing language servers…')
      } catch (error) {
        studioToast(errorMessage(error), 'info')
      }
    },

    confirmInstall: async (sessionId) => {
      const approved = await confirm({
        title: 'Install the web language servers?',
        message: "Command: npm install --prefix <adOmnia tools folder> typescript-language-server typescript@^6 vscode-langservers-extracted\n\nDownloads the packages from the npm registry into adOmnia's own tools folder, never into your project. It also runs their install scripts. The output appears in the Run console.",
        confirmLabel: 'Install',
      })
      if (approved) await get().install(sessionId)
    },

    dismiss: (sessionId, languageId) => set((state) => ({ dismissed: { ...state.dismissed, [sessionId]: { ...state.dismissed[sessionId], [languageId]: true } } })),

    handleEvent: (event) => {
      const sessionId = event.sessionId
      if (!sessionId) return
      if (event.type === 'lsp.status') {
        const status = event.payload as WebLanguageServerStatus
        if (status.language && WEB_LANGUAGE_IDS.includes(status.language)) setEntry(sessionId, status.language, fromStatus(status))
        return
      }
      if (event.type === 'run.finished') {
        const execution = event.payload as { id?: string; exitCode?: number | null; status?: string }
        const runId = get().installing[sessionId]
        if (!runId || execution?.id !== runId) return
        set((state) => ({ installing: { ...state.installing, [sessionId]: null } }))
        const succeeded = execution.exitCode === 0 || execution.status === 'exited'
        endToolInstall(sessionId, WEB_TOOLS_TASK, succeeded)
        if (succeeded) {
          studioToast('Web language servers installed', 'success')
          // I server mancanti ora esistono: i file web aperti li avviano da soli.
          set((state) => ({ servers: { ...state.servers, [sessionId]: Object.fromEntries(Object.entries(state.servers[sessionId] ?? {}).map(([id, entry]) => [id, entry.state === 'missing' ? { ...entry, state: 'stopped' as const, error: undefined } : entry])) } }))
          for (const document of useCodeStudioStore.getState().documents) {
            const languageId = document.document.sessionId === sessionId ? webLanguageForEditor(document.document.language) : undefined
            if (languageId) void get().ensureStarted(sessionId, languageId)
          }
        } else {
          studioToast('Installing the web language servers failed: see the Run console', 'info')
        }
      }
    },
  }
})

/**
 * Avvia i language server web quando si apre un file del loro linguaggio in un progetto fidato:
 * mai prima, mai per linguaggi che il progetto non usa. Idempotente.
 */
let watching = false
export function watchWebDocuments(): void {
  if (watching) return
  watching = true
  const reconcile = (documents: ReturnType<typeof useCodeStudioStore.getState>['documents']) => {
    for (const document of documents) {
      if (document.document.readOnly || document.document.external) continue
      const languageId = webLanguageForEditor(document.document.language)
      if (languageId) void useIdeWebServersStore.getState().ensureStarted(document.document.sessionId, languageId)
    }
  }
  reconcile(useCodeStudioStore.getState().documents)
  useCodeStudioStore.subscribe((state, previous) => {
    // Nuovi file aperti, o un progetto appena fidato: i server mancanti all'appello partono ora.
    if ((state.documents !== previous.documents && state.documents.length > previous.documents.length) || state.sessions !== previous.sessions) reconcile(state.documents)
  })
}

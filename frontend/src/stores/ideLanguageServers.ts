import { create } from 'zustand'
import { subscribeGoIDEEvents, type GoIDEEvent } from '@/lib/code-studio-api'
import { logBackgroundError } from '@/lib/code-studio/backgroundError'
import { languageServers, startLanguageServer, stopLanguageServer, previewServerInstall, installLanguageServer, type LanguageServerRunStatus } from '@/lib/ide-servers-api'
import { ideLanguage, ideLanguageForEditor } from '@/components/ide/languages'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { confirm } from '@/lib/confirmDialog'
import { studioToast } from '@/stores/codeStudioToast'
import { beginToolInstall, endToolInstall } from '@/stores/codeStudioToolInstall'

export type ServerState = 'stopped' | 'starting' | 'ready' | 'crashed' | 'missing'

export interface ServerEntry {
  state: ServerState
  /** Il server non c'è o non parte: il messaggio spiega come ottenerlo; l'editor usa le funzioni di Monaco. */
  error?: string
  version?: string
  /** adOmnia può installarlo (dopo conferma): l'avviso offre "Install…". */
  installable?: boolean
  /** L'utente l'ha fermato: non riparte da solo. */
  userStopped?: boolean
}

interface ServersState {
  /** sessione → linguaggio → stato del language server. */
  servers: Record<string, Record<string, ServerEntry>>
  /** Avvisi "server mancante" chiusi dall'utente, per sessione e linguaggio. */
  dismissed: Record<string, Record<string, boolean>>
  /** sessione → linguaggio → installazione in corso (run e attività della status bar). */
  installing: Record<string, Record<string, InstallRun>>
  ensureStarted: (sessionId: string, languageId: string) => Promise<void>
  restart: (sessionId: string, languageId: string) => Promise<void>
  stop: (sessionId: string, languageId: string) => Promise<void>
  install: (sessionId: string, languageId: string) => Promise<void>
  /** Chiede conferma con il comando esatto, poi installa. */
  confirmInstall: (sessionId: string, languageId: string) => Promise<void>
  dismiss: (sessionId: string, languageId: string) => void
  handleEvent: (event: GoIDEEvent) => void
}

interface InstallRun { runId: string; task: string; languages: string[] }

const EMPTY: ServerEntry = { state: 'stopped' }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function serverEntry(state: Pick<ServersState, 'servers'>, sessionId: string, languageId: string): ServerEntry {
  return state.servers[sessionId]?.[languageId] ?? EMPTY
}

/** Linguaggio (ID dell'adapter) con server gestito da adOmnia che serve un file con questo ID Monaco; undefined per Go e gli altri. */
export function serverLanguageForEditor(editorLanguage: string): string | undefined {
  const language = ideLanguageForEditor(editorLanguage)
  return language?.providedServer ? language.id : undefined
}

function isProvidedLanguage(languageId: string): boolean {
  return !!ideLanguage(languageId)?.providedServer
}

export function isServerReady(sessionId: string, languageId: string): boolean {
  return serverEntry(useIdeLanguageServersStore.getState(), sessionId, languageId).state === 'ready'
}

let unsubscribe: (() => void) | null = null

export const useIdeLanguageServersStore = create<ServersState>((set, get) => {
  const setEntry = (sessionId: string, languageId: string, entry: Partial<ServerEntry>) => set((state) => {
    const session = state.servers[sessionId] ?? {}
    return { servers: { ...state.servers, [sessionId]: { ...session, [languageId]: { ...(session[languageId] ?? EMPTY), ...entry } } } }
  })
  const fromStatus = (status: LanguageServerRunStatus): Partial<ServerEntry> => ({
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
      const current = serverEntry(get(), sessionId, languageId)
      if (current.state === 'ready' || current.state === 'starting' || current.state === 'missing' || current.state === 'crashed' || current.userStopped) return
      const session = useCodeStudioStore.getState().sessions.find((item) => item.id === sessionId)
      if (session?.project.authorization !== 'tooling-permitted') return
      setEntry(sessionId, languageId, { state: 'starting', error: undefined })
      try {
        const known = await languageServers(sessionId)
        const info = known.find((item) => item.language === languageId)
        if (!info?.available) {
          setEntry(sessionId, languageId, { state: 'missing', error: info?.error || 'Language server not found', installable: !!info?.installable })
          return
        }
        setEntry(sessionId, languageId, fromStatus(await startLanguageServer(sessionId, languageId)))
      } catch (error) {
        setEntry(sessionId, languageId, { state: 'crashed', error: errorMessage(error) })
      }
    },

    restart: async (sessionId, languageId) => {
      setEntry(sessionId, languageId, { userStopped: false })
      try { await stopLanguageServer(sessionId, languageId) } catch (error) { logBackgroundError('stop language server')(error) }
      setEntry(sessionId, languageId, { state: 'stopped' })
      await get().ensureStarted(sessionId, languageId)
    },

    stop: async (sessionId, languageId) => {
      setEntry(sessionId, languageId, { userStopped: true, state: 'stopped' })
      try { await stopLanguageServer(sessionId, languageId) } catch (error) { logBackgroundError('stop language server')(error) }
    },

    install: async (sessionId, languageId) => {
      ensureSubscribed()
      try {
        const plan = await previewServerInstall(sessionId, languageId)
        const execution = await installLanguageServer(sessionId, languageId)
        const run: InstallRun = { runId: execution.id, task: plan.task, languages: plan.languages }
        set((state) => ({ installing: { ...state.installing, [sessionId]: { ...state.installing[sessionId], ...Object.fromEntries(plan.languages.map((id) => [id, run])) } } }))
        beginToolInstall(sessionId, plan.task, plan.label)
      } catch (error) {
        studioToast(errorMessage(error), 'info')
      }
    },

    confirmInstall: async (sessionId, languageId) => {
      let plan
      try { plan = await previewServerInstall(sessionId, languageId) } catch (error) { studioToast(errorMessage(error), 'info'); return }
      const approved = await confirm({ title: plan.title, message: `Command: ${plan.command}

${plan.note}`, confirmLabel: 'Install' })
      if (approved) await get().install(sessionId, languageId)
    },

    dismiss: (sessionId, languageId) => set((state) => ({ dismissed: { ...state.dismissed, [sessionId]: { ...state.dismissed[sessionId], [languageId]: true } } })),

    handleEvent: (event) => {
      const sessionId = event.sessionId
      if (!sessionId) return
      if (event.type === 'lsp.status') {
        const status = event.payload as LanguageServerRunStatus
        if (status.language && isProvidedLanguage(status.language)) setEntry(sessionId, status.language, fromStatus(status))
        return
      }
      if (event.type === 'run.finished') {
        const execution = event.payload as { id?: string; exitCode?: number | null; status?: string }
        const run = Object.values(get().installing[sessionId] ?? {}).find((item) => item.runId === execution?.id)
        if (!run) return
        set((state) => ({ installing: { ...state.installing, [sessionId]: Object.fromEntries(Object.entries(state.installing[sessionId] ?? {}).filter(([, item]) => item.runId !== run.runId)) } }))
        const succeeded = execution.exitCode === 0 || execution.status === 'exited'
        endToolInstall(sessionId, run.task, succeeded)
        const names = run.languages.map((id) => ideLanguage(id)?.name ?? id).join(', ')
        if (succeeded) {
          studioToast(`Language server installed (${names})`, 'success')
          // Gli strumenti stanno nella cartella di adOmnia, condivisa da tutte le sessioni: i server mancanti
          // ora esistono ovunque, e i file aperti di quei linguaggi li avviano da soli.
          set((state) => ({ servers: Object.fromEntries(Object.entries(state.servers).map(([session, entries]) => [session, Object.fromEntries(Object.entries(entries).map(([id, entry]) => [id, entry.state === 'missing' && run.languages.includes(id) ? { ...entry, state: 'stopped' as const, error: undefined } : entry]))])) }))
          for (const document of useCodeStudioStore.getState().documents) {
            const languageId = serverLanguageForEditor(document.document.language)
            if (languageId && run.languages.includes(languageId)) void get().ensureStarted(document.document.sessionId, languageId)
          }
        } else {
          studioToast(`Installing the language server failed (${names}): see the Run console`, 'info')
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
export function watchServerDocuments(): void {
  if (watching) return
  watching = true
  const reconcile = (documents: ReturnType<typeof useCodeStudioStore.getState>['documents']) => {
    for (const document of documents) {
      if (document.document.readOnly || document.document.external) continue
      const languageId = serverLanguageForEditor(document.document.language)
      if (languageId) void useIdeLanguageServersStore.getState().ensureStarted(document.document.sessionId, languageId)
    }
  }
  reconcile(useCodeStudioStore.getState().documents)
  useCodeStudioStore.subscribe((state, previous) => {
    // Nuovi file aperti, o un progetto appena fidato: i server mancanti all'appello partono ora.
    if ((state.documents !== previous.documents && state.documents.length > previous.documents.length) || state.sessions !== previous.sessions) reconcile(state.documents)
  })
}

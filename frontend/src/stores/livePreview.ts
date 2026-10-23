import { create } from 'zustand'
import { Browser } from '@wailsio/runtime'
import { subscribeGoIDEEvents, type GoIDEEvent } from '@/lib/code-studio-api'
import { logBackgroundError } from '@/lib/code-studio/backgroundError'
import {
  DEFAULT_PLACEMENT, MAX_BRIDGE_LOG, currentPreview, isPlacement, isRunning, pickChoice, upsertPreview,
  type BridgeLogEntry, type BridgeMessage, type DeviceId, type LivePreviewPlacement, type PreviewChoice,
} from '@/lib/code-studio/livePreview'
import {
  detectWebProject, dismissPreviews, installWebDependencies, openPreviewWindow, readyPreviewUrl, savePreviewConfig, startPreview, stopPreview,
  type LivePreview, type LivePreviewReport, type LivePreviewRequest,
} from '@/lib/livepreview-api'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { studioToast } from '@/stores/codeStudioToast'

/** Installazione delle dipendenze del progetto avviata dalla preview. */
export interface PreviewInstall {
  kind: 'dependencies'
  runId: string
  /** Richiesta da riprendere a installazione finita (l'utente aveva premuto Go Live). */
  resume: LivePreviewRequest | null
}

/** Stato della Live Preview di una sessione (un progetto aperto). */
export interface SessionPreview {
  report: LivePreviewReport | null
  loading: boolean
  starting: boolean
  previews: LivePreview[]
  activeId: string | null
  /** Dove si mostra: pannello inferiore, split con l'editor, tab accanto ai file o finestra nativa. */
  placement: LivePreviewPlacement
  /** Visibile nello split o nella tab (il pannello ha la sua tool window). */
  visible: boolean
  /** Con il posizionamento a tab: la tab Live Preview è quella selezionata (non un file). */
  tabActive: boolean
  device: DeviceId
  width: number
  height: number
  autoReload: boolean
  error: string | null
  install: PreviewInstall | null
  /** Scelta aperta quando il progetto ha più cose avviabili e nulla di salvato. */
  chooserOpen: boolean
  lastRequest: LivePreviewRequest | null
  log: BridgeLogEntry[]
  /** Pagina attualmente mostrata nella cornice, riportata dal bridge. */
  location: { url: string; title: string } | null
  hydrated: boolean
}

const EMPTY: SessionPreview = {
  report: null, loading: false, starting: false, previews: [], activeId: null, placement: DEFAULT_PLACEMENT, visible: false, tabActive: false,
  device: 'desktop', width: 600, height: 0, autoReload: true, error: null, install: null, chooserOpen: false, lastRequest: null,
  log: [], location: null, hydrated: false,
}

interface LivePreviewState {
  bySession: Record<string, SessionPreview>
  load: (sessionId: string) => Promise<LivePreviewReport | null>
  goLive: (sessionId: string, choice?: PreviewChoice | LivePreviewRequest) => Promise<void>
  stop: (sessionId: string) => Promise<void>
  restart: (sessionId: string) => Promise<void>
  show: (sessionId: string, placement?: LivePreviewPlacement) => void
  hide: (sessionId: string) => void
  setTabActive: (sessionId: string, active: boolean) => void
  setPlacement: (sessionId: string, placement: LivePreviewPlacement) => void
  setViewport: (sessionId: string, patch: Partial<Pick<SessionPreview, 'device' | 'width' | 'height'>>) => void
  setAutoReload: (sessionId: string, enabled: boolean) => void
  installDependencies: (sessionId: string, dir: string, resume?: LivePreviewRequest | null) => Promise<void>
  openWindow: (sessionId: string) => Promise<void>
  openExternal: (sessionId: string) => Promise<void>
  dismissChooser: (sessionId: string) => void
  pushBridge: (sessionId: string, message: BridgeMessage) => void
  clearLog: (sessionId: string) => void
  dismissFinished: (sessionId: string) => void
  handleEvent: (event: GoIDEEvent) => void
}

let unsubscribe: (() => void) | null = null
let bridgeId = 0
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
const PERSIST_DELAY_MS = 400

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function selectSessionPreview(state: LivePreviewState, sessionId: string | null | undefined): SessionPreview {
  return (sessionId && state.bySession[sessionId]) || EMPTY
}

export const useLivePreviewStore = create<LivePreviewState>((set, get) => {
  const patch = (sessionId: string, change: Partial<SessionPreview> | ((current: SessionPreview) => Partial<SessionPreview>)) => set((state) => {
    const current = state.bySession[sessionId] ?? EMPTY
    const next = typeof change === 'function' ? change(current) : change
    return { bySession: { ...state.bySession, [sessionId]: { ...current, ...next } } }
  })
  const current = (sessionId: string): SessionPreview => get().bySession[sessionId] ?? EMPTY

  /** Salva (dopo una breve pausa) posizione, viewport e auto reload: il resto lo salva l'avvio. */
  const persist = (sessionId: string) => {
    clearTimeout(persistTimers.get(sessionId))
    persistTimers.set(sessionId, setTimeout(() => {
      const view = current(sessionId)
      void savePreviewConfig(sessionId, { placement: view.placement, device: view.device, width: view.width, height: view.height, autoReload: view.autoReload })
        .catch(logBackgroundError('save preview config'))
    }, PERSIST_DELAY_MS))
  }

  const ensureSubscribed = () => {
    if (!unsubscribe) unsubscribe = subscribeGoIDEEvents((event) => get().handleEvent(event))
  }

  return {
    bySession: {},

    load: async (sessionId) => {
      ensureSubscribed()
      patch(sessionId, { loading: true })
      try {
        const report = await detectWebProject(sessionId)
        patch(sessionId, (view) => {
          // Le preferenze salvate si applicano una volta sola: dopo, la UI è la fonte di verità.
          const saved = report.config
          const hydrate = !view.hydrated && saved
          return {
            report, loading: false, error: null, hydrated: true,
            previews: report.previews.length ? report.previews.reduce<LivePreview[]>((all, item) => upsertPreview(all, item), view.previews) : view.previews,
            ...(hydrate ? {
              placement: isPlacement(saved.placement) ? saved.placement : view.placement,
              device: (['desktop', 'tablet', 'mobile', 'custom'].includes(saved.device ?? '') ? saved.device : view.device) as DeviceId,
              width: saved.width || view.width, height: saved.height || view.height, autoReload: saved.autoReload,
            } : {}),
          }
        })
        return report
      } catch (error) {
        patch(sessionId, { loading: false, error: errorMessage(error) })
        return null
      }
    },

    goLive: async (sessionId, choice) => {
      ensureSubscribed()
      let view = current(sessionId)
      if (view.starting) return
      const report = view.report ?? await get().load(sessionId)
      if (!report) return
      view = current(sessionId)
      const request = choice ? ('request' in choice ? choice.request : choice) : pickChoice(report)?.request ?? null
      if (!request) {
        patch(sessionId, { chooserOpen: true, error: report.targets.length ? null : 'Nothing to preview here: add an index.html, or a package.json with a dev or start script.' })
        // La scelta (o la spiegazione) vive nella preview: va mostrata dove l'utente l'ha messa.
        get().show(sessionId)
        return
      }
      patch(sessionId, { starting: true, error: null, chooserOpen: false, lastRequest: request })
      try {
        const started = await startPreview(sessionId, request)
        patch(sessionId, (latest) => ({ starting: false, previews: upsertPreview(latest.previews, started), activeId: started.id, location: null }))
        get().show(sessionId)
        void get().load(sessionId)
      } catch (error) {
        patch(sessionId, { starting: false, error: errorMessage(error) })
        get().show(sessionId)
      }
    },

    stop: async (sessionId) => {
      const view = current(sessionId)
      const target = currentPreview(view.previews, view.activeId)
      if (!target || !isRunning(target)) return
      try {
        await stopPreview(sessionId, target.id)
      } catch (error) {
        patch(sessionId, { error: errorMessage(error) })
      }
    },

    restart: async (sessionId) => {
      const view = current(sessionId)
      const target = currentPreview(view.previews, view.activeId)
      const request = view.lastRequest
      if (target && isRunning(target)) {
        await get().stop(sessionId)
        const deadline = Date.now() + 8000
        while (Date.now() < deadline && isRunning(currentPreview(current(sessionId).previews, current(sessionId).activeId))) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- polling: wait between checks until the preview stops
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
      await get().goLive(sessionId, request ?? undefined)
    },

    show: (sessionId, placement) => {
      const next = placement ?? current(sessionId).placement
      if (placement) get().setPlacement(sessionId, placement)
      if (next === 'panel') {
        useCodeStudioLspStore.getState().showToolWindow('preview')
        patch(sessionId, { visible: false, tabActive: false })
      } else if (next === 'window') {
        patch(sessionId, { visible: false, tabActive: false })
        void get().openWindow(sessionId)
      } else {
        patch(sessionId, { visible: true, tabActive: next === 'tab' })
      }
    },

    hide: (sessionId) => patch(sessionId, { visible: false, tabActive: false }),

    setTabActive: (sessionId, active) => patch(sessionId, { tabActive: active }),

    setPlacement: (sessionId, placement) => {
      patch(sessionId, { placement, visible: placement === 'split' || placement === 'tab' ? current(sessionId).visible : false, tabActive: placement === 'tab' && current(sessionId).visible })
      persist(sessionId)
    },

    setViewport: (sessionId, change) => {
      patch(sessionId, change)
      persist(sessionId)
    },

    setAutoReload: (sessionId, enabled) => {
      patch(sessionId, { autoReload: enabled })
      persist(sessionId)
    },

    installDependencies: async (sessionId, dir, resume = null) => {
      try {
        const execution = await installWebDependencies(sessionId, dir)
        patch(sessionId, { install: { kind: 'dependencies', runId: execution.id, resume }, error: null })
      } catch (error) {
        patch(sessionId, { error: errorMessage(error) })
      }
    },

    openWindow: async (sessionId) => {
      const view = current(sessionId)
      const target = currentPreview(view.previews, view.activeId)
      if (!target) return
      try {
        await openPreviewWindow(sessionId, target.id, target.label || 'Preview')
      } catch (error) {
        patch(sessionId, { error: errorMessage(error) })
      }
    },

    openExternal: async (sessionId) => {
      const view = current(sessionId)
      const target = currentPreview(view.previews, view.activeId)
      if (!target) return
      try {
        await Browser.OpenURL(await readyPreviewUrl(sessionId, target.id))
      } catch (error) {
        patch(sessionId, { error: errorMessage(error) })
      }
    },

    dismissChooser: (sessionId) => patch(sessionId, { chooserOpen: false }),

    pushBridge: (sessionId, message) => {
      if (message.type === 'ready' || message.type === 'navigated') {
        patch(sessionId, { location: { url: message.url, title: message.title } })
        return
      }
      if (message.type === 'reloading' || message.type === 'css-updated' || message.type === 'change-ignored') return
      patch(sessionId, (view) => ({ log: [...view.log, { id: ++bridgeId, at: Date.now(), message }].slice(-MAX_BRIDGE_LOG) }))
    },

    clearLog: (sessionId) => patch(sessionId, { log: [] }),

    dismissFinished: (sessionId) => {
      patch(sessionId, (view) => ({ previews: view.previews.filter((item) => isRunning(item)) }))
      void dismissPreviews(sessionId).catch(logBackgroundError('dismiss previews'))
    },

    handleEvent: (event) => {
      const sessionId = event.sessionId
      if (!sessionId) return
      if (event.type === 'preview.status') {
        const next = event.payload as LivePreview
        patch(sessionId, (view) => ({
          previews: upsertPreview(view.previews, next),
          activeId: view.activeId ?? next.id,
          // Un'anteprima appena ripartita riporta la pagina in cima: la posizione di prima non vale più.
          location: next.state === 'ready' && view.activeId === next.id && view.previews.find((item) => item.id === next.id)?.state !== 'ready' ? null : view.location,
        }))
        return
      }
      if (event.type === 'run.finished') {
        const execution = event.payload as { id?: string; status?: string; exitCode?: number | null }
        const install = current(sessionId).install
        if (!install || execution?.id !== install.runId) return
        patch(sessionId, { install: null })
        if (execution.exitCode === 0 || execution.status === 'exited') {
          studioToast('Dependencies installed', 'success')
          void get().load(sessionId).then(() => { if (install.resume) void get().goLive(sessionId, install.resume) })
        } else {
          patch(sessionId, { error: 'The dependency install failed: open the Run console for the output.' })
        }
      }
    },
  }
})

import { useActivityStore, IDLE_AFTER_MS, type ActivityPhase } from '@/stores/activity'
import { useAppStore } from '@/stores/app'
import { reportActivity, removeActivity } from './activity-api'

let started = false
export function startActivityTracking(): () => void {
  if (started) return () => undefined
  started = true
  let disposed = false, inputAt = Date.now(), timer = 0, sending = false
  let pending: { phase: ActivityPhase; scopes: readonly string[] } | null = null
  const flush = async () => {
    if (sending) return
    sending = true
    try {
      while (pending && !disposed) {
        const value = pending; pending = null
        await reportActivity(value.phase, value.scopes).catch(() => undefined)
      }
    } finally { sending = false }
  }
  let lastPublished = ""
  const publish = () => {
    const state = useActivityStore.getState()
    const key = JSON.stringify([state.phase, state.scopes])
    if (key === lastPublished) return
    lastPublished = key
    pending = { phase: state.phase, scopes: state.scopes }
    void flush()
  }
  const phase = () => {
    window.clearTimeout(timer)
    const value = document.hidden ? 'Background' : Date.now() - inputAt >= IDLE_AFTER_MS ? 'Idle' : 'Active'
    useActivityStore.getState().setPhase(value)
    if (value === 'Active') timer = window.setTimeout(phase, IDLE_AFTER_MS - (Date.now() - inputAt))
  }
  const input = (event: Event) => {
    if (!event.isTrusted || document.hidden) return
    const now = Date.now()
    // Pointer motion does not notify stores or IPC for every pixel.
    if (event.type === 'pointermove' && now - inputAt < 1000) return
    inputAt = now; phase()
  }
  const visible = () => { if (!document.hidden) inputAt = Date.now(); phase() }
  const updateScopes = () => {
    const app = useAppStore.getState()
    const params = new URLSearchParams(window.location.search)
    const kind = params.get('window')
    let scopes: string[]
    if (kind === 'panel') scopes = [params.get('panel') ?? '']
    else if (kind === 'go-studio') scopes = [app.activeRail === 'pdfeditor' ? 'pdfeditor' : 'goide']
    else if (kind === 'studio-tool') scopes = ['goide', ...(params.get('session') ? ['goide:' + params.get('session')] : [])]
    else if (kind === 'api-request') scopes = ['collections']
    else if (kind === 'swagger-editor') scopes = ['apidocs']
    else scopes = app.splitView && ['goide', 'collections'].includes(app.activeRail) ? ['goide', 'collections'] : [app.activeRail]
    useActivityStore.getState().setScopes([...scopes.filter(Boolean), ...Object.keys(useActivityStore.getState().retained)])
  }
  const unsubscribe = useActivityStore.subscribe((state, previous) => {
    if (state.retained !== previous.retained) updateScopes()
    if (state.phase !== previous.phase || state.scopes !== previous.scopes) publish()
  })
  const offApp = useAppStore.subscribe((state, previous) => {
    if (state.activeRail !== previous.activeRail || state.splitView !== previous.splitView) updateScopes()
  })
  const events = ['pointerdown', 'pointermove', 'keydown', 'wheel']
  for (const type of events) window.addEventListener(type, input, { passive: true, capture: true })
  document.addEventListener('visibilitychange', visible)
  window.addEventListener('focus', visible)
  const pagehide = () => { void removeActivity().catch(() => undefined) }
  window.addEventListener('pagehide', pagehide)
  phase(); updateScopes(); publish()
  return () => {
    disposed = true; started = false; pending = null
    window.clearTimeout(timer); unsubscribe(); offApp()
    for (const type of events) window.removeEventListener(type, input, { capture: true })
    document.removeEventListener('visibilitychange', visible)
    window.removeEventListener('focus', visible)
    window.removeEventListener('pagehide', pagehide)
    void removeActivity().catch(() => undefined)
  }
}

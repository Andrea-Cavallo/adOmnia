import { create } from 'zustand'
import { CheckUpdateChannel, GetUpdateState, DownloadUpdate, CancelUpdateDownload, ScheduleUpdateOnExit, ConfirmUpdateStartup } from '../../bindings/adomnia/app'
import { useSettingsStore } from './settings'
import { APP_VERSION } from '@/lib/buildInfo'

export interface UpdateState {
 phase: string; version: string; channel: string; releaseUrl: string; notes: string
 received: number; total: number; error: string; trusted: boolean; scheduled: boolean
}
const idle: UpdateState = { phase: 'idle', version: '', channel: 'stable', releaseUrl: '', notes: '', received: 0, total: 0, error: '', trusted: false, scheduled: false }
interface UpdaterStore { status: UpdateState; error: string; check: (force?: boolean) => Promise<void>; download: () => Promise<void>; cancel: () => Promise<void>; schedule: (enable: boolean) => Promise<void> }
let checking = false
function channel(): string {
 const selected = useSettingsStore.getState().settings.general.updateChannel
 return selected === 'stable' || selected === 'beta' ? selected : APP_VERSION.includes('-') ? 'beta' : 'stable'
}
function failure(error: unknown) { useUpdaterStore.setState({ error: error instanceof Error ? error.message : String(error) }) }
export const useUpdaterStore = create<UpdaterStore>((set,get) => ({
 status: idle, error: '',
 check: async (force = true) => {
  if (checking) return
  checking = true; set({ error: '', status: { ...get().status, phase: 'checking' } })
  try {
   const status = await CheckUpdateChannel(channel(), force); set({ status })
   if (status.phase === 'available' && status.trusted && !status.error && useSettingsStore.getState().settings.general.autoDownloadUpdates !== false) await get().download()
  } catch(error) { set({ status: { ...get().status, phase: 'error' } }); failure(error) } finally { checking = false }
 },
 download: async () => { try { set({ status: await DownloadUpdate(), error: '' }) } catch(error) { failure(error) } },
 cancel: async () => { try { await CancelUpdateDownload() } catch(error) { failure(error) } },
 schedule: async (enable) => { try { set({ status: await ScheduleUpdateOnExit(enable), error: '' }) } catch(error) { failure(error) } },
}))

/** One owner, deferred by the App until its first stable frame. No timer wakes
 * an idle/hidden app to check the network. Backend caching uses conditional GET. */
export function startUpdater(): () => void {
 let disposed = false, polling = false, lastCheck = 0
 let timer: number | undefined
 void ConfirmUpdateStartup().catch(failure)
 const tick = async () => {
  if (disposed || polling) return
  if (timer !== undefined) window.clearTimeout(timer)
  const general = useSettingsStore.getState().settings.general
  if (!useSettingsStore.getState().loaded) { timer = window.setTimeout(() => void tick(), 2000); return }
  const state = useUpdaterStore.getState().status
  if (['downloading','verifying','checking'].includes(state.phase)) {
   polling = true
   try {
    const status = await GetUpdateState()
    if (!disposed) {
     useUpdaterStore.setState({ status })
     // An automatic download is applied only after normal guarded shutdown.
     if (status.phase === 'ready' && !status.scheduled && general.autoDownloadUpdates !== false) await useUpdaterStore.getState().schedule(true)
    }
   } catch(error) { if (!disposed) failure(error) } finally { polling = false }
  }
  if (!disposed && document.visibilityState !== 'hidden' && general.autoCheckUpdates !== false && Date.now()-lastCheck > 6*60*60*1000) {
   lastCheck = Date.now(); await useUpdaterStore.getState().check(false)
  }
  if (!disposed) timer = window.setTimeout(() => void tick(), ['checking','downloading','verifying'].includes(useUpdaterStore.getState().status.phase) ? 1000 : 60000)
 }
 timer = window.setTimeout(() => void tick(), 15000)
 const unsubscribe = useUpdaterStore.subscribe((state, previous) => { if (state.status.phase !== previous.status.phase && ['downloading','verifying'].includes(state.status.phase)) void tick() })
 const onFocus = () => void tick()
 window.addEventListener('focus',onFocus)
 return () => { disposed = true; if (timer !== undefined) window.clearTimeout(timer); unsubscribe(); window.removeEventListener('focus',onFocus) }
}

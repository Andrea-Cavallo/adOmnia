import { currentActivityPhase } from '@/stores/activity'
import { create } from 'zustand'
import { CheckUpdateChannel, GetUpdateState, DownloadUpdate, CancelUpdateDownload, ScheduleUpdateOnExit, ConfirmUpdateStartup, OpenUpdateApplyLog } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/app'
import { useSettingsStore } from './settings'
import { APP_VERSION } from '@/lib/buildInfo'

export interface UpdateState {
 phase: string; version: string; channel: string; releaseUrl: string; notes: string
 received: number; total: number; error: string; trusted: boolean; scheduled: boolean
 failedVersion: string; restoredVersion: string; failureReason: string; applyLogAvailable: boolean
}
const idle: UpdateState = { phase: 'idle', version: '', channel: 'stable', releaseUrl: '', notes: '', received: 0, total: 0, error: '', trusted: false, scheduled: false, failedVersion: '', restoredVersion: '', failureReason: '', applyLogAvailable: false }
interface UpdaterStore { status: UpdateState; error: string; check: (force?: boolean) => Promise<void>; download: () => Promise<void>; cancel: () => Promise<void>; schedule: (enable: boolean) => Promise<void>; openApplyLog: () => Promise<void> }
let checking: Promise<void> | null = null
let downloading: Promise<void> | null = null
let scheduling: Promise<void> | null = null
function channel(): string {
 const selected = useSettingsStore.getState().settings.general.updateChannel
 return selected === 'stable' || selected === 'beta' ? selected : APP_VERSION.includes('-') ? 'beta' : 'stable'
}
function failure(error: unknown) { useUpdaterStore.setState({ error: error instanceof Error ? error.message : String(error) }) }
async function applyAutomaticPolicy(): Promise<void> {
 const { status, error } = useUpdaterStore.getState()
 const general = useSettingsStore.getState().settings.general
 if (status.phase === 'ready' && !status.scheduled && !status.error && !error && general.installUpdatesOnExit === true) {
  await useUpdaterStore.getState().schedule(true)
 }
}
export const useUpdaterStore = create<UpdaterStore>((set,get) => ({
 status: idle, error: '',
 check: (force = true) => {
  if (checking) return checking
  if (['downloading', 'verifying'].includes(get().status.phase) || get().status.scheduled) return Promise.resolve()
  checking = (async () => {
   set({ error: '', status: { ...get().status, phase: 'checking' } })
   try {
    const status = await CheckUpdateChannel(channel(), force); set({ status })
    if (status.phase === 'available' && status.trusted && !status.error && useSettingsStore.getState().settings.general.autoDownloadUpdates === true) await get().download()
    await applyAutomaticPolicy()
   } catch(error) { set({ status: { ...get().status, phase: 'error' } }); failure(error) }
  })().finally(() => { checking = null })
  return checking
 },
 download: () => {
  if (downloading) return downloading
  if (['downloading', 'verifying'].includes(get().status.phase) || get().status.scheduled) return Promise.resolve()
  downloading = (async () => {
   set({ error: '', status: { ...get().status, phase: 'downloading', received: 0, total: 0 } })
   try { set({ status: await DownloadUpdate(), error: '' }); await applyAutomaticPolicy() }
   catch(error) { set({ status: { ...get().status, phase: 'error' } }); failure(error) }
  })().finally(() => { downloading = null })
  return downloading
 },
 cancel: async () => { try { await CancelUpdateDownload() } catch(error) { failure(error) } },
 schedule: (enable) => {
  const previous = scheduling ?? Promise.resolve()
  const operation = previous.then(async () => {
   try { set({ status: await ScheduleUpdateOnExit(enable), error: '' }) } catch(error) { failure(error) }
  }).finally(() => { if (scheduling === operation) scheduling = null })
  scheduling = operation
  return operation
 },
 openApplyLog: async () => { try { await OpenUpdateApplyLog() } catch(error) { failure(error) } },
}))

/** One owner, deferred by the App until its first stable frame. No timer wakes
 * an idle/hidden app to check the network. Backend caching uses conditional GET. */
export function startUpdater(): () => void {
 let disposed = false, polling = false, lastCheck = 0
 let timer: number | undefined
 void GetUpdateState().then((status) => { if (!disposed && !checking && !downloading && useUpdaterStore.getState().status.phase === 'idle') useUpdaterStore.setState({ status }) }).catch(failure)
 void ConfirmUpdateStartup().catch(failure)
 const tick = async () => {
  if (disposed || polling) return
  if (timer !== undefined) window.clearTimeout(timer)
  const general = useSettingsStore.getState().settings.general
  if (!useSettingsStore.getState().loaded) { timer = window.setTimeout(() => void tick(), 2000); return }
  if (checking || downloading) { timer = window.setTimeout(() => void tick(), 1000); return }
  const state = useUpdaterStore.getState().status
  if (['downloading','verifying','checking'].includes(state.phase)) {
   polling = true
   try {
    const status = await GetUpdateState()
    if (!disposed) {
     useUpdaterStore.setState({ status })
    }
   } catch(error) { if (!disposed) failure(error) } finally { polling = false }
  }
  if (!disposed) await applyAutomaticPolicy()
  const latest = useUpdaterStore.getState().status
  if (!disposed && !['checking','downloading','verifying','ready'].includes(latest.phase) && !latest.scheduled && currentActivityPhase() === 'Active' && general.autoCheckUpdates !== false && Date.now()-lastCheck > 6*60*60*1000) {
   lastCheck = Date.now(); await useUpdaterStore.getState().check(false)
  }
  if (!disposed) timer = window.setTimeout(() => void tick(), ['checking','downloading','verifying'].includes(useUpdaterStore.getState().status.phase) ? 1000 : 60000)
 }
 timer = window.setTimeout(() => void tick(), 15000)
 const unsubscribe = useUpdaterStore.subscribe((state, previous) => { if (state.status.phase !== previous.status.phase && ['downloading','verifying'].includes(state.status.phase)) queueMicrotask(() => void tick()) })
 const onFocus = () => void tick()
 window.addEventListener('focus',onFocus)
 return () => { disposed = true; if (timer !== undefined) window.clearTimeout(timer); unsubscribe(); window.removeEventListener('focus',onFocus) }
}

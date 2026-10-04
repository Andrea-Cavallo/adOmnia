import { create } from 'zustand'
import * as AppBindings from '../../bindings/adomnia/app'
import { Events } from '@wailsio/runtime'
import type { RailItem } from '@/lib/navigation'
import type { Collection, RequestItem } from '@/lib/types'
import { handOff } from '@/lib/moduleHandoff'
import { detachedPanelOfThisWindow, focusPanelWindow, windowSearch } from '@/lib/panel-windows-api'
import { useAppStore } from '@/stores/app'
import { useCollectionsStore } from '@/stores/collections'
import { usePanelWindowsStore } from '@/stores/panelWindows'
import { useTabsStore } from '@/stores/tabs'

type RoutedToolFile = NonNullable<ReturnType<typeof useAppStore.getState>['pendingFileImport']>

/**
 * What a link from the code asks a module to do. Each action is plain data, so it can travel to
 * the window where the module lives (a Wails event reaches every window). Data a module owns is
 * always changed in that module's window, never in a stale copy elsewhere.
 */
export type ModuleAction =
  | { kind: 'open-request'; request: RequestItem }
  | { kind: 'import-collections'; collections: Collection[] }
  /** A value the module reads once when it mounts (moduleHandoff keys): the module is remounted to read it. */
  | { kind: 'handoff'; key: string; value: unknown }
  /** A file for a Power Tools tool, read once when the panel mounts. */
  | { kind: 'tool-file'; file: RoutedToolFile }
  /** A document event the module already listens to, e.g. adomnia:mock-endpoints-updated. */
  | { kind: 'event'; name: string }
  /** An event re-sent every frame until the mounted panel marks detail.handled (entity handoffs). */
  | { kind: 'dispatch'; eventName: string; detail: Record<string, unknown> }
  /** A source location in Go Studio. */
  | { kind: 'open-location'; file: string; line: number }

export interface RouteOptions {
  /** false: change the module's data without switching to it (e.g. "imported, stay in Go Studio"). */
  reveal?: boolean
  /** Only when the action runs in this window: the panel never accepted a dispatch. */
  onTimeout?: () => void
}

const HANDOFF_TIMEOUT_MS = 5000
const MODULE_ACTION_EVENT = 'panelwindow:module-action'
/** Target of an action meant for the main window. */
const MAIN_WINDOW = 'main'

interface ModuleActionMessage {
  target: RailItem | typeof MAIN_WINDOW
  rail: RailItem
  action: ModuleAction | null
  reveal: boolean
}

/** Bumped when a module must remount to read a handoff; the panel container keys on it. */
interface ModuleEpochState {
  epochs: Partial<Record<RailItem, number>>
  bump: (rail: RailItem) => void
}

export const useModuleEpochStore = create<ModuleEpochState>((set) => ({
  epochs: {},
  bump: (rail) => set((state) => ({ epochs: { ...state.epochs, [rail]: (state.epochs[rail] ?? 0) + 1 } })),
}))

export function useModuleEpoch(rail: RailItem): number {
  return useModuleEpochStore((state) => state.epochs[rail] ?? 0)
}

function isMainWindow(): boolean {
  return !new URLSearchParams(windowSearch()).get('window')
}

/**
 * Delivers an event once the panel is mounted: re-dispatched every frame until a listener sets
 * detail.handled, for at most 5 s of wall time.
 */
function deliverWhenMounted(rail: RailItem, eventName: string, detail: Record<string, unknown>, onTimeout?: () => void): void {
  const deadline = performance.now() + HANDOFF_TIMEOUT_MS
  const here = detachedPanelOfThisWindow()
  const attempt = () => {
    if ((here ?? useAppStore.getState().activeRail) !== rail) return
    const eventDetail = { ...detail, handled: false }
    document.dispatchEvent(new CustomEvent(eventName, { detail: eventDetail }))
    if (eventDetail.handled) return
    if (performance.now() < deadline) window.requestAnimationFrame(attempt)
    else onTimeout?.()
  }
  window.requestAnimationFrame(attempt)
}

function runLocally(rail: RailItem, action: ModuleAction | null, reveal: boolean, onTimeout?: () => void): void {
  const alreadyShown = detachedPanelOfThisWindow() === rail || useAppStore.getState().activeRail === rail
  if (reveal && isMainWindow()) useAppStore.getState().setActiveRail(rail)
  // A value read on mount reaches a panel already on screen only if it remounts.
  const remount = () => { if (alreadyShown) useModuleEpochStore.getState().bump(rail) }
  switch (action?.kind) {
    case 'open-request': useTabsStore.getState().openTab(action.request); break
    case 'import-collections': action.collections.forEach((collection) => useCollectionsStore.getState().importCollection(collection)); break
    case 'handoff': handOff(action.key, action.value); remount(); break
    case 'tool-file': useAppStore.getState().queueFileImport(action.file); remount(); break
    case 'event': document.dispatchEvent(new CustomEvent(action.name)); break
    case 'dispatch': deliverWhenMounted(rail, action.eventName, action.detail, onTimeout); break
    // Go Studio stays out of the startup bundle: loaded only when a link really opens code.
    case 'open-location': void import('@/stores/goide').then(({ useGoIDEStore }) => useGoIDEStore.getState().openLocation(action.file, action.line, 1)); break
  }
}

/** In the main window, everything that is not detached lives here; a module window owns only its module. */
function ownsHere(rail: RailItem): boolean {
  const here = detachedPanelOfThisWindow()
  if (here) return here === rail
  if (!isMainWindow()) return false
  return !usePanelWindowsStore.getState().detached.includes(rail)
}

/**
 * Runs the action where the module lives: here, in its own window, or in the main window when the
 * link comes from a detached window (e.g. a Go Studio project window). With reveal the module is
 * shown and its window brought forward.
 */
export function routeToModule(rail: RailItem, action: ModuleAction | null, { reveal = true, onTimeout }: RouteOptions = {}): void {
  usePanelWindowsStore.getState().start()
  if (ownsHere(rail)) {
    runLocally(rail, action, reveal, onTimeout)
    return
  }
  const detached = usePanelWindowsStore.getState().detached.includes(rail)
  const message: ModuleActionMessage = { target: detached ? rail : MAIN_WINDOW, rail, action, reveal }
  void Events.Emit(MODULE_ACTION_EVENT, message)
  if (!reveal) return
  void (detached ? focusPanelWindow(rail) : AppBindings.FocusMainWindow())
}

/** Shows a module, optionally with an action, wherever it lives. */
export function showModule(rail: RailItem, action: ModuleAction | null = null, onTimeout?: () => void): void {
  routeToModule(rail, action, { onTimeout })
}

let listening = false

/** Every window listens once and runs only the actions addressed to it. */
export function startModuleActionListener(): void {
  if (listening) return
  listening = true
  usePanelWindowsStore.getState().start()
  const here = detachedPanelOfThisWindow()
  const main = isMainWindow()
  Events.On(MODULE_ACTION_EVENT, (event) => {
    const message = event.data as ModuleActionMessage | null
    if (!message?.rail) return
    if ((main && message.target === MAIN_WINDOW) || (here !== null && message.target === here)) {
      runLocally(message.rail, message.action, message.reveal !== false)
    }
  })
}

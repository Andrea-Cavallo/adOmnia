import { create } from 'zustand'
import type { RailItem } from '@/lib/navigation'
import { useAppStore } from '@/stores/app'
import { usePanelWindowsStore } from '@/stores/panelWindows'
import { useTabsStore } from '@/stores/tabs'

/**
 * Layout & Navigation Coordinator of the Smart Split Workspace.
 *
 * The split is code + request, plus at most one auxiliary pane (Database, Broker, Logs) that a
 * module asks for with `placement: 'auxiliary'` instead of replacing the screen. Every layout change
 * made on the user's behalf is recorded, so Back returns to the screen they came from — e.g. from
 * the query of a paused request back to its response.
 */

/** The two panes of the split. Both stay mounted while the split is open. */
export const SPLIT_PRIMARY_PANES: readonly RailItem[] = ['codestudio', 'collections']
/** Modules that can join the split as its third pane. */
export const SPLIT_AUXILIARY_PANES: readonly RailItem[] = ['database', 'broker', 'loginspector']

export const AUX_RATIO_KEY = 'adomnia.workspace.auxRatio.v1'
export const DEFAULT_AUX_RATIO = 0.36
export const MIN_AUX_RATIO = 0.2
export const MAX_AUX_RATIO = 0.55
/** Older entries are dropped: Back is for the last few hops, not a full journal. */
export const LAYOUT_HISTORY_LIMIT = 20

export function isAuxiliaryPane(rail: RailItem): boolean {
  return SPLIT_AUXILIARY_PANES.includes(rail)
}

/** Rails shown by the split right now (primary panes, then the auxiliary one). */
export function splitPanes(auxiliary: RailItem | null): RailItem[] {
  return auxiliary ? [...SPLIT_PRIMARY_PANES, auxiliary] : [...SPLIT_PRIMARY_PANES]
}

/** True when `rail` is one of the panes the open split shows. */
export function isInSplit(rail: RailItem, splitView: boolean, auxiliary: RailItem | null): boolean {
  return splitView && splitPanes(auxiliary).includes(rail)
}

export function clampAuxRatio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_AUX_RATIO
  return Math.min(MAX_AUX_RATIO, Math.max(MIN_AUX_RATIO, value))
}

/** What Back restores: which panes were visible, which had the keyboard, which request was shown. */
export interface LayoutSnapshot {
  splitView: boolean
  auxiliary: RailItem | null
  activeRail: RailItem
  activeTabId: string | null
  /** Shown on the Back button: where Back goes. */
  label: string
}

export function pushSnapshot(history: LayoutSnapshot[], snapshot: LayoutSnapshot): LayoutSnapshot[] {
  const last = history[history.length - 1]
  const same = last && last.splitView === snapshot.splitView && last.auxiliary === snapshot.auxiliary
    && last.activeRail === snapshot.activeRail && last.activeTabId === snapshot.activeTabId
  return same ? history : [...history.slice(-(LAYOUT_HISTORY_LIMIT - 1)), snapshot]
}

const RAIL_LABELS: Partial<Record<RailItem, string>> = {
  collections: 'request', codestudio: 'code', database: 'query', broker: 'broker', loginspector: 'logs',
}

/** "Back to response" when the request pane had the keyboard, "Back to code" for Code Studio… */
export function backLabel(snapshot: Pick<LayoutSnapshot, 'activeRail' | 'splitView'>): string {
  if (snapshot.activeRail === 'collections') return 'Back to response'
  return `Back to ${RAIL_LABELS[snapshot.activeRail] ?? snapshot.activeRail}`
}

function loadAuxRatio(): number {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(AUX_RATIO_KEY)
    return raw ? clampAuxRatio(Number(raw)) : DEFAULT_AUX_RATIO
  } catch {
    return DEFAULT_AUX_RATIO
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function saveAuxRatio(ratio: number): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    try { localStorage.setItem(AUX_RATIO_KEY, String(ratio)) } catch { /* a full storage never breaks the layout */ }
  }, 200)
}

interface WorkspaceLayoutState {
  /** Width of the auxiliary pane, as a fraction of the split. */
  auxRatio: number
  history: LayoutSnapshot[]
  setAuxRatio: (ratio: number) => void
}

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>((set) => ({
  auxRatio: loadAuxRatio(),
  history: [],
  setAuxRatio: (ratio) => {
    const next = clampAuxRatio(ratio)
    saveAuxRatio(next)
    set({ auxRatio: next })
  },
}))

function currentSnapshot(): LayoutSnapshot {
  const app = useAppStore.getState()
  const base = { splitView: app.splitView, auxiliary: app.splitAuxiliary, activeRail: app.activeRail }
  return { ...base, activeTabId: useTabsStore.getState().activeTabId, label: backLabel(base) }
}

let watchingSplit = false
/** Started with the first recorded screen: before that there is no trail to end. */
function watchSplitClose(): void {
  if (watchingSplit) return
  watchingSplit = true
  useAppStore.subscribe((state, previous) => {
    if (previous.splitView && !state.splitView) clearLayoutHistory()
  })
}

/** Records the current screen so Back can return to it. */
export function rememberLayout(): void {
  watchSplitClose()
  useWorkspaceLayoutStore.setState((state) => ({ history: pushSnapshot(state.history, currentSnapshot()) }))
}

/** Both split panes are in this window: a detached module cannot be shown side by side. */
export function canSplitHere(extra?: RailItem): boolean {
  const detached = usePanelWindowsStore.getState().detached
  return ![...SPLIT_PRIMARY_PANES, ...(extra ? [extra] : [])].some((rail) => detached.includes(rail))
}

/** Opens code + request side by side, keeping both mounted; `focus` gets the keyboard. */
export function enterSplit(focus?: RailItem): void {
  const app = useAppStore.getState()
  if (!app.splitView) rememberLayout()
  for (const rail of SPLIT_PRIMARY_PANES) app.keepPanel(rail)
  const target = focus ?? (isInSplit(app.activeRail, true, app.splitAuxiliary) ? app.activeRail : 'collections')
  if (app.activeRail !== target) app.setActiveRail(target)
  app.setSplitView(true)
}

/**
 * Shows `rail` as the third pane of the split, next to code and request. Returns false when it
 * cannot (not an auxiliary module, or one of the panes lives in its own window): the caller then
 * shows the module the usual way.
 */
export function placeAuxiliary(rail: RailItem): boolean {
  if (!isAuxiliaryPane(rail) || !canSplitHere(rail)) return false
  const app = useAppStore.getState()
  if (app.splitAuxiliary !== rail || app.activeRail !== rail) rememberLayout()
  for (const pane of SPLIT_PRIMARY_PANES) app.keepPanel(pane)
  app.setSplitView(true)
  app.setSplitAuxiliary(rail)
  app.setActiveRail(rail)
  return true
}

/** Removes the third pane; the keyboard goes back to the request. */
export function closeAuxiliary(): void {
  const app = useAppStore.getState()
  if (!app.splitAuxiliary) return
  const wasActive = app.activeRail === app.splitAuxiliary
  app.setSplitAuxiliary(null)
  if (wasActive) app.setActiveRail('collections')
}

/** Restores the previous screen. Returns false when there is nothing to go back to. */
export function layoutBack(): boolean {
  const history = useWorkspaceLayoutStore.getState().history
  const previous = history[history.length - 1]
  if (!previous) return false
  useWorkspaceLayoutStore.setState({ history: history.slice(0, -1) })
  const app = useAppStore.getState()
  app.setSplitView(previous.splitView)
  if (previous.splitView) app.setSplitAuxiliary(previous.auxiliary)
  if (app.activeRail !== previous.activeRail) app.setActiveRail(previous.activeRail)
  const tabs = useTabsStore.getState()
  if (previous.activeTabId && tabs.tabs.some((tab) => tab.id === previous.activeTabId)) tabs.setActiveTab(previous.activeTabId)
  return true
}

/** Back is about the screens of one split: once it closes, however it closed, the trail ends. */
export function clearLayoutHistory(): void {
  useWorkspaceLayoutStore.setState({ history: [] })
}


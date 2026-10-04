import { create } from 'zustand'
import type { RailItem } from '@/lib/navigation'
import { detachedPanelOfThisWindow, focusPanelWindow, listPanelWindows, openPanelWindow, subscribePanelWindows } from '@/lib/panel-windows-api'
import { useCollectionsStore } from './collections'
import { useEnvironmentsStore } from './environments'
import { useHostsStore } from './hosts'
import { useTabsStore } from './tabs'
import { setSavesSuspended } from '@/lib/storeSave'

/** Stores the API workspace window owns while it is detached. */
const WORKSPACE_SAVE_KEYS = ['collections', 'tabs', 'environments', 'hosts'] as const

interface PanelWindowsState {
  /** Modules currently shown in their own window. */
  detached: RailItem[]
  started: boolean
  start: () => void
}

/** The API workspace was edited in its own window: re-read it from disk instead of keeping a stale copy. */
async function reloadWorkspace(): Promise<void> {
  await Promise.all([useCollectionsStore.getState().load(), useEnvironmentsStore.getState().load(), useHostsStore.getState().load()])
  await useTabsStore.getState().load()
}

export const usePanelWindowsStore = create<PanelWindowsState>((set, get) => ({
  detached: [],
  started: false,
  start: () => {
    if (get().started) return
    set({ started: true })
    const apply = (next: RailItem[]) => {
      const previous = get().detached
      set({ detached: next })
      // The window that shows the API workspace owns it; every other window only holds a copy.
      if (detachedPanelOfThisWindow() === 'collections') return
      // While the API workspace lives in its own window, this copy is never written to disk...
      setSavesSuspended(WORKSPACE_SAVE_KEYS, next.includes('collections'))
      // ...and when it comes back, the copy is re-read with the edits made there.
      if (previous.includes('collections') && !next.includes('collections')) void reloadWorkspace()
    }
    subscribePanelWindows(apply)
    listPanelWindows().then(apply, () => undefined)
  },
}))


/** Opens a module in its own window, or brings that window forward; errors use the save-error toast. */
export function openRailItemInWindow(id: RailItem, label: string): void {
  const run = usePanelWindowsStore.getState().detached.includes(id) ? focusPanelWindow(id) : openPanelWindow(id, label)
  Promise.resolve(run).catch((error: unknown) => {
    window.dispatchEvent(new CustomEvent('adomnia:save-error', { detail: error instanceof Error ? error.message : String(error) }))
  })
}

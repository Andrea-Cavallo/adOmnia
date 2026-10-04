import { create } from 'zustand'
import type { RailItem } from '@/lib/navigation'
import { detachedPanelOfThisWindow, focusPanelWindow, listPanelWindows, openPanelWindow, subscribePanelWindows } from '@/lib/panel-windows-api'
import { useCollectionsStore } from './collections'
import { useEnvironmentsStore } from './environments'
import { useHostsStore } from './hosts'
import { useTabsStore } from './tabs'

interface PanelWindowsState {
  /** Modules currently shown in their own window. */
  detached: RailItem[]
  started: boolean
  start: () => void
}

/**
 * A module that comes back from its window was edited there: this window re-reads it from disk
 * before showing it, so stale in-memory state never overwrites the newer saves.
 */
async function reloadReturnedPanel(rail: RailItem): Promise<void> {
  if (rail !== 'collections') return
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
      // Only the main window keeps a copy of the modules that come back to it.
      if (detachedPanelOfThisWindow() !== null) return
      for (const rail of previous) {
        if (!next.includes(rail)) void reloadReturnedPanel(rail)
      }
    }
    subscribePanelWindows(apply)
    listPanelWindows().then((detached) => set({ detached }), () => undefined)
  },
}))

export function useIsPanelDetached(rail: RailItem): boolean {
  return usePanelWindowsStore((state) => state.detached.includes(rail))
}

/** Opens a module in its own window, or brings that window forward; errors use the save-error toast. */
export function openRailItemInWindow(id: RailItem, label: string): void {
  const run = usePanelWindowsStore.getState().detached.includes(id) ? focusPanelWindow(id) : openPanelWindow(id, label)
  Promise.resolve(run).catch((error: unknown) => {
    window.dispatchEvent(new CustomEvent('adomnia:save-error', { detail: error instanceof Error ? error.message : String(error) }))
  })
}

import { create } from 'zustand'
import type { RailItem } from '@/lib/navigation'
import { detachedPanelOfThisWindow, listPanelWindows, subscribePanelWindows } from '@/lib/panel-windows-api'
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

import { create } from 'zustand'
import type { ApiCodeLink, LinkChooser } from './types'

interface ApiCodeLinkState {
  link: ApiCodeLink | null
  /** Recent links, newest first: the navigation history of this relationship. */
  history: ApiCodeLink[]
  /** The link is still shown but its source moved or disappeared. */
  stale: boolean
  chooser: LinkChooser | null
  setLink: (link: ApiCodeLink | null) => void
  markStale: (stale: boolean) => void
  openChooser: (chooser: LinkChooser) => void
  closeChooser: () => void
  clear: () => void
}

const HISTORY_LIMIT = 20

export const useApiCodeLinkStore = create<ApiCodeLinkState>((set) => ({
  link: null,
  history: [],
  stale: false,
  chooser: null,
  setLink: (link) => set((state) => {
    const sameRelationship = !!link && !!state.link && link.sessionId === state.link.sessionId && link.routeId === state.link.routeId
    return {
      link,
      // A closed tab or a refreshed reference must not clear a stale warning for the same relationship.
      stale: sameRelationship ? state.stale : false,
      history: link ? [link, ...state.history.filter((entry) => entry.routeId !== link.routeId || entry.sessionId !== link.sessionId)].slice(0, HISTORY_LIMIT) : state.history,
    }
  }),
  markStale: (stale) => set({ stale }),
  openChooser: (chooser) => set({ chooser }),
  closeChooser: () => set({ chooser: null }),
  clear: () => set({ link: null, stale: false }),
}))

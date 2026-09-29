import { create } from 'zustand'

export interface EntityNoticeState {
  id: number
  message: string
  action?: { label: string; run: () => void }
}

export const useEntityNotice = create<{ notice: EntityNoticeState | null }>(() => ({ notice: null }))

let nextId = 0
let hideTimer: ReturnType<typeof setTimeout> | undefined

/** One-line feedback for cross-panel actions; notices with an action stay until used or dismissed. */
export function showEntityNotice(message: string, action?: EntityNoticeState['action']): void {
  nextId += 1
  const id = nextId
  useEntityNotice.setState({ notice: { id, message, action } })
  if (hideTimer) clearTimeout(hideTimer)
  if (!action) {
    hideTimer = setTimeout(() => {
      if (useEntityNotice.getState().notice?.id === id) useEntityNotice.setState({ notice: null })
    }, 6000)
  }
}

export function clearEntityNotice(): void {
  if (hideTimer) clearTimeout(hideTimer)
  useEntityNotice.setState({ notice: null })
}

import * as GoIDEBindings from '../../bindings/adomnia/goide'
import { Events } from '@wailsio/runtime'
import type { SessionWindow } from '../../bindings/adomnia/internal/goide/models'

export type GoIDESessionWindow = SessionWindow

/** Finestra principale di adOmnia: possiede ogni progetto non spostato in una finestra separata. */
export const MAIN_GO_STUDIO_WINDOW = 'main'

export interface GoStudioWindowContext {
  windowId: string
  /** Progetto mostrato da una finestra separata; null nella finestra principale. */
  pinnedSessionId: string | null
}

/** Legge dall'URL quale finestra è questa: le finestre separate si aprono con ?window=go-studio. */
export function goStudioWindowContext(search: string = typeof window === 'undefined' ? '' : window.location.search): GoStudioWindowContext {
  const params = new URLSearchParams(search)
  const windowId = params.get('windowId')
  const sessionId = params.get('session')
  if (params.get('window') !== 'go-studio' || !windowId || !sessionId) return { windowId: MAIN_GO_STUDIO_WINDOW, pinnedSessionId: null }
  return { windowId, pinnedSessionId: sessionId }
}

export interface GoIDEWindowCloseRequest {
  windowId: string
  dirtyDocumentCount: number
}

export async function openGoIDESessionWindow(sessionId: string): Promise<string> {
  return GoIDEBindings.OpenSessionWindow(sessionId)
}

export async function claimGoIDESessionWindow(sessionId: string, windowId: string, force: boolean): Promise<GoIDESessionWindow> {
  return GoIDEBindings.ClaimSessionWindow(sessionId, windowId, force)
}

export async function listGoIDESessionWindows(): Promise<GoIDESessionWindow[]> {
  return (await GoIDEBindings.ListSessionWindows()) ?? []
}

export async function focusGoIDESessionWindow(windowId: string): Promise<void> {
  await GoIDEBindings.FocusSessionWindow(windowId)
}

export async function closeGoIDESessionWindow(windowId: string): Promise<void> {
  await GoIDEBindings.CloseSessionWindow(windowId)
}

export async function confirmGoIDESessionWindowClose(windowId: string): Promise<void> {
  await GoIDEBindings.ConfirmSessionWindowClose(windowId)
}

export async function setGoIDEWindowDirtyDocumentCount(windowId: string, count: number): Promise<void> {
  await GoIDEBindings.SetWindowDirtyDocumentCount(windowId, Math.max(0, count))
}

export function subscribeGoIDEWindowCloseRequests(callback: (request: GoIDEWindowCloseRequest) => void): () => void {
  return Events.On('goide:window-close-requested', (event) => callback(event.data as GoIDEWindowCloseRequest))
}

import { normalizeRailItem, type RailItem } from '@/lib/navigation'
import { safeSetItem } from '@/lib/safeLocalStorage'

export const UI_SESSION_MEMENTO_KEY = 'adomnia.uiSession.v1'

export type StartupBehavior = 'resume' | 'fixed'

export interface UiSessionMementoV1 {
  version: 1
  activeRail: RailItem
  startupBehavior: StartupBehavior
  defaultStartupRail: RailItem
  savedAt: string
}

function normalizeStartupBehavior(value: unknown): StartupBehavior {
  return value === 'fixed' ? 'fixed' : 'resume'
}

export function loadUiSessionMemento(): UiSessionMementoV1 | null {
  try {
    const raw = localStorage.getItem(UI_SESSION_MEMENTO_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.version !== 1) return null

    const activeRail = normalizeRailItem(parsed.activeRail)
    if (!activeRail) return null

    return {
      version: 1,
      activeRail,
      startupBehavior: normalizeStartupBehavior(parsed.startupBehavior),
      defaultStartupRail: normalizeRailItem(parsed.defaultStartupRail) ?? 'collections',
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
    }
  } catch {
    return null
  }
}

export function initialRailFromMemento(): RailItem {
  const memento = loadUiSessionMemento()
  if (!memento) return 'welcome'
  return memento.startupBehavior === 'fixed'
    ? memento.defaultStartupRail
    : memento.activeRail
}

export function saveUiSessionMemento(
  activeRail: RailItem,
  startupBehavior: StartupBehavior,
  defaultStartupRail: RailItem,
): void {
  const memento: UiSessionMementoV1 = {
    version: 1,
    activeRail,
    startupBehavior,
    defaultStartupRail,
    savedAt: new Date().toISOString(),
  }
  safeSetItem(UI_SESSION_MEMENTO_KEY, JSON.stringify(memento))
}

export function updateUiSessionStartupPreference(
  startupBehavior: StartupBehavior,
  defaultStartupRail: RailItem,
): void {
  const current = loadUiSessionMemento()
  if (!current) return
  saveUiSessionMemento(current.activeRail, startupBehavior, defaultStartupRail)
}

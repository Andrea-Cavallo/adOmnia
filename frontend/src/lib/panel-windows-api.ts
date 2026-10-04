import * as AppBindings from '../../bindings/adomnia/app'
import { Events } from '@wailsio/runtime'
import { normalizeRailItem, type RailItem } from '@/lib/navigation'
import { flushPendingSaves } from '@/lib/storeSave'

/** Emitted by internal/panelwindow after every open or close, with the sorted list of detached modules. */
const PANEL_WINDOWS_CHANGED = 'panelwindow:changed'

/**
 * Modules that cannot live in their own window: the Hub, the settings pages (one shared settings
 * model) and Go Studio, whose projects already move to their own windows (File → Open Project in New Window).
 */
const NOT_DETACHABLE: ReadonlySet<RailItem> = new Set<RailItem>(['welcome', 'settings', 'workspace', 'themes', 'templates', 'plugins', 'goide'])

export function canDetachPanel(rail: RailItem): boolean {
  return !NOT_DETACHABLE.has(rail)
}

/** This window's query string; empty outside a browser window. */
export function windowSearch(): string {
  return typeof window === 'undefined' ? '' : window.location?.search ?? ''
}

/** The module shown by this window when it was opened with ?window=panel&panel=…; null in the main window. */
export function detachedPanelOfThisWindow(search: string = windowSearch()): RailItem | null {
  const params = new URLSearchParams(search)
  if (params.get('window') !== 'panel') return null
  const rail = normalizeRailItem(params.get('panel'))
  return rail && canDetachPanel(rail) ? rail : null
}

function toRails(value: unknown): RailItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const rail = normalizeRailItem(item)
    return rail ? [rail] : []
  })
}

/** Saves what is still queued, then opens the module in its own window (or focuses it). */
export async function openPanelWindow(rail: RailItem, title: string): Promise<void> {
  if (!canDetachPanel(rail)) throw new Error(`${title} cannot open in its own window`)
  await flushPendingSaves()
  await AppBindings.OpenPanelWindow(rail, title)
}

export async function focusPanelWindow(rail: RailItem): Promise<boolean> {
  return AppBindings.FocusPanelWindow(rail)
}

/** Closes the module's window: the module comes back to the main window. */
export async function closePanelWindow(rail: RailItem): Promise<void> {
  await flushPendingSaves()
  await AppBindings.ClosePanelWindow(rail)
}

export async function listPanelWindows(): Promise<RailItem[]> {
  return toRails(await AppBindings.ListPanelWindows())
}

export function subscribePanelWindows(callback: (detached: RailItem[]) => void): () => void {
  return Events.On(PANEL_WINDOWS_CHANGED, (event) => callback(toRails(event.data)))
}

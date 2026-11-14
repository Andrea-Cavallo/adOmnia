import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { usePanelWindowsStore } from '@/stores/panelWindows'
import { useTabsStore } from '@/stores/tabs'
import {
  LAYOUT_HISTORY_LIMIT, MAX_AUX_RATIO, MIN_AUX_RATIO, backLabel, clampAuxRatio, closeAuxiliary, enterDiagramSplit, enterSplit,
  isInSplit, layoutBack, placeAuxiliary, pushSnapshot, SPLIT_PAIRS, useWorkspaceLayoutStore, type LayoutSnapshot,
} from './workspaceLayout'

const snapshot = (activeRail: LayoutSnapshot['activeRail'], extra: Partial<LayoutSnapshot> = {}): LayoutSnapshot =>
  ({ splitView: false, auxiliary: null, activeRail, activeTabId: null, label: '', ...extra })

beforeEach(() => {
  // The app store remembers the active rail through window storage: a plain in-memory stand-in.
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } })
  vi.stubGlobal('window', { location: { search: '' }, dispatchEvent: () => true, localStorage: globalThis.localStorage })
  useAppStore.setState({ activeRail: 'collections', splitView: false, splitAuxiliary: null, splitPair: 'api', keptPanels: [], railHistory: [] })
  usePanelWindowsStore.setState({ detached: [] })
  useWorkspaceLayoutStore.setState({ history: [] })
  useTabsStore.setState({ activeTabId: 'tab-a' })
})

describe('workspace layout helpers', () => {
  it('knows which rails the open split shows', () => {
    expect(isInSplit('codestudio', true, null)).toBe(true)
    expect(isInSplit('database', true, null)).toBe(false)
    expect(isInSplit('database', true, 'database')).toBe(true)
    expect(isInSplit('collections', false, null)).toBe(false)
  })

  it('clamps the auxiliary width and ignores garbage', () => {
    expect(clampAuxRatio(0.01)).toBe(MIN_AUX_RATIO)
    expect(clampAuxRatio(2)).toBe(MAX_AUX_RATIO)
    expect(clampAuxRatio('x')).toBeGreaterThan(MIN_AUX_RATIO)
  })

  it('does not record the same screen twice and keeps the history bounded', () => {
    const once = pushSnapshot([], snapshot('collections'))
    expect(pushSnapshot(once, snapshot('collections'))).toHaveLength(1)
    let long: LayoutSnapshot[] = []
    for (let i = 0; i < LAYOUT_HISTORY_LIMIT + 5; i++) long = pushSnapshot(long, snapshot('collections', { activeTabId: String(i) }))
    expect(long).toHaveLength(LAYOUT_HISTORY_LIMIT)
  })

  it('names Back after where it goes', () => {
    expect(backLabel({ activeRail: 'collections', splitView: true })).toBe('Back to response')
    expect(backLabel({ activeRail: 'codestudio', splitView: true })).toBe('Back to code')
  })
})

describe('workspace layout coordinator', () => {
  it('opens the split with both panes kept mounted', () => {
    enterSplit()
    const app = useAppStore.getState()
    expect(app.splitView).toBe(true)
    expect(app.keptPanels).toEqual(expect.arrayContaining(['codestudio', 'collections']))
    expect(useWorkspaceLayoutStore.getState().history).toHaveLength(1)
  })

  it('opens Diagram Studio beside Code Studio, keeping both mounted', () => {
    enterDiagramSplit()
    const app = useAppStore.getState()
    expect(app).toMatchObject({ splitView: true, splitPair: 'diagram', activeRail: 'diagrams' })
    expect(app.keptPanels).toEqual(expect.arrayContaining(['diagrams', 'codestudio']))
    expect(SPLIT_PAIRS.diagram).toEqual(['diagrams', 'codestudio'])
    expect(isInSplit('diagrams', true, null, 'diagram')).toBe(true)
    expect(isInSplit('collections', true, null, 'diagram')).toBe(false)
    // Back returns to the screen before the diagram split, not to a broken half-pair.
    expect(layoutBack()).toBe(true)
    expect(useAppStore.getState()).toMatchObject({ splitPair: 'api', splitView: false, activeRail: 'collections' })
  })

  it('keeps the API third pane out of the diagram split', () => {
    enterDiagramSplit()
    expect(placeAuxiliary('database')).toBe(false)
    expect(useAppStore.getState().splitAuxiliary).toBeNull()
  })

  it('adds Database beside code and request, and Back returns to the response', () => {
    enterSplit()
    expect(placeAuxiliary('database')).toBe(true)
    expect(useAppStore.getState()).toMatchObject({ splitView: true, splitAuxiliary: 'database', activeRail: 'database' })
    expect(layoutBack()).toBe(true)
    expect(useAppStore.getState()).toMatchObject({ splitView: true, splitAuxiliary: null, activeRail: 'collections' })
    expect(layoutBack()).toBe(true)
    expect(useAppStore.getState().splitView).toBe(false)
    expect(layoutBack()).toBe(false)
  })

  it('refuses modules that cannot join the split and detached panes', () => {
    enterSplit()
    expect(placeAuxiliary('settings')).toBe(false)
    usePanelWindowsStore.setState({ detached: ['database'] })
    expect(placeAuxiliary('database')).toBe(false)
    expect(useAppStore.getState().splitAuxiliary).toBeNull()
  })

  it('closing the third pane gives the keyboard back to the request', () => {
    enterSplit()
    placeAuxiliary('database')
    closeAuxiliary()
    expect(useAppStore.getState()).toMatchObject({ splitAuxiliary: null, activeRail: 'collections', splitView: true })
  })

  it('closing the split drops the third pane', () => {
    enterSplit()
    placeAuxiliary('broker')
    useAppStore.getState().setSplitView(false)
    expect(useAppStore.getState().splitAuxiliary).toBeNull()
  })
})

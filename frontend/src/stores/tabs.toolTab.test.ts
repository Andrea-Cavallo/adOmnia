import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/wailsStorage', () => ({
  safeStorageGet: vi.fn(async () => ''),
  safeStoragePut: vi.fn(async () => undefined),
}))

vi.mock('@/lib/storeSave', () => ({
  debouncedSave: (_key: string, save: () => Promise<void>) => {
    void save()
  },
}))

import { useTabsStore } from './tabs'

describe('openToolTab', () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
  })

  it('opens a tool tab carrying the tool id and its label', () => {
    useTabsStore.getState().openToolTab('jsonviewer')

    const { tabs, activeTabId } = useTabsStore.getState()
    expect(tabs).toHaveLength(1)
    expect(tabs[0].tool).toBe('jsonviewer')
    expect(tabs[0].request.name).toBe('JSON Studio')
    expect(activeTabId).toBe(tabs[0].id)
  })

  it('refocuses the existing tab instead of stacking duplicates', () => {
    useTabsStore.getState().openToolTab('jsonviewer')
    const firstId = useTabsStore.getState().tabs[0].id

    useTabsStore.getState().openToolTab('apidocs')
    useTabsStore.getState().openToolTab('jsonviewer')

    const { tabs, activeTabId } = useTabsStore.getState()
    expect(tabs.filter((t) => t.tool === 'jsonviewer')).toHaveLength(1)
    expect(tabs).toHaveLength(2)
    expect(activeTabId).toBe(firstId)
  })

  it('leaves request tabs untouched', () => {
    useTabsStore.getState().newTab('POST')
    useTabsStore.getState().openToolTab('apidocs')

    const requestTabs = useTabsStore.getState().tabs.filter((t) => !t.tool)
    expect(requestTabs).toHaveLength(1)
    expect(requestTabs[0].request.method).toBe('POST')
  })
})

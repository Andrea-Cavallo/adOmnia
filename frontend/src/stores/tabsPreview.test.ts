import { beforeEach, describe, expect, it } from 'vitest'
import { blankRequest } from '@/lib/types'
import { useTabsStore } from './tabs'
import { useCollectionsStore } from './collections'

beforeEach(() => {
  useCollectionsStore.setState({ activeWorkspaceId: 'one' })
  useTabsStore.setState({ tabs: [], activeTabId: null, detachedTabIds: {}, viewStateByTabId: {}, loaded: false })
})
const preview = () => useTabsStore.getState().openTab(blankRequest(), 'collection', true)

describe('request previews', () => {
  it('replaces only a clean preview', () => {
    preview(); const first = useTabsStore.getState().activeTabId
    preview()
    expect(useTabsStore.getState().tabs).toHaveLength(1)
    expect(useTabsStore.getState().activeTabId).not.toBe(first)
  })
  it('keeps the tab when explicitly opened or edited', () => {
    preview()
    const first = useTabsStore.getState().tabs[0]
    useTabsStore.getState().openTab(first.request, 'collection')
    preview()
    const second = useTabsStore.getState().tabs[1]
    useTabsStore.getState().updateRequest(second.id, { ...second.request, name: 'edited' })
    preview()
    expect(useTabsStore.getState().tabs).toHaveLength(3)
    expect(useTabsStore.getState().tabs[1]).toMatchObject({ dirty: true, preview: false })
  })
  it.each(['dirty', 'loading', 'pinned', 'detached', 'workspace'])('never replaces a %s preview', mode => {
    preview()
    const first = useTabsStore.getState().tabs[0]
    if (mode === 'workspace') useCollectionsStore.setState({ activeWorkspaceId: 'two' })
    else if (mode === 'detached') useTabsStore.setState({ detachedTabIds: { [first.id]: true } })
    else useTabsStore.setState({ tabs: [{ ...first, [mode]: true }] })
    preview()
    expect(useTabsStore.getState().tabs).toHaveLength(2)
  })
  it('keeps renamed and reattached previews', () => {
    preview()
    const first = useTabsStore.getState().tabs[0]
    useTabsStore.getState().renameRequestTabs(first.request.id, 'renamed')
    preview()
    const second = useTabsStore.getState().tabs[1]
    useTabsStore.getState().setDetached(second.id, true)
    useTabsStore.getState().setDetached(second.id, false)
    preview()
    expect(useTabsStore.getState().tabs).toHaveLength(3)
  })
})

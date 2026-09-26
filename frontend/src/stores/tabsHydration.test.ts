import { beforeEach, describe, expect, it } from 'vitest'
import { TOOL_TAB_LABELS } from '@/lib/types'
import { useCollectionsStore } from './collections'
import { useTabsStore } from './tabs'

beforeEach(() => {
  useCollectionsStore.setState({ activeWorkspaceId: 'workspace' })
  useTabsStore.setState({
    tabs: [], activeTabId: null, responseHistory: [], viewStateByTabId: {},
    detachedTabIds: {}, loaded: false, loadError: false, deferredLoaded: false,
  })
})

describe('tab hydration', () => {
  it('repairs a legacy tool tab that was persisted without its request placeholder', async () => {
    await useTabsStore.getState().load({
      version: 3,
      activeTabId: 'json',
      tabs: [{ id: 'json', tool: 'jsonviewer', dirty: false, loading: false, response: null }],
    })

    const restored = useTabsStore.getState().tabs[0]
    expect(restored.request).toMatchObject({ name: TOOL_TAB_LABELS.jsonviewer, method: 'GET' })
    expect(useTabsStore.getState().activeTabId).toBe('json')
  })
})

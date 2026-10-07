import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@wailsio/runtime', () => ({
  Events: { On: vi.fn() }, Call: {},
  Create: new Proxy({}, { get: () => () => (value: unknown) => value }),
}))
vi.mock('@/lib/desktopRuntime', () => ({ isDesktopRuntime: () => false }))

import { GitSyncPanel } from './GitSyncPanel'
import { useTabsStore } from '@/stores/tabs'
import { useCollectionsStore } from '@/stores/collections'

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useCollectionsStore.setState({ collections: [] })
})

describe('Git Sync navigation with no active request', () => {
  it('renders when both the active tab and selected collection are absent', () => {
    expect(() => renderToString(createElement(GitSyncPanel))).not.toThrow()
  })
  it('renders when the active tab ID no longer exists', () => {
    useTabsStore.setState({ activeTabId: 'closed-tab' })
    expect(() => renderToString(createElement(GitSyncPanel))).not.toThrow()
  })
})

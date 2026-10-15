import { afterEach, expect, it, vi } from 'vitest'
import { blankRequest, type ResponseData } from '@/lib/types'
import { useTabsStore } from './tabs'

// Exercise the actual capture and reopen paths, including arbitrary extension metadata.
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('isolates recorded and reopened nested snapshots from subsequent mutation', () => {
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  vi.stubGlobal('CustomEvent', class {})
  vi.spyOn(useTabsStore.getState(), 'save').mockImplementation(() => undefined)
  const request = { ...blankRequest(), _xExtensions: { nested: { flags: ['original'] } } }
  const response: ResponseData = { status: 200, statusText: 'OK', headers: { test: 'original' }, body: 'x'.repeat(250_000), contentType: 'text/plain', ms: 1, size: 250_000 }
  useTabsStore.setState({ tabs: [{ id: 'capture', request, dirty: false, loading: false, response: null }], responseHistory: [], activeTabId: 'capture' })
  useTabsStore.getState().setResponse('capture', response)
  const entry = useTabsStore.getState().responseHistory[0]
  request._xExtensions.nested.flags[0] = 'changed'
  response.headers.test = 'changed'
  expect(entry.request?._xExtensions).toEqual({ nested: { flags: ['original'] } })
  expect(entry.response.headers.test).toBe('original')
  useTabsStore.getState().openHistoryEntry(entry.id)
  const tabs = useTabsStore.getState().tabs
  const reopened = tabs[tabs.length - 1]
  reopened.response!.headers.test = 'reopened'
  expect(entry.response.headers.test).toBe('original')
  expect(reopened.request.id).not.toBe(entry.request!.id)
  expect(reopened.response!.body).toBe(response.body)
})

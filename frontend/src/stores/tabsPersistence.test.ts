import { describe, expect, it } from 'vitest'
import type { RequestHistoryEntry, Tab } from '@/lib/types'
import { blankRequest } from '@/lib/types'
import { splitTabsForPersistence } from './tabs'

function tab(id: string, body: string): Tab {
  return {
    id,
    request: blankRequest(),
    dirty: false,
    loading: false,
    response: {
      status: 200,
      statusText: 'OK',
      headers: {},
      body,
      contentType: 'application/json',
      ms: 1,
      size: body.length,
    },
  }
}

describe('progressive tab persistence', () => {
  it('keeps only the active response in the critical payload', () => {
    const active = tab('active', 'visible')
    const background = tab('background', 'deferred')
    const history = [{ id: 'history', recordedAt: null, response: active.response }] as RequestHistoryEntry[]

    const payload = splitTabsForPersistence([active, background], active.id, history)

    expect(payload.critical.version).toBe(3)
    expect(payload.critical.tabs[0].response?.body).toBe('visible')
    expect(payload.critical.tabs[1].response).toBeNull()
    expect(payload.deferred.responses.background.body).toBe('deferred')
    expect(payload.deferred.responseHistory).toEqual(history)
  })

  it('keeps a large background response off the critical path', () => {
    const active = tab('active', 'visible')
    const background = tab('background', 'x'.repeat(250_000))
    const payload = splitTabsForPersistence([active, background], active.id, [])
    const legacySize = JSON.stringify({ tabs: [active, background] }).length
    const criticalSize = JSON.stringify(payload.critical).length

    expect(criticalSize).toBeLessThan(legacySize / 100)
    expect(JSON.stringify(payload.deferred).length).toBeGreaterThan(250_000)
  })
})

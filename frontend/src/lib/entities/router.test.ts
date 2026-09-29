import { afterEach, describe, expect, it, vi } from 'vitest'
import { actionsFor, clearOpeners, openEntity, registerOpener } from './router'
import { useEntityNotice, clearEntityNotice } from './notice'
import type { EntityRef } from './types'

const route: EntityRef = { kind: 'route', id: 'route:GET /x', label: 'GET /x', attrs: { method: 'GET', path: '/x' }, source: { file: 'a.go', line: 3 } }

afterEach(() => { clearOpeners(); clearEntityNotice() })

describe('entity router', () => {
  it('runs the default intent, then explicit intents', async () => {
    const send = vi.fn(); const handler = vi.fn()
    registerOpener('route', { intent: 'handler', title: 'Go to handler', run: handler })
    registerOpener('route', { intent: 'send', title: 'Send', isDefault: true, run: send })
    await openEntity(route)
    expect(send).toHaveBeenCalledWith(route)
    await openEntity(route, 'handler')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('adds wildcard openers and filters unavailable ones', () => {
    registerOpener('route', { intent: 'send', title: 'Send', run: vi.fn() })
    registerOpener('*', { intent: 'source', title: 'Open source', available: (ref) => !!ref.source, run: vi.fn() })
    registerOpener('route', { intent: 'mock', title: 'Mock', available: () => false, run: vi.fn() })
    expect(actionsFor(route).map((a) => a.intent)).toEqual(['send', 'source'])
    expect(actionsFor({ ...route, source: undefined }).map((a) => a.intent)).toEqual(['send'])
  })

  it('falls back to the first action when none is default', async () => {
    const first = vi.fn()
    registerOpener('table', { intent: 'query', title: 'Query', run: first })
    await openEntity({ kind: 'table', id: 'table:t', label: 't', attrs: {} })
    expect(first).toHaveBeenCalled()
  })

  it('explains, never silently ignores, a missing opener or a failure', async () => {
    await openEntity(route)
    expect(useEntityNotice.getState().notice?.message).toContain('GET /x')
    registerOpener('route', { intent: 'send', title: 'Send', run: () => { throw new Error('no tab') } })
    await openEntity(route)
    expect(useEntityNotice.getState().notice?.message).toContain('no tab')
  })

  it('returns an unregister function', () => {
    const off = registerOpener('topic', { intent: 'open', title: 'Open', run: vi.fn() })
    off()
    expect(actionsFor({ kind: 'topic', id: 'topic:a', label: 'a', attrs: {} })).toEqual([])
  })
})

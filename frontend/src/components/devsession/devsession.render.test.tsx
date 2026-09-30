import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LiveSession, RequestRun } from '@/lib/devsession-api'

// Server rendering would read each store's initial state: hooks read the state the tests set instead.
vi.mock(import('zustand'), async (importOriginal) => {
  const actual = await importOriginal()
  const build = (creator: never) => {
    const store = actual.create(creator) as unknown as { getState: () => unknown }
    const hook = (selector: (state: unknown) => unknown = (state) => state) => selector(store.getState())
    return Object.assign(hook, store)
  }
  return { ...actual, create: ((creator?: never) => (creator ? build(creator) : build)) as never }
})
vi.mock(import('@wailsio/runtime'), async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual, Events: { On: () => () => undefined } } as never
})
vi.mock('../../../bindings/adomnia/devsession', () => new Proxy({}, { get: () => () => Promise.resolve([]) }))

const { useDevSessionStore } = await import('@/stores/devSession')
const { useAppStore } = await import('@/stores/app')
const { useTabsStore } = await import('@/stores/tabs')
const { DebugBar } = await import('./DebugBar')
const { LiveResponseFrame } = await import('./LiveResponseFrame')
const { RequestContextView } = await import('./RequestContextView')
const { emptyModel, applyLiveEvent } = await import('@/stores/devSessionModel')

const session: LiveSession = {
  id: 'debug:1', goSessionId: 'go-1', service: 'users-service', projectRoot: '/p', kind: 'debug', resourceId: '1', title: 'main',
  port: 8080, portSource: 'output', state: 'paused', startedAt: '2026-09-30T10:00:00Z',
  pause: { function: 'handler.UpdateUser', relativePath: 'internal/handler/user_handler.go', line: 84, threadId: 1, at: '2026-09-30T10:00:06Z' },
}
const run: RequestRun = {
  id: 'run-1', sessionId: 'debug:1', tabId: 'tab-1', method: 'PUT', url: 'http://localhost:8080/users/123?active=true', correlationId: 'adm-1',
  state: 'paused', startedAt: '2026-09-30T10:00:05Z', logs: 0, queries: 0, messages: 0,
  hits: [{ function: 'handler.UpdateUser', relativePath: 'internal/handler/user_handler.go', line: 84, at: '2026-09-30T10:00:06Z', confidence: 'likely' }],
}

function seed(runPatch: Partial<RequestRun> = {}, sessionPatch: Partial<LiveSession> = {}) {
  let model = applyLiveEvent(emptyModel(), { type: 'debug.paused', payload: { ...session, ...sessionPatch } })
  model = applyLiveEvent(model, { type: 'request.started', payload: { ...run, ...runPatch } })
  useDevSessionStore.setState({ ...model, progress: {}, error: '' })
}

describe('live session UI', () => {
  beforeEach(() => useAppStore.setState({ activeRail: 'collections' }))

  it('shows the paused service, its location and debugger controls in the global bar', () => {
    seed()
    const html = renderToStaticMarkup(<DebugBar />)
    expect(html).toContain('users-service')
    expect(html).toContain(':8080')
    expect(html).toContain('user_handler.go:84')
    expect(html).toContain('aria-label="Step Over"')
    expect(html).toContain('at breakpoint')
  })

  it('hides the global bar inside Go Studio, which has its own debugger toolbar', () => {
    seed()
    useAppStore.setState({ activeRail: 'goide' })
    expect(renderToStaticMarkup(<DebugBar />)).toBe('')
  })

  it('replaces the response with PAUSED AT BREAKPOINT while the handler is stopped', () => {
    seed()
    const html = renderToStaticMarkup(<LiveResponseFrame tabId="tab-1" loading><p>response</p></LiveResponseFrame>)
    expect(html).toContain('Paused at breakpoint')
    expect(html).toContain('Open in Go Studio')
    expect(html).toContain('Waiting for debugger')
    expect(html).not.toContain('<p>response</p>')
  })

  it('shows the completion summary and live tabs once the response arrived', () => {
    seed({ state: 'completed', status: 200, durationMs: 142, completedAt: '2026-09-30T10:00:07Z', logs: 8, queries: 1, messages: 1 }, { state: 'running', pause: null })
    const html = renderToStaticMarkup(<LiveResponseFrame tabId="tab-1" loading={false}><p>response</p></LiveResponseFrame>)
    expect(html).toContain('<p>response</p>')
    expect(html).toContain('142 ms')
    expect(html).toContain('Logs 8')
    expect(html).toContain('1 query')
    expect(html).toContain('1 event')
  })

  it('leaves unrelated tabs untouched', () => {
    seed()
    expect(renderToStaticMarkup(<LiveResponseFrame tabId="other" loading={false}><p>response</p></LiveResponseFrame>)).toBe('<p>response</p>')
  })

  it('shows the request context with credentials masked', () => {
    seed()
    useTabsStore.setState({
      tabs: [{
        id: 'tab-1', request: {
          id: 'r', name: 'Update user', type: 'request', method: 'PUT', url: 'http://localhost:8080/users/123?active=true', params: [],
          headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer secret-token', enabled: true }, { id: 'h2', key: 'Content-Type', value: 'application/json', enabled: true }],
          bodies: [{ id: 'b', name: 'Body', type: 'raw', raw: '{"name":"Andrea"}', lang: 'json', form: [] }], activeBodyIdx: 0,
          auth: { type: 'none' } as never,
        },
      } as never],
    })
    const html = renderToStaticMarkup(<RequestContextView run={run} />)
    expect(html).toContain('Bearer ***')
    expect(html).not.toContain('secret-token')
    expect(html).toContain('active')
    expect(html).toContain('{&quot;name&quot;:&quot;Andrea&quot;}')
    expect(html).toContain('adm-1')
  })
})

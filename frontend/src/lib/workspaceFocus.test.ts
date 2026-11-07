import { describe, expect, it } from 'vitest'
import type { LiveQuery, LiveSession, RequestRun } from '@/lib/devsession-api'
import type { ApiCodeLink } from '@/lib/api-code-link/types'
import { deriveFocus, describeFocus, type FocusSources } from './workspaceFocus'

const link: ApiCodeLink = { sessionId: 'proj-a', routeId: 'r1', method: 'GET', path: '/orders/:id', file: 'orders.go', line: 12, handler: 'GetOrder', requestTabId: 'tab-1', origin: 'request', createdAt: 0 }

function live(id: string, goSessionId: string, paused = false): LiveSession {
  return {
    id, goSessionId, service: 'svc-' + goSessionId, projectRoot: '', kind: 'debug', resourceId: '', title: '',
    state: 'running' as LiveSession['state'], pause: paused ? ({ file: 'orders.go', line: 12 } as LiveSession['pause']) : null, startedAt: '',
  }
}

function run(id: string, sessionId: string): RequestRun {
  return { id, sessionId, tabId: 'tab-1', method: 'GET', url: 'http://localhost:8080/orders/7', correlationId: '', state: 'paused', startedAt: '', hits: [], logs: 0, queries: 0, messages: 0 }
}

function query(id: string, requestRunId: string): LiveQuery {
  return { id, sessionId: 'live-a', requestRunId, at: '', sql: 'SELECT 1', source: 'proxy', datasource: 'postgres://localhost:5432' }
}

function sources(patch: Partial<FocusSources> = {}): FocusSources {
  return {
    link, linkStale: false, activeTabId: 'tab-1',
    runs: { run1: run('run1', 'live-a') }, runByTab: { 'tab-1': 'run1' },
    sessions: { 'live-a': live('live-a', 'proj-a', true) },
    queries: [query('q1', 'run1')], selectedQueryId: 'q1',
    ...patch,
  }
}

describe('deriveFocus', () => {
  it('joins project, route, handler, request, live run and query of the same identity', () => {
    const focus = deriveFocus(sources())
    expect(focus).toMatchObject({
      sessionId: 'proj-a', requestTabId: 'tab-1',
      route: { id: 'r1', method: 'GET', path: '/orders/:id' },
      handler: { file: 'orders.go', line: 12, name: 'GetOrder' },
      run: { id: 'run1', state: 'paused' },
      service: { id: 'live-a', name: 'svc-proj-a', paused: true },
      query: { id: 'q1', datasource: 'postgres://localhost:5432' },
    })
    expect(describeFocus(focus)).toBe('svc-proj-a · GET /orders/:id · GetOrder() · paused at breakpoint · query')
  })

  it('drops a link that belongs to another tab', () => {
    const focus = deriveFocus(sources({ activeTabId: 'tab-2', runByTab: {} }))
    expect(focus.route).toBeUndefined()
    expect(focus.handler).toBeUndefined()
    expect(focus.requestTabId).toBe('tab-2')
  })

  it('never mixes the run of another project into this request', () => {
    const focus = deriveFocus(sources({ sessions: { 'live-a': live('live-a', 'proj-b') } }))
    expect(focus.sessionId).toBe('proj-a')
    expect(focus.run).toBeUndefined()
    expect(focus.service).toBeUndefined()
    expect(focus.query).toBeUndefined()
  })

  it('keeps a query only while its run is the focused one', () => {
    expect(deriveFocus(sources({ queries: [query('q1', 'other-run')] })).query).toBeUndefined()
  })

  it('takes the project from the live run when no link exists', () => {
    const focus = deriveFocus(sources({ link: null }))
    expect(focus.sessionId).toBe('proj-a')
    expect(describeFocus(focus)).toBe('svc-proj-a · GET /orders/7 · paused at breakpoint · query')
  })
})

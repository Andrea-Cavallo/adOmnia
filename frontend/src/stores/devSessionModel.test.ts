import { describe, expect, it } from 'vitest'
import type { LiveSession, RequestRun } from '@/lib/devsession-api'
import { applyLiveEvent, codePathFor, emptyModel, linkedService, loopbackPort, primarySession, runForTab, serviceVars, sessionForRequest, timeOf } from './devSessionModel'

const session = (patch: Partial<LiveSession>): LiveSession => ({
  id: 'debug:1', goSessionId: 'go-1', service: 'users-service', projectRoot: '/p', kind: 'debug', resourceId: '1',
  title: 'users-service', port: 8080, state: 'running', startedAt: '2026-09-30T10:00:00Z', ...patch,
})

const run = (patch: Partial<RequestRun>): RequestRun => ({
  id: 'run-1', sessionId: 'debug:1', tabId: 'tab-1', method: 'PUT', url: 'http://localhost:8080/users/123', correlationId: 'adm-1',
  state: 'sent', startedAt: '2026-09-30T10:00:05Z', hits: [], logs: 0, queries: 0, messages: 0, ...patch,
})

describe('devSessionModel', () => {
  it('follows a request from sent to paused to completed', () => {
    let model = applyLiveEvent(emptyModel(), { type: 'debug.started', payload: session({}) })
    model = applyLiveEvent(model, { type: 'request.started', payload: run({}) })
    expect(runForTab(model, 'tab-1')?.state).toBe('sent')

    model = applyLiveEvent(model, { type: 'debug.paused', payload: session({ state: 'paused', pause: { function: 'handler.UpdateUser', relativePath: 'internal/handler/user_handler.go', line: 84, threadId: 1, at: '' } }) })
    model = applyLiveEvent(model, { type: 'breakpoint.hit', payload: { run: run({ state: 'paused', hits: [{ function: 'handler.UpdateUser', relativePath: 'internal/handler/user_handler.go', line: 84, at: '', confidence: 'likely' }] }) } })
    expect(runForTab(model, 'tab-1')?.state).toBe('paused')
    expect(primarySession(model)?.state).toBe('paused')

    model = applyLiveEvent(model, { type: 'debug.resumed', payload: session({ state: 'running' }) })
    expect(runForTab(model, 'tab-1')?.state).toBe('sent')
    model = applyLiveEvent(model, { type: 'request.completed', payload: run({ state: 'completed', status: 200, durationMs: 142 }) })
    expect(runForTab(model, 'tab-1')?.status).toBe(200)
  })

  it('keeps the newest run of a tab when an old one updates late', () => {
    let model = applyLiveEvent(emptyModel(), { type: 'request.started', payload: run({ id: 'old', startedAt: '2026-09-30T10:00:00Z' }) })
    model = applyLiveEvent(model, { type: 'request.started', payload: run({ id: 'new', startedAt: '2026-09-30T10:00:09Z' }) })
    model = applyLiveEvent(model, { type: 'request.completed', payload: run({ id: 'old', state: 'completed', startedAt: '2026-09-30T10:00:00Z' }) })
    expect(runForTab(model, 'tab-1')?.id).toBe('new')
  })

  it('caps logs per session', () => {
    const entries = Array.from({ length: 2500 }, (_, i) => ({ seq: i, sessionId: 's', at: '', stream: 'stdout', text: String(i) }))
    const model = applyLiveEvent(emptyModel(), { type: 'log.received', sessionId: 's', payload: entries })
    expect(model.logs.s).toHaveLength(2000)
    expect(model.logs.s[0].text).toBe('500')
  })

  it('prefers paused, then debugged, then running sessions for the debug bar', () => {
    let model = applyLiveEvent(emptyModel(), { type: 'service.started', payload: session({ id: 'run:a', kind: 'run', startedAt: '2026-09-30T10:00:09Z' }) })
    model = applyLiveEvent(model, { type: 'service.started', payload: session({ id: 'debug:b', startedAt: '2026-09-30T10:00:01Z' }) })
    expect(primarySession(model)?.id).toBe('debug:b')
    model = applyLiveEvent(model, { type: 'service.stopped', payload: session({ id: 'debug:b', startedAt: '2026-09-30T10:00:01Z', state: 'stopped', endedAt: 'x' }) })
    expect(primarySession(model)?.id).toBe('run:a')
    expect(primarySession(model, 'run:a')?.id).toBe('run:a')
  })

  it('resolves linked requests and matches loopback URLs', () => {
    const model = applyLiveEvent(emptyModel(), { type: 'service.started', payload: session({}) })
    expect(serviceVars(model, {})).toEqual({ 'service:users-service': 'http://localhost:8080' })
    expect(serviceVars(model, { 'users-service': { kind: 'remote', url: 'https://dev-api.company.com/' } })).toEqual({ 'service:users-service': 'https://dev-api.company.com' })
    expect(linkedService('{{service:users-service}}/users/123')).toBe('users-service')
    expect(linkedService('{{baseUrl}}/users')).toBeNull()
    expect(loopbackPort('http://127.0.0.1:8080/x')).toBe(8080)
    expect(loopbackPort('https://example.com/x')).toBe(0)
    expect(sessionForRequest(model, '{{baseUrl}}/users', 'http://localhost:8080/users')?.id).toBe('debug:1')
    expect(sessionForRequest(model, 'https://dev/users', 'https://dev/users')).toBeNull()
  })

  it('builds the code path from breakpoint stacks, caller first', () => {
    const path = codePathFor(run({
      hits: [{
        function: 'repo.Update', relativePath: 'internal/repo/user.go', line: 12, at: '', confidence: 'likely',
        stack: [
          { function: 'repo.Update', relativePath: 'internal/repo/user.go', line: 12 },
          { function: 'service.Update', relativePath: 'internal/service/user.go', line: 40 },
          { function: 'handler.UpdateUser', relativePath: 'internal/handler/user_handler.go', line: 84 },
          { function: 'net/http.HandlerFunc.ServeHTTP', relativePath: '', line: 2136 },
        ],
      }],
    }))
    expect(path).toEqual(['internal/handler/user_handler.go', 'internal/service/user.go', 'internal/repo/user.go'])
  })
})

describe('timestamps', () => {
  it('compares Go local offsets and JS UTC as instants', () => {
    // 10:00 at +02:00 is 08:00Z: later than 07:59Z even though the string sorts lower.
    const model = applyLiveEvent(emptyModel(), { type: 'service.started', payload: session({ id: 'a', startedAt: '2026-09-30T10:00:00+02:00' }) })
    const both = applyLiveEvent(model, { type: 'service.started', payload: session({ id: 'b', startedAt: '2026-09-30T08:30:00Z' }) })
    expect(primarySession(both)?.id).toBe('b')
    expect(timeOf('2026-09-30T10:00:00+02:00')).toBeGreaterThan(timeOf('2026-09-30T07:59:00Z'))
  })
})

describe('null hits', () => {
  it('normalizes a run without hits to an empty list', () => {
    const model = applyLiveEvent(emptyModel(), { type: 'request.completed', payload: { ...run({}), hits: null } })
    expect(Object.values(model.runs)[0].hits).toEqual([])
  })
})

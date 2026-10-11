import { describe, expect, it } from 'vitest'
import { shutdownChecks } from './shutdownChecks'

describe('shutdownChecks', () => {
  it('reads a clean shutdown', () => {
    const report = { target: '.', ready: true, readyMs: 500, shutdown: { signalAtMs: 1000, exitAtMs: 1300, exited: true, exitCode: 0, timedOut: false, stillOpen: [], goroutineDump: '', timeline: {} }, events: [
      { atMs: 1000, kind: 'signal', detail: 'interrupt sent' }, { atMs: 1010, kind: 'output', detail: 'shutting down' }, { atMs: 1100, kind: 'unlisten', detail: ':8080 closed' }, { atMs: 1200, kind: 'disconnect', detail: 'PostgreSQL :5432' },
    ] } as never
    const checks = Object.fromEntries(shutdownChecks(report).map((check) => [check.label, check.status]))
    expect(checks).toMatchObject({ 'Context cancellation': 'ok', 'HTTP graceful shutdown': 'ok', 'DB cleanup': 'ok', Timeout: 'ok', 'Resource leaks': 'ok', 'Pending goroutines': 'ok' })
  })

  it('explains a process that does not exit', () => {
    const report = { target: '.', ready: true, readyMs: 500, shutdown: { signalAtMs: 1000, exitAtMs: 11000, exited: false, exitCode: 1, timedOut: true, stillOpen: ['Kafka :9092'], goroutineDump: 'goroutine profile: total 7\n', timeline: {} }, events: [] } as never
    const checks = Object.fromEntries(shutdownChecks(report).map((check) => [check.label, check]))
    expect(checks['Timeout'].status).toBe('bad')
    expect(checks['Pending broker messages'].status).toBe('bad')
    expect(checks['Pending goroutines'].detail).toContain('7 goroutines')
    expect(checks['HTTP graceful shutdown'].status).toBe('bad')
  })
})

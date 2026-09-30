import { describe, expect, it } from 'vitest'
import { staticConcurrencyDiagnostics } from './goStudioLifecycleInspector'

describe('Go Studio static lifecycle inspector', () => {
  it('finds a context cancellation missing from the function that created it', () => {
    const diagnostics = staticConcurrencyDiagnostics(`package service
import "context"
func starts(parent context.Context) {
  ctx, cancel := context.WithCancel(parent)
  _ = ctx
  _ = cancel // merely naming it does not clean it up
}
`, 'worker.go')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ title: 'Context cancellation not observed', evidence: 'static', relativePath: 'worker.go', line: 4 })
  })

  it('accepts a deferred cancel and keeps cleanup scoped to its function', () => {
    const diagnostics = staticConcurrencyDiagnostics(`package service
import "context"
func clean(parent context.Context) {
  _, cancel := context.WithTimeout(parent, 0)
  defer cancel()
}
func notClean(parent context.Context) {
  _, release := context.WithDeadline(parent, deadline)
  _ = release
}
`, 'worker.go')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].detail).toContain('release()')
  })

  it('finds timers and tickers that are created without a later Stop call', () => {
    const diagnostics = staticConcurrencyDiagnostics(`package service
import "time"
func timers() {
  timer := time.NewTimer(time.Second)
  ticker := time.NewTicker(time.Second)
  defer ticker.Stop()
  _ = timer
}
`, 'timer.go')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ title: 'Timer stop not observed', evidence: 'static', line: 4 })
  })

  it('does not parse comments or strings as cleanup resources', () => {
    const diagnostics = staticConcurrencyDiagnostics(`package service
func commentOnly() {
  // _, cancel := context.WithCancel(parent)
  _ = "ticker := time.NewTicker(time.Second)"
}
`, 'comments.go')
    expect(diagnostics).toEqual([])
  })

  it('reports only opposite lock acquisition orders kept by deferred unlocks', () => {
    const diagnostics = staticConcurrencyDiagnostics(`package service
func cacheThenUser(s *Service) {
  s.cacheMu.Lock()
  defer s.cacheMu.Unlock()
  s.userMu.Lock()
  defer s.userMu.Unlock()
}
func userThenCache(s *Service) {
  s.userMu.Lock()
  defer s.userMu.Unlock()
  s.cacheMu.Lock()
  defer s.cacheMu.Unlock()
}
`, 'locks.go')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ title: 'Inconsistent lock order', kind: 'mutex', evidence: 'static', relativePath: 'locks.go' })
    expect(diagnostics[0].detail).toContain('s.cacheMu → s.userMu')
    expect(diagnostics[0].detail).toContain('s.userMu → s.cacheMu')
  })

  it('flags WaitGroup Add calls placed inside a newly started goroutine', () => {
    const diagnostics = staticConcurrencyDiagnostics(`package service
func start(wg *sync.WaitGroup) {
  go func() {
    wg.Add(1)
    defer wg.Done()
  }()
}
`, 'workers.go')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ title: 'WaitGroup Add inside goroutine', kind: 'waitgroup', evidence: 'static', line: 4 })
  })
})

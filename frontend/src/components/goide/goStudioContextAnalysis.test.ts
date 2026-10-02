import { describe, expect, it } from 'vitest'
import { analyzeContextPropagation, parseGoDuration, DEFAULT_TIMEOUT_THRESHOLD_MS } from './goStudioContextAnalysis'

function kinds(source: string) {
  return analyzeContextPropagation(source).findings.map((finding) => finding.kind)
}

describe('parseGoDuration', () => {
  it('parses unit literals and products', () => {
    expect(parseGoDuration('time.Second')).toBe(1000)
    expect(parseGoDuration('time.Hour')).toBe(3_600_000)
    expect(parseGoDuration('30 * time.Second')).toBe(30_000)
    expect(parseGoDuration('time.Second * 30')).toBe(30_000)
    expect(parseGoDuration('5*time.Minute')).toBe(300_000)
    expect(parseGoDuration('2 * time.Hour')).toBe(7_200_000)
  })

  it('returns null for unknown forms', () => {
    expect(parseGoDuration('time.Now()')).toBeNull()
    expect(parseGoDuration('5')).toBeNull()
    expect(parseGoDuration('x + y')).toBeNull()
  })
})

describe('analyzeContextPropagation', () => {
  it('highlights context.Background and context.TODO roots', () => {
    const source = `
func a() {
  ctx := context.Background()
  _ = ctx
}
func b() {
  ctx := context.TODO()
  _ = ctx
}
`
    expect(kinds(source)).toContain('background')
    expect(kinds(source)).toContain('todo')
  })

  it('detects a broken cancellation chain (func receives ctx but creates a new root)', () => {
    const source = `
func handler(ctx context.Context) {
  local := context.Background()
  _ = local
}
`
    const findings = analyzeContextPropagation(source).findings
    expect(findings.map((finding) => finding.kind)).toContain('broken-chain')
    expect(findings.find((finding) => finding.kind === 'broken-chain')?.severity).toBe('error')
  })

  it('detects context stored in a struct', () => {
    const source = `
type Service struct {
  ctx context.Context
  name string
}
`
    expect(kinds(source)).toContain('context-in-struct')
  })

  it('detects a leaked cancel function', () => {
    const source = `
func run(ctx context.Context) {
  child, cancel := context.WithCancel(ctx)
  _ = child
}
`
    expect(kinds(source)).toContain('leaked-cancel')
  })

  it('does not flag a deferred cancel function', () => {
    const source = `
func run(ctx context.Context) {
  child, cancel := context.WithCancel(ctx)
  defer cancel()
  _ = child
}
`
    expect(kinds(source)).not.toContain('leaked-cancel')
  })

  it('detects a too-wide timeout against the configured threshold', () => {
    const source = `
func run(ctx context.Context) {
  child, cancel := context.WithTimeout(ctx, 2*time.Hour)
  defer cancel()
  _ = child
}
`
    expect(kinds(source)).toContain('wide-timeout')
    const below = analyzeContextPropagation(source, { timeoutThresholdMs: 10_000_000 }).findings
    expect(below.map((finding) => finding.kind)).not.toContain('wide-timeout')
  })

  it('detects ignored cancellation (empty ctx.Done case)', () => {
    const source = `
func run(ctx context.Context) {
  select {
  case <-ctx.Done():
  case <-time.After(time.Second):
  }
}
`
    expect(kinds(source)).toContain('ignored-cancellation')
  })

  it('detects a select without a ctx.Done case in a function that has a context', () => {
    const source = `
func run(ctx context.Context) {
  select {
  case v := <-ch:
    _ = v
  }
}
`
    const findings = analyzeContextPropagation(source).findings
    const cancelled = findings.filter((finding) => finding.kind === 'ignored-cancellation')
    expect(cancelled.some((finding) => finding.message.includes('without a ctx.Done'))).toBe(true)
  })

  it('detects a missing timeout on a root context used in a goroutine', () => {
    const source = `
func run() {
  ctx := context.Background()
  go work(ctx)
}
func work(ctx context.Context) {}
`
    expect(kinds(source)).toContain('missing-timeout')
  })

  it('does not flag a root context wrapped with WithTimeout', () => {
    const source = `
func run() {
  ctx := context.Background()
  child, cancel := context.WithTimeout(ctx, time.Second)
  defer cancel()
  go work(child)
}
func work(ctx context.Context) {}
`
    expect(kinds(source)).not.toContain('missing-timeout')
  })

  it('detects trace id correlation through WithValue and literals', () => {
    const source = `
func run(ctx context.Context) {
  ctx = context.WithValue(ctx, traceID, "abc")
  _ = ctx
}
func header() {
  _ = "x-request-id"
}
`
    expect(kinds(source)).toContain('trace-id')
  })

  it('builds a context graph of nodes and edges', () => {
    const source = `
func main() {
  ctx := context.Background()
  handle(ctx)
}
func handle(ctx context.Context) {
  save(ctx)
}
func save(ctx context.Context) {}
`
    const analysis = analyzeContextPropagation(source)
    const labels = analysis.nodes.map((node) => node.label)
    expect(labels).toEqual(expect.arrayContaining(['main', 'handle', 'save']))
    const hasEdge = analysis.edges.some((edge) => edge.from === 'main' && edge.to === 'handle')
    expect(hasEdge).toBe(true)
  })

  it('produces a stable, unique id for every finding', () => {
    const source = `
func run(ctx context.Context) {
  local := context.Background()
  other := context.Background()
  _ = local
  _ = other
}
`
    const findings = analyzeContextPropagation(source).findings
    const ids = findings.map((finding) => finding.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses the default threshold of 30s when not configured', () => {
    expect(DEFAULT_TIMEOUT_THRESHOLD_MS).toBe(30_000)
  })
})

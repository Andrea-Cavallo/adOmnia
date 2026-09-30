import { describe, expect, it } from 'vitest'
import { raceRegressionTestStarter } from './goStudioRaceRegression'

describe('Go Studio race regression test starter', () => {
  it('creates an editable Go test scaffold with both race locations and a -race command', () => {
    const source = raceRegressionTestStarter({
      id: 'race-1', occurrences: 1, sources: [], raw: '', goroutines: [],
      accesses: [
        { kind: 'Write', address: '0x1', goroutine: 7, frames: [{ func: 'main.(*Counter).Inc', path: 'counter.go', line: 14 }] },
        { kind: 'Previous read', address: '0x1', goroutine: 1, frames: [{ func: 'main.(*Counter).Value', path: 'counter.go', line: 18 }] },
      ],
    })
    expect(source).toContain('func TestRaceRegressionMainCounterInc')
    expect(source).toContain('go test -race -run ^TestRaceRegressionMainCounterInc$ ./...')
    expect(source).toContain('// Write: main.(*Counter).Inc (counter.go:14)')
    expect(source).toContain('// Previous read: main.(*Counter).Value (counter.go:18)')
    expect(source).toContain('t.Skip(')
  })
})

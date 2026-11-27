import { describe, expect, it } from 'vitest'
import { rates, readCurrentOps, readServerStatus } from './serverStats'

const status = (query: number, bytesIn: number) => ({
  version: '7.0.5',
  uptime: { $numberInt: '120' },
  opcounters: { query: { $numberLong: String(query) }, insert: 0, update: 0, delete: 0, getmore: 0, command: 10 },
  connections: { current: 4, available: 800 },
  network: { bytesIn: { $numberLong: String(bytesIn) }, bytesOut: 0 },
  mem: { resident: 120 },
})

describe('server stats', () => {
  it('turns counters into per-second rates', () => {
    const a = readServerStatus(status(100, 1000), 0)
    const b = readServerStatus(status(140, 3000), 2000)
    expect(a.connections).toBe(4)
    expect(a.version).toBe('7.0.5')
    const r = rates(a, b)
    expect(r.ops.query).toBe(20)
    expect(r.totalOps).toBe(20)
    expect(r.bytesInPerSec).toBe(1000)
    // A restart resets counters: never negative.
    expect(rates(b, a).ops.query).toBe(0)
  })

  it('lists running ops slowest first, hiding the currentOp call', () => {
    const ops = readCurrentOps({ inprog: [
      { opid: 1, op: 'query', ns: 'shop.orders', secs_running: 2 },
      { opid: 2, op: 'command', command: { currentOp: 1 } },
      { opid: 3, op: 'update', ns: 'shop.users', secs_running: 9 },
    ] })
    expect(ops.map((o) => o.opid)).toEqual([3, 1])
  })
})

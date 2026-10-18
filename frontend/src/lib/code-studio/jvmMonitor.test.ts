import { describe, expect, it } from 'vitest'
import type { JVMHeapSample } from '../../../bindings/adomnia/internal/languages/java/models'
import { formatKb, gcOverheadPercent, pushSample, sparkline } from './jvmMonitor'

const sample = (heapUsedKb: number, extra: Partial<JVMHeapSample> = {}) => ({ heapUsedKb, heapCapacityKb: 1000, youngUsedKb: 0, oldUsedKb: 0, youngGcs: 0, youngGcSeconds: 0, fullGcs: 0, fullGcSeconds: 0, uptimeSeconds: 0, ...extra }) as JVMHeapSample

describe('jvm monitor helpers', () => {
  it('keeps a bounded history without mutating the previous one', () => {
    const first = [sample(1), sample(2)]
    const next = pushSample(first, sample(3), 2)
    expect(next.map((item) => item.heapUsedKb)).toEqual([2, 3])
    expect(first).toHaveLength(2)
  })
  it('scales a sparkline into the box, clamping and inverting y', () => {
    expect(sparkline([0, 500, 2000], 1000, 100, 10)).toBe('0.0,10.0 50.0,5.0 100.0,0.0')
    expect(sparkline([], 1000, 100, 10)).toBe('')
    expect(sparkline([5], 0, 100, 10)).toBe('')
  })
  it('formats sizes and GC overhead', () => {
    expect(formatKb(512)).toBe('512 KB')
    expect(formatKb(143477)).toBe('140.1 MB')
    expect(formatKb(3 * 1024 * 1024)).toBe('3.00 GB')
    expect(formatKb(Number.NaN)).toBe('—')
    expect(gcOverheadPercent(sample(1, { youngGcSeconds: 0.3, fullGcSeconds: 0.2, uptimeSeconds: 50 }))).toBeCloseTo(1)
    expect(gcOverheadPercent(sample(1))).toBe(0)
  })
})

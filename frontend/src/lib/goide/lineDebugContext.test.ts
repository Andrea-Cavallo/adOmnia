import { describe, expect, it } from 'vitest'
import type { GoIDEGoroutine } from '@/lib/goide-debug-api'
import { goroutinesForLine, waitsForLine, isErrorLine } from './lineDebugContext'
const site = (relativePath: string, line: number) => ({ id: 0, name: '', relativePath, line, column: 1 })
const goroutine = (id: number, state: string, originLine: number, locationLine: number, blockedOn = '') => ({ id, state, origin: site('worker.go', originLine), location: site('worker.go', locationLine), blockedOn, frames: [], current: false, name: '' }) as GoIDEGoroutine
describe('line debug context', () => {
  it('connects creator lines to actual channel and mutex waits elsewhere in the file', () => {
    const snapshot = [goroutine(1,'chan receive',10,25,'orders'), goroutine(2,'mutex',10,30,'store.mu'), goroutine(3,'running',40,45)]
    expect(goroutinesForLine(snapshot,'worker.go',10).map(g=>g.id)).toEqual([1,2])
    expect(waitsForLine(snapshot,'worker.go',10).map(wait=>wait.target)).toEqual(['orders','store.mu'])
    expect(goroutinesForLine(snapshot,'other.go',10)).toEqual([])
    expect(waitsForLine(snapshot,'worker.go',45)).toEqual([])
  })
  it('also connects a wait line without attributing unrelated goroutines to it', () => {
    const snapshot = [goroutine(1,'chan receive',10,25,'orders'), goroutine(2,'mutex',40,30,'store.mu')]
    expect(goroutinesForLine(snapshot,'worker.go',25).map(g=>g.id)).toEqual([1])
  })
  it('recognizes error wrapping, checks and panic handling', () => {
    for (const line of ['if err != nil {', 'return fmt.Errorf("wrapped: %w", cause)', 'panic("broken")', 'errors.Is(cause, io.EOF)']) expect(isErrorLine(line)).toBe(true)
    expect(isErrorLine('return user.Name')).toBe(false)
  })
})

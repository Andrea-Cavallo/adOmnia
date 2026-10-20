import { afterEach, expect, it, vi } from 'vitest'
import type { GoIDEEvent } from '@/lib/code-studio-api'
import { diagnosticEventBatch } from './diagnosticEvents'
const event = (sessionId: string, uri: string, diagnostics: unknown[] = [1]): GoIDEEvent => ({ type: 'lsp.diagnostics', sessionId, payload: { uri, diagnostics } } as GoIDEEvent)
afterEach(() => vi.useRealTimers())
it('delivers 1000 different files once and retains only the latest diagnostics per file and session', () => {
 vi.useFakeTimers()
 const deliver = vi.fn(); const receive = diagnosticEventBatch(deliver)
 for (let i = 0; i < 1000; i++) receive(event('java', `file://${i}.java`))
 receive(event('java', 'file://0.java', []))
 receive(event('go', 'file://0.java'))
 expect(deliver).not.toHaveBeenCalled()
 vi.advanceTimersByTime(50)
 expect(deliver).toHaveBeenCalledTimes(1)
 expect(deliver.mock.calls[0][0]).toHaveLength(1001)
 expect(deliver.mock.calls[0][0][0].payload.diagnostics).toEqual([])
})
it('flushes earlier diagnostics before a stop event, so an old timer cannot restore cleared problems', () => {
 vi.useFakeTimers()
 const deliver = vi.fn(); const receive = diagnosticEventBatch(deliver)
 const stopped = { type: 'lsp.status', sessionId: 'java', payload: { state: 'stopped' } } as GoIDEEvent
 receive(event('java', 'file://A.java')); receive(stopped)
 expect(deliver.mock.calls.map(([events]) => events[0].type)).toEqual(['lsp.diagnostics', 'lsp.status'])
 vi.runAllTimers(); expect(deliver).toHaveBeenCalledTimes(2)
})

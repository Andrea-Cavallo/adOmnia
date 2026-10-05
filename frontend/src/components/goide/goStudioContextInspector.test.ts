import { describe, expect, it } from 'vitest'
import { goStudioContextFields, goStudioContextTraceId } from './goStudioContextInspector'

const field = (name: string, value: string) => ({ name, value, type: 'any', variablesReference: 0 })

describe('Go Studio context inspector', () => {
  it('keeps the context data exposed by Delve and hides unrelated runtime fields', () => {
    const fields = goStudioContextFields([
      field('key', 'string "request-id"'),
      field('val', 'string "abc"'),
      { name: 'deadline', value: '2026-01-01', type: 'time.Time', variablesReference: 0 },
      { name: 'mu', value: '{...}', type: 'sync.Mutex', variablesReference: 0 },
      { name: 'Context', value: 'context.Background', type: 'context.Context', variablesReference: 3 },
    ])
    expect(fields.map((item) => item.name)).toEqual(['key', 'val', 'deadline', 'Context'])
  })

  it('reads the runtime trace id carried by a context value', () => {
    expect(goStudioContextTraceId([field('key', 'main.ctxKey "trace_id"'), field('val', 'string "4bf92f35"')])).toBe('4bf92f35')
    expect(goStudioContextTraceId([field('key', 'string "user"'), field('val', 'string "bob"')])).toBeNull()
    expect(goStudioContextTraceId([field('key', 'string "requestID"'), field('val', 'int 7')])).toBeNull()
  })
})

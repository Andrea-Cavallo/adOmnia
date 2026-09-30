import { describe, expect, it } from 'vitest'
import { goStudioContextFields } from './goStudioContextInspector'

describe('Go Studio context inspector', () => {
  it('keeps the context data exposed by Delve and hides unrelated runtime fields', () => {
    const fields = goStudioContextFields([
      { name: 'key', value: 'string "request-id"', type: 'any', variablesReference: 0 },
      { name: 'val', value: 'string "abc"', type: 'any', variablesReference: 0 },
      { name: 'deadline', value: '2026-01-01', type: 'time.Time', variablesReference: 0 },
      { name: 'mu', value: '{...}', type: 'sync.Mutex', variablesReference: 0 },
      { name: 'Context', value: 'context.Background', type: 'context.Context', variablesReference: 3 },
    ])
    expect(fields.map((field) => field.name)).toEqual(['key', 'val', 'deadline', 'Context'])
  })
})

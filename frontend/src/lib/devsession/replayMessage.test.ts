import { describe, expect, it } from 'vitest'
import { replayBlocker, replayHeaders } from './replayMessage'

describe('replay message', () => {
  it('refuses payloads the capture did not keep whole', () => {
    expect(replayBlocker({ preview: '{"id":1}' })).toBeNull()
    expect(replayBlocker({ preview: '(42 bytes, binary)' })).toMatch(/Binary/)
    expect(replayBlocker({ preview: `${'x'.repeat(500)}…` })).toMatch(/truncated/)
  })
  it('drops the original request ids from the headers', () => {
    expect(replayHeaders({ traceparent: '00-a-b-01', 'X-AdOmnia-Request-ID': 'adm-1', tenant: 't1' })).toEqual({ tenant: 't1' })
  })
})

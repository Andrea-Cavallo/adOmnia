import { describe, expect, it } from 'vitest'
import type { WsFrame } from '@/stores/websocketConnections'
import { compactPayload, frameMatches, framesToJsonl, topicOf } from './wsFormat'

const frame = (patch: Partial<WsFrame>): WsFrame => ({ id: '1', type: 'message', direction: 'inbound', content: '', timestamp: 0, ...patch })

describe('wsFormat', () => {
  it('names a frame after its JSON event', () => {
    expect(topicOf(frame({ content: '{"type":"trade"}' }))).toBe('trade')
    expect(topicOf(frame({ content: '{"event":7}' }))).toBe('7')
    expect(topicOf(frame({ content: 'plain', type: 'ping' }))).toBe('ping')
  })

  it('filters by direction, errors and search text', () => {
    const error = frame({ type: 'error', direction: 'system', content: 'boom' })
    expect(frameMatches(error, 'error', '')).toBe(true)
    expect(frameMatches(error, 'inbound', '')).toBe(false)
    expect(frameMatches(frame({ content: '{"type":"Quote"}' }), 'all', 'quote')).toBe(true)
    expect(frameMatches(frame({ direction: 'outbound' }), 'outbound', 'x')).toBe(false)
  })

  it('compacts payloads and exports JSON Lines', () => {
    expect(compactPayload('{ "a" : 1 }')).toBe('{"a":1}')
    expect(compactPayload('a\n  b')).toBe('a b')
    expect(framesToJsonl([frame({ content: 'x' }), frame({ content: 'y', client: '#2' })]).split('\n').map((line) => JSON.parse(line).content)).toEqual(['x', 'y'])
  })
})

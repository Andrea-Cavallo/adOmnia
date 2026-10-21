import { describe, expect, it } from 'vitest'
import type { RequestHistoryEntry, ResponseData } from './types'
import {
  previewBody, readSpilledBody, shouldSpillBody, spillHistory, spillResponse, spillResponseMap,
  RESPONSE_PREVIEW_CHARS, RESPONSE_SPILL_BYTES, type BodyStore,
} from './responseSpill'

function memoryStore(): BodyStore & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    get: async (key) => values.get(key) ?? '',
    put: async (key, value) => { values.set(key, value) },
  }
}

function response(body: string): ResponseData {
  return { status: 200, statusText: 'OK', headers: {}, body, contentType: 'application/json', ms: 1, size: body.length }
}

describe('response spill', () => {
  it('keeps small bodies in the session', async () => {
    const store = memoryStore()
    const small = response('{"ok":true}')
    expect(shouldSpillBody(small)).toBe(false)
    expect(await spillResponse('tab-1', small, store)).toBe(small)
    expect(store.values.size).toBe(0)
  })

  it('stores large bodies outside and returns a preview with a reference', async () => {
    const store = memoryStore()
    const big = 'x'.repeat(RESPONSE_SPILL_BYTES + 10)
    const spilled = await spillResponse('tab-2', response(big), store)
    expect(spilled.bodyRef).toBe('response-body:tab-2')
    expect(spilled.body).toHaveLength(RESPONSE_PREVIEW_CHARS)
    expect(spilled.body).toBe(previewBody(big))
    expect(store.values.get('response-body:tab-2')).toBe(big)
  })

  it('reads the full body back on demand', async () => {
    const store = memoryStore()
    const big = 'y'.repeat(RESPONSE_SPILL_BYTES + 1)
    const spilled = await spillResponse('tab-3', response(big), store)
    expect(await readSpilledBody(spilled, store)).toBe(big)
    expect(await readSpilledBody(response('small'), store)).toBeNull()
  })

  it('spills tab responses and history entries in bulk', async () => {
    const store = memoryStore()
    const big = 'z'.repeat(RESPONSE_SPILL_BYTES + 1)
    const map = await spillResponseMap({ a: response(big), b: response('ok') }, store)
    expect(map.a.bodyRef).toBe('response-body:a')
    expect(map.b.bodyRef).toBeUndefined()

    const entry: RequestHistoryEntry = { id: 'h1', recordedAt: null, response: response(big) }
    const history = await spillHistory([entry], store)
    expect(history[0].response.bodyRef).toBe('response-body:h1')
    expect(store.values.get('response-body:h1')).toBe(big)
  })
})

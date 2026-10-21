import { describe, expect, it } from 'vitest'
import { RECORDED_BODY_MAX_BYTES, recordingSource } from './flowRecordingLinks'
import type { ResponseData } from './types'

function response(body: string): ResponseData {
  return { status: 200, statusText: 'OK', headers: {}, body, contentType: 'application/json', ms: 1, size: body.length }
}

describe('recordingSource weight', () => {
  it('keeps and parses a normal response body', () => {
    const source = recordingSource(1, response('{"id":"abc"}'))
    expect(source.body).toEqual({ id: 'abc' })
    expect(source.truncated).toBeUndefined()
  })

  it('drops a body above the budget but keeps the step', () => {
    const big = '{"data":"' + 'x'.repeat(RECORDED_BODY_MAX_BYTES) + '"}'
    const source = recordingSource(2, response(big))
    expect(source.seq).toBe(2)
    expect(source.body).toBeUndefined()
    expect(source.truncated).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { stripHeavyBodies } from './HarViewerPanel'

type Fixture = {
  startedDateTime: string
  time: number
  request: { method: string; url: string; headers: unknown[]; bodySize: number; postData?: { mimeType: string; text?: string } }
  response: { status: number; statusText: string; headers: unknown[]; content: { size: number; mimeType: string; text?: string }; bodySize: number }
  timings: Record<string, never>
}

type Kept = {
  log: {
    entries: Array<{
      request: { postData?: { text?: string } }
      response: { content: { text?: string } }
      _requestBodyOmitted?: boolean
      _responseBodyOmitted?: boolean
    }>
  }
}

function entry(index: number, responseText?: string, requestText?: string): Fixture {
  return {
    startedDateTime: new Date(Date.UTC(2026, 9, 21, 10, 0, index)).toISOString(),
    time: 10,
    request: {
      method: 'POST',
      url: `https://example.test/${index}`,
      headers: [],
      bodySize: requestText?.length ?? 0,
      ...(requestText !== undefined ? { postData: { mimeType: 'application/json', text: requestText } } : {}),
    },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [],
      content: { size: responseText?.length ?? 0, mimeType: 'application/json', ...(responseText !== undefined ? { text: responseText } : {}) },
      bodySize: responseText?.length ?? 0,
    },
    timings: {},
  }
}

function doc(entries: Fixture[]) {
  return { log: { version: '1.2', entries } }
}

function strip(entries: Fixture[]) {
  const result = stripHeavyBodies(doc(entries) as unknown as Parameters<typeof stripHeavyBodies>[0])
  return { kept: result.doc as unknown as Kept, omitted: result.omitted }
}

describe('stripHeavyBodies', () => {
  it('drops response bodies above 512 KB and keeps small ones', () => {
    const big = 'x'.repeat(512 * 1024 + 1)
    const { kept, omitted } = strip([entry(1, big), entry(2, '{"ok":true}')])
    expect(omitted).toBe(1)
    expect(kept.log.entries[0].response.content.text).toBeUndefined()
    expect(kept.log.entries[0]._responseBodyOmitted).toBe(true)
    expect(kept.log.entries[1].response.content.text).toBe('{"ok":true}')
  })

  it('drops heavy request bodies too and does not touch the source entry', () => {
    const big = 'y'.repeat(512 * 1024 + 1)
    const source = entry(3, 'small', big)
    const { kept, omitted } = strip([source])
    expect(omitted).toBe(1)
    expect(kept.log.entries[0].request.postData?.text).toBeUndefined()
    expect(kept.log.entries[0]._requestBodyOmitted).toBe(true)
    expect(source.request.postData?.text).toHaveLength(big.length)
  })
})

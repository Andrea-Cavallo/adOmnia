import { describe, expect, it } from 'vitest'
import { parseLogText } from './parse'
import { requestDraftFromEvent } from './reproduce'

function parse(text: string) {
  return parseLogText(text).events
}

describe('requestDraftFromEvent', () => {
  it('extracts method, route, headers and body and declares the missing host', () => {
    const events = parse(JSON.stringify({
      level: 'error',
      message: 'payment failed',
      correlation_id: 'abc',
      http: { method: 'POST', route: '/payments', status_code: 500 },
      attributes: {
        http: {
          request: { headers: { 'X-Api-Key': 'k', 'Content-Length': '12' }, body: { amount: 10 } },
        },
      },
    }))
    const draft = requestDraftFromEvent(events, events[0])
    expect(draft.request.method).toBe('POST')
    expect(draft.request.url).toBe('{{baseUrl}}/payments')
    expect(draft.request.headers.map((header) => header.key)).toEqual(['X-Api-Key'])
    expect(draft.request.bodies[0].raw).toContain('"amount": 10')
    expect(draft.missing.join(' ')).toContain('host')
  })

  it('keeps an absolute url and splits its query string', () => {
    const events = parse(JSON.stringify({ message: 'ok', http: { method: 'GET', url: 'https://api.test/v1/users?page=2' } }))
    const draft = requestDraftFromEvent(events, events[0])
    expect(draft.request.url).toBe('https://api.test/v1/users')
    expect(draft.request.params[0]).toMatchObject({ key: 'page', value: '2' })
    expect(draft.missing.some((item) => item.includes('host'))).toBe(false)
  })

  it('reports every missing part instead of inventing values', () => {
    const events = parse('plain text line without any http field')
    const draft = requestDraftFromEvent(events, events[0])
    expect(draft.request.method).toBe('GET')
    expect(draft.missing.length).toBeGreaterThan(1)
    expect(draft.request.description).toContain('Missing from the log')
  })
})

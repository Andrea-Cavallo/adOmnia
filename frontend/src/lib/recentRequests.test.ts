import { describe, expect, it } from 'vitest'
import { recentRequests } from './recentRequests'
import type { RequestHistoryEntry } from './types'

function entry(
  id: string,
  method: string,
  url: string,
  status: number,
  recordedAt: string | null,
  options: { name?: string; error?: boolean; withoutRequest?: boolean } = {},
): RequestHistoryEntry {
  return {
    id,
    recordedAt,
    request: options.withoutRequest
      ? undefined
      : ({ id: `request-${id}`, name: options.name ?? '', method, url } as RequestHistoryEntry['request']),
    response: {
      status,
      statusText: '',
      headers: {},
      body: '',
      contentType: 'application/json',
      ms: 12,
      size: 0,
      ...(options.error ? { error: { code: 'network', message: 'failed' } } : {}),
    },
  }
}

describe('Hub recent requests', () => {
  it('keeps the history order, skips entries that cannot be reopened and reads the status', () => {
    const requests = recentRequests([
      entry('a', 'GET', 'https://api.test/users', 200, '2026-10-25T10:00:00Z', { name: 'List users' }),
      entry('b', 'POST', 'https://api.test/users', 500, '2026-10-25T09:00:00Z'),
      entry('c', 'GET', '', 0, null, { withoutRequest: true }),
      entry('d', 'DELETE', 'https://api.test/users/1', 0, '2026-10-25T08:00:00Z', { error: true }),
    ])
    expect(requests.map((item) => item.method)).toEqual(['GET', 'POST', 'DELETE'])
    expect(requests[0]).toMatchObject({ name: 'List users', status: 200, failed: false })
    expect(requests[1]).toMatchObject({ name: 'https://api.test/users', status: 500, failed: true })
    expect(requests[2]).toMatchObject({ status: 0, failed: true })
    expect(requests[2].recordedAt).toBe(Date.parse('2026-10-25T08:00:00Z'))
  })

  it('shows each method + URL once, newest first, up to the limit', () => {
    const requests = recentRequests([
      entry('1', 'GET', 'https://api.test/a', 200, '2026-10-25T10:00:00Z'),
      entry('2', 'GET', 'https://api.test/a', 200, '2026-10-25T09:00:00Z'),
      entry('3', 'GET', 'https://api.test/b', 200, '2026-10-25T08:00:00Z'),
      entry('4', 'GET', 'https://api.test/c', 200, '2026-10-25T07:00:00Z'),
      entry('5', 'GET', 'https://api.test/d', 200, '2026-10-25T06:00:00Z'),
      entry('6', 'GET', 'https://api.test/e', 200, '2026-10-25T05:00:00Z'),
    ])
    expect(requests.map((item) => item.id)).toEqual(['1', '3', '4', '5', '6'])
    expect(recentRequests([], 5)).toEqual([])
  })
})

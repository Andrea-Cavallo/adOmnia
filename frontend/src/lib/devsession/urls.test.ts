import { describe, expect, it } from 'vitest'
import { linkUrlToService } from '@/components/devsession/LiveRequestStrip'
import { retarget } from './debugRequest'
import { withHeader } from './liveRequest'
import { maskHeader } from '@/components/devsession/RequestContextView'
import { blankRequest } from '@/lib/types'

describe('live request URLs', () => {
  it('links a request to a service, keeping path and query', () => {
    expect(linkUrlToService('http://localhost:8080/users/123?x=1', 'users-service')).toBe('{{service:users-service}}/users/123?x=1')
    expect(linkUrlToService('{{baseUrl}}/users/{{id}}', 'users-service')).toBe('{{service:users-service}}/users/{{id}}')
    expect(linkUrlToService('http://localhost:8080', 'users-service')).toBe('{{service:users-service}}')
  })

  it('retargets a request to the live service', () => {
    expect(retarget('{{baseUrl}}/users/1?a=b', { baseUrl: 'https://dev.example.com' }, 'http://localhost:8080')).toBe('http://localhost:8080/users/1?a=b')
    expect(retarget('{{host}}/users/1', {}, 'http://localhost:8080')).toBe('http://localhost:8080/users/1')
  })

  it('adds the correlation header once', () => {
    const request = blankRequest('GET', 'x')
    const once = withHeader(request, 'X-AdOmnia-Request-ID', 'adm-1')
    expect(once.headers.filter((h) => h.key === 'X-AdOmnia-Request-ID')).toHaveLength(1)
    expect(withHeader(once, 'x-adomnia-request-id', 'adm-2')).toBe(once)
  })

  it('masks credential headers', () => {
    expect(maskHeader('Authorization', 'Bearer abc.def')).toBe('Bearer ***')
    expect(maskHeader('X-Api-Key', 'secret')).toBe('***')
    expect(maskHeader('Content-Type', 'application/json')).toBe('application/json')
  })
})

import { describe, expect, it } from 'vitest'
import { blankRequest } from '@/lib/types'
import { requestWithUrlInput, resolvedRequestUrl, urlWithQuery } from '@/lib/requestUrl'

describe('request URL synchronization', () => {
  it('uses one update path for URL input and keeps path values while a placeholder is renamed', () => {
    const request = {
      ...blankRequest('GET', 'Tenant'),
      url: 'https://api.test/tenants/{tenantId}?page=1',
      pathParams: [{ id: 'tenant', key: 'tenantId', value: 'acme', enabled: true }],
    }

    const next = requestWithUrlInput(request, 'https://api.test/tenants/{id}?page=2')

    expect(next.pathParams).toMatchObject([{ key: 'id', value: 'acme', enabled: true }])
    expect(next.params[0]).toMatchObject({ key: 'page', value: '2', enabled: true })
    expect(resolvedRequestUrl(next)).toBe('https://api.test/tenants/acme?page=2')
  })

  it('rewrites query rows without replacing the path template', () => {
    expect(urlWithQuery('https://api.test/tenants/{id}#details', [
      { id: 'query', key: 'include', value: 'users', enabled: true },
    ])).toBe('https://api.test/tenants/{id}?include=users#details')
  })
})

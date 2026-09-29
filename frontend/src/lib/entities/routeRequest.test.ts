import { describe, expect, it } from 'vitest'
import { httpMethodForRoute, mockPathForRoute, requestUrlForRoute, withBaseUrl } from './routeRequest'

describe('route → request helpers', () => {
  it('builds a request URL on {{baseUrl}} with path params as variables', () => {
    expect(requestUrlForRoute('/payments/{id}/items/{itemId}')).toBe('{{baseUrl}}/payments/{{id}}/items/{{itemId}}')
    expect(requestUrlForRoute('/files/{path...}')).toBe('{{baseUrl}}/files/{{path}}')
  })
  it('maps ANY and unknown methods to GET', () => {
    expect(httpMethodForRoute('ANY')).toBe('GET')
    expect(httpMethodForRoute('delete')).toBe('DELETE')
    expect(httpMethodForRoute('CONNECTX')).toBe('GET')
  })
  it('converts to mock :param syntax', () => {
    expect(mockPathForRoute('/payments/{id}')).toBe('/payments/:id')
  })
  it('replaces or appends baseUrl without touching other variables', () => {
    const vars = [{ id: 'a', key: 'token', value: 't', enabled: true }, { id: 'b', key: 'baseUrl', value: 'old', enabled: false }]
    const next = withBaseUrl(vars, 'http://localhost:8080')
    expect(next).toEqual([vars[0], { ...vars[1], value: 'http://localhost:8080', enabled: true }])
    expect(vars[1].value).toBe('old')
    const appended = withBaseUrl([vars[0]], 'http://localhost:9000')
    expect(appended[1]).toMatchObject({ key: 'baseUrl', value: 'http://localhost:9000', enabled: true })
  })
})

import { describe, expect, it } from 'vitest'
import { generateCode } from './codegen'
import { blankRequest } from './types'

function queryRequest() {
  const request = blankRequest('QUERY', 'Query users')
  request.url = 'https://api.example.com/users/search'
  request.headers = [{ id: 'content-type', key: 'Content-Type', value: 'application/query+json', enabled: true }]
  request.bodies = [{
    id: 'body',
    name: 'Query body',
    type: 'raw',
    raw: '{"filter":"active"}',
    lang: 'json',
    form: [],
  }]
  request.activeBodyIdx = 0
  return request
}

describe('generateCode QUERY method', () => {
  it('uses generic request APIs where language helpers do not expose QUERY', () => {
    const request = queryRequest()

    expect(generateCode(request, 'python-requests')).toContain('requests.request("QUERY",')
    expect(generateCode(request, 'csharp')).toContain('new HttpMethod("QUERY")')
    expect(generateCode(request, 'java-okhttp')).toContain('builder.method("QUERY", body)')
    expect(generateCode(request, 'ruby-nethttp')).toContain('Net::HTTPGenericRequest.new("QUERY", true, true, url.request_uri)')
    expect(generateCode(request, 'rust-reqwest')).toContain('reqwest::Method::from_bytes(b"QUERY")?')
  })
})

import { describe, expect, it } from 'vitest'
import { httpFileRequests } from './httpFile'

describe('httpFileRequests', () => {
  it('finds one request per ### block, with its line', () => {
    const source = '# comment\nGET {{base}}/orders\nAccept: application/json\n\n### create\nPOST {{base}}/orders\nContent-Type: application/json\n\n{"id": 1}\n###\n# nothing here\n'
    const requests = httpFileRequests(source)
    expect(requests.map(({ line, method }) => ({ line, method }))).toEqual([{ line: 2, method: 'GET' }, { line: 6, method: 'POST' }])
    expect(requests[1].text).toContain('{"id": 1}')
    expect(requests[1].text).not.toContain('###')
  })
})

import { describe, expect, it } from 'vitest'
import { entityRefFrom, type DevEntity } from '../devcontext-api'

describe('entityRefFrom', () => {
  it('keeps attrs, first source and the session', () => {
    const entity: DevEntity = {
      id: 'route:GET /x', kind: 'route', label: 'GET /x', attrs: { method: 'GET' }, confidence: 'inferred',
      sources: [{ detector: 'goroutes', file: 'api/r.go', line: 4 }, { detector: 'oas', file: 'api/o.yaml', line: 9 }],
    }
    expect(entityRefFrom(entity, 's1')).toEqual({
      kind: 'route', id: 'route:GET /x', label: 'GET /x', attrs: { method: 'GET' },
      source: { file: 'api/r.go', line: 4 }, sessionId: 's1',
    })
  })

  it('tolerates null attrs/sources from Go', () => {
    const ref = entityRefFrom({ id: 'table:t', kind: 'table', label: 't', attrs: null as unknown as Record<string, string>, sources: null as unknown as [], confidence: 'inferred' }, 's1')
    expect(ref.attrs).toEqual({})
    expect(ref.source).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { blankRequest, uid } from '@/lib/types'
import { validateRequestParams } from '@/lib/requestParamValidation'

describe('validateRequestParams', () => {
  it('ignores the empty trailing query row', () => {
    const request = blankRequest()
    request.params = [{ id: uid(), key: '', value: '', enabled: true }]

    expect(validateRequestParams(request)).toEqual([])
  })

  it('reports whitespace-only query values and whitespace in query names', () => {
    const request = blankRequest()
    request.params = [
      { id: uid(), key: 'user name', value: 'andrea', enabled: true },
      { id: uid(), key: 'status', value: '   ', enabled: true },
    ]

    expect(validateRequestParams(request).map((issue) => issue.kind)).toEqual([
      'query-key-whitespace',
      'query-value-whitespace',
    ])
  })

  it('reports whitespace-only path values and malformed placeholders', () => {
    const request = blankRequest()
    request.url = 'https://api.test/users/{user id}'
    request.pathParams = [{ id: uid(), key: 'id', value: ' ', enabled: true }]

    expect(validateRequestParams(request).map((issue) => issue.kind)).toEqual([
      'path-value-whitespace',
      'path-placeholder-whitespace',
    ])
  })

  it('allows meaningful spaces inside query values', () => {
    const request = blankRequest()
    request.params = [{ id: uid(), key: 'name', value: 'Andrea Rossi', enabled: true }]

    expect(validateRequestParams(request)).toEqual([])
  })
})

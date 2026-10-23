import { describe, expect, it } from 'vitest'
import { exportToOpenApi, parseOpenAPI } from './openapi'
import { exportToSwagger2 } from './swagger2'

const SPEC = `
openapi: 3.0.3
info:
  title: Proto
  version: 1.0.0
paths:
  /__proto__:
    get:
      responses:
        '200':
          description: OK
  /constructor:
    post:
      responses:
        '200':
          description: OK
`

describe('exporting paths named like Object.prototype members', () => {
  const collections = parseOpenAPI(SPEC)

  it('keeps them as plain own keys in the OpenAPI export and never touches the prototype', () => {
    const exported = JSON.parse(exportToOpenApi(collections))
    expect(Object.keys(exported.paths).sort()).toEqual(['/__proto__', '/constructor'])
    expect(Object.keys(exported.paths['/__proto__'])).toEqual(['get'])
    expect(Object.getOwnPropertyNames(Object.prototype).includes('get')).toBe(false)
    expect(Object.getOwnPropertyNames(Object.prototype).includes('post')).toBe(false)
  })

  it('does the same in the Swagger 2 export', () => {
    const exported = JSON.parse(exportToSwagger2(collections))
    expect(Object.keys(exported.paths).sort()).toEqual(['/__proto__', '/constructor'])
    expect(Object.keys(exported.paths['/constructor'])).toEqual(['post'])
    expect(Object.getOwnPropertyNames(Object.prototype).includes('post')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { parseOpenAPI } from './openapi'

describe('OpenAPI import', () => {
  it('imports a standard OpenAPI 3 YAML spec with top-level info, servers, tags, and paths', () => {
    const collections = parseOpenAPI(`
openapi: 3.0.3
info:
  title: Store API
  version: 1.0.0
servers:
  - url: https://api.example.test/v1
tags:
  - name: pets
paths:
  /pets:
    get:
      tags: [pets]
      summary: List pets
      parameters:
        - name: limit
          in: query
          required: false
          schema:
            type: integer
            default: 20
      responses:
        '200':
          description: OK
    post:
      tags:
        - pets
      summary: Create pet
      requestBody:
        content:
          application/json:
            example:
              name: Fido
              kind: dog
      responses:
        '201':
          description: Created
`)

    expect(collections).toHaveLength(1)
    expect(collections[0].name).toBe('pets')
    expect(collections[0].children).toHaveLength(2)
    expect(collections[0].children.map((node) => node.name)).toEqual(['List pets', 'Create pet'])
    expect(collections[0].children[0]).toMatchObject({
      method: 'GET',
      url: 'https://api.example.test/v1/pets',
      _openapiPath: '/pets',
    })
    expect(collections[0].children[1]).toMatchObject({
      method: 'POST',
      url: 'https://api.example.test/v1/pets',
    })
  })

  it('imports specs whose paths are external PathItem refs without failing', () => {
    const collections = parseOpenAPI(`
openapi: 3.1.0
info:
  title: Example API
  version: 1.0.0
servers:
  - url: https://{tenant}/api/v1
    variables:
      tenant:
        default: www
paths:
  '/users/{username}':
    $ref: 'paths/users_{username}.yaml'
  '/user':
    $ref: 'paths/user.yaml'
  /pathItem:
    $ref: paths/pathItem.yaml
`)

    expect(collections).toHaveLength(1)
    expect(collections[0].name).toBe('Example API')
    expect(collections[0].children).toHaveLength(3)
    expect(collections[0].children[0]).toMatchObject({
      method: 'GET',
      name: 'Referenced path: /users/{username}',
      url: 'https://www/api/v1/users/{username}',
      _openapiPath: '/users/{username}',
      description: expect.stringContaining('paths/users_{username}.yaml'),
    })
  })

  it('merges path-level parameters into imported operations', () => {
    const collections = parseOpenAPI(`
openapi: 3.0.3
info:
  title: Parameter API
  version: 1.0.0
paths:
  /users/{username}:
    parameters:
      - name: trace
        in: header
        schema:
          type: string
          default: abc
      - name: username
        in: path
        required: true
        schema:
          type: string
    get:
      summary: Get user
      parameters:
        - name: verbose
          in: query
          schema:
            type: boolean
            default: true
      responses:
        '200':
          description: OK
`)

    const request = collections[0].children[0]
    expect(request).toMatchObject({ name: 'Get user', method: 'GET' })
    expect(request.type).toBe('request')
    if (request.type !== 'request') throw new Error('Expected imported node to be a request')
    expect(request.headers).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'trace', value: 'abc' }),
    ]))
    expect(request.params).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'verbose', value: 'true' }),
    ]))
  })
})

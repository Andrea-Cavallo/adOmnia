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

  it('generates a raw JSON body from Swagger 2 YAML body parameters', () => {
    const collections = parseOpenAPI(`
swagger: '2.0'
info:
  title: Legacy Store API
  version: 1.0.0
host: api.example.test
basePath: /v1
schemes: [https]
paths:
  /pets:
    post:
      summary: Create pet
      consumes:
        - application/json
      parameters:
        - name: pet
          in: body
          required: true
          schema:
            $ref: '#/definitions/Pet'
      responses:
        '201':
          description: Created
definitions:
  Pet:
    type: object
    required: [name]
    properties:
      name:
        type: string
        example: Fido
      age:
        type: integer
        default: 3
`)

    const request = collections[0].children[0]
    if (request.type !== 'request') throw new Error('Expected imported node to be a request')
    expect(request.url).toBe('https://api.example.test/v1/pets')
    expect(request.bodies[0]).toMatchObject({
      type: 'raw',
      lang: 'json',
    })
    expect(JSON.parse(request.bodies[0].raw)).toEqual({ name: 'Fido', age: 3 })
  })

  it('generates form bodies from Swagger 2 YAML formData parameters', () => {
    const collections = parseOpenAPI(`
swagger: '2.0'
info:
  title: Upload API
  version: 1.0.0
paths:
  /avatar:
    post:
      summary: Upload avatar
      consumes:
        - multipart/form-data
      parameters:
        - name: userId
          in: formData
          required: true
          type: string
          default: u_123
        - name: avatar
          in: formData
          required: true
          type: file
      responses:
        '200':
          description: OK
`)

    const request = collections[0].children[0]
    if (request.type !== 'request') throw new Error('Expected imported node to be a request')
    expect(request.bodies[0].type).toBe('formdata')
    expect(request.bodies[0].form).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'userId', value: 'u_123', enabled: true }),
      expect.objectContaining({ key: 'avatar', value: '', enabled: true }),
    ]))
  })

  it('resolves reusable OpenAPI 3 requestBody refs and plural examples', () => {
    const collections = parseOpenAPI(`
openapi: 3.0.3
info:
  title: Orders API
  version: 1.0.0
paths:
  /orders:
    post:
      summary: Create order
      requestBody:
        $ref: '#/components/requestBodies/CreateOrder'
      responses:
        '201':
          description: Created
components:
  requestBodies:
    CreateOrder:
      content:
        application/json:
          examples:
            standard:
              value:
                sku: book-1
                quantity: 2
`)

    const request = collections[0].children[0]
    if (request.type !== 'request') throw new Error('Expected imported node to be a request')
    expect(request.bodies[0]).toMatchObject({
      type: 'raw',
      lang: 'json',
    })
    expect(JSON.parse(request.bodies[0].raw)).toEqual({ sku: 'book-1', quantity: 2 })
  })
})

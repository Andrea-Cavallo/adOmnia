import { describe, expect, it } from 'vitest'
import { parseOpenAPI, exportToOpenApi } from './openapi'
import { openApiToCollection } from './openapiImport'

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

  it('resolves local component parameter $refs into query/header rows', () => {
    const collections = parseOpenAPI(`
openapi: 3.0.3
info:
  title: Ref Params API
  version: 1.0.0
paths:
  /catalogo:
    get:
      summary: List
      parameters:
        - $ref: '#/components/parameters/limit'
      responses:
        '200':
          description: OK
components:
  parameters:
    limit:
      name: limit
      in: query
      required: false
      schema:
        type: integer
        default: 25
`)
    const request = collections[0].children[0]
    if (request.type !== 'request') throw new Error('Expected a request')
    expect(request.params).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'limit', value: '25' }),
    ]))
  })

  it('keeps tag folders nested and recovers the API title on file import', () => {
    const raw = `
openapi: 3.0.0
info:
  title: Marketplace API
  version: 0.0.1
tags:
  - name: catalogo
  - name: stats
paths:
  /catalogo:
    get:
      tags: [catalogo]
      summary: List catalogo
      responses:
        '200':
          description: OK
  /stats:
    get:
      tags: [stats]
      summary: Show stats
      responses:
        '200':
          description: OK
`
    const collection = openApiToCollection(raw)
    expect(collection.name).toBe('Marketplace API')
    expect(collection.children).toHaveLength(2)
    expect(collection.children.every((node) => node.type === 'folder')).toBe(true)
    expect(collection.children.map((node) => node.name)).toEqual(['catalogo', 'stats'])
  })

  it('recovers both operations when a path is declared twice (duplicate YAML key)', () => {
    // Malformed-but-common: same path split into two map entries. Strict YAML
    // throws on the dup key; the lenient pass must merge get + post.
    const collections = parseOpenAPI(`
openapi: 3.0.3
info:
  title: Dup API
  version: 1.0.0
paths:
  /transactions:
    get:
      summary: List transactions
      responses:
        '200':
          description: OK
  /transactions:
    post:
      summary: Create transaction
      responses:
        '201':
          description: Created
`)
    const reqs = collections.flatMap((c) => c.children).filter((n) => n.type === 'request')
    expect(reqs.map((r: any) => r.method).sort()).toEqual(['GET', 'POST'])
  })

  it('imports each named requestBody example as its own body', () => {
    const collections = parseOpenAPI(`
openapi: 3.0.3
info:
  title: Examples API
  version: 1.0.0
paths:
  /pay:
    post:
      summary: Pay
      requestBody:
        content:
          application/json:
            examples:
              creditTransfer:
                summary: Bonifico SEPA
                value:
                  type: CREDIT_TRANSFER
              instantCredit:
                summary: Bonifico Istantaneo
                value:
                  type: INSTANT_CREDIT
      responses:
        '201':
          description: Created
`)
    const req: any = collections.flatMap((c) => c.children).find((n) => n.type === 'request')
    expect(req.bodies.map((b: any) => b.name)).toEqual(['Bonifico SEPA', 'Bonifico Istantaneo'])
    expect(req.bodies[0].raw).toContain('CREDIT_TRANSFER')
    expect(req.bodies[1].raw).toContain('INSTANT_CREDIT')
  })

  it('leniently imports operation-level request headers', () => {
    const collections = parseOpenAPI(`
openapi: 3.0.3
info:
  title: Headers API
  version: 1.0.0
paths:
  /pay:
    post:
      summary: Pay
      headers:
        X-Request-ID:
          required: true
          example: "abc-123"
          schema:
            type: string
        X-Optional:
          required: false
          schema:
            type: string
      responses:
        '201':
          description: Created
`)
    const req: any = collections.flatMap((c) => c.children).find((n) => n.type === 'request')
    const reqId = req.headers.find((h: any) => h.key === 'X-Request-ID')
    expect(reqId).toMatchObject({ value: 'abc-123', enabled: true })
    expect(req.headers.find((h: any) => h.key === 'X-Optional')).toMatchObject({ enabled: false })
  })

  it('preserves response headers and examples, round-tripping them on export', () => {
    const collections = parseOpenAPI(`
openapi: 3.0.3
info:
  title: Resp API
  version: 1.0.0
paths:
  /items:
    get:
      summary: List
      responses:
        '200':
          description: OK list
          headers:
            X-Total-Count:
              description: Total
              schema:
                type: integer
              example: 42
          content:
            application/json:
              examples:
                success:
                  summary: Happy path
                  value:
                    items: [1, 2, 3]
        '404':
          description: Missing
`)
    const req: any = collections.flatMap((c) => c.children).find((n) => n.type === 'request')
    expect(req._openapiResponses.map((r: any) => r.status)).toEqual(['200', '404'])
    const ok = req._openapiResponses[0]
    expect(ok.headers).toMatchObject([{ name: 'X-Total-Count', example: '42' }])
    expect(ok.examples[0]).toMatchObject({ name: 'Happy path' })
    expect(ok.examples[0].raw).toContain('items')

    // Round-trip: export must re-emit the documented responses, not a stub
    const exported = JSON.parse(exportToOpenApi(collections))
    const out = exported.paths['/items'].get.responses
    expect(out['200'].description).toBe('OK list')
    expect(out['200'].headers['X-Total-Count'].example).toBe('42')
    expect(out['200'].content['application/json'].examples['Happy path'].value).toEqual({ items: [1, 2, 3] })
    expect(out['404'].description).toBe('Missing')
  })

  it('preserves multi-scheme / multi-flow security across import and export', () => {
    const collections = parseOpenAPI(`
openapi: 3.0.3
info:
  title: Sec API
  version: 1.0.0
security:
  - OAuth2: [read, write]
  - ApiKeyAuth: []
components:
  securitySchemes:
    OAuth2:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://auth.example.com/token
          scopes:
            read: r
            write: w
            admin: a
        authorizationCode:
          authorizationUrl: https://auth.example.com/authorize
          tokenUrl: https://auth.example.com/token
          scopes:
            read: r
            write: w
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key
paths:
  /secure:
    get:
      summary: Secure
      responses:
        '200':
          description: OK
`)
    const req: any = collections.flatMap((c) => c.children).find((n) => n.type === 'request')
    // active auth records the grant type instead of dropping it
    expect(req.auth.type).toBe('oauth2')
    expect(req.auth.oauth2GrantType).toBe('authorization_code')
    // alternatives preserved: both OAuth2 (with all flows/scopes incl. admin) and ApiKey
    expect(Object.keys(req._openapiSecurity.schemes).sort()).toEqual(['ApiKeyAuth', 'OAuth2'])
    expect((req._openapiSecurity.schemes.OAuth2 as any).flows.clientCredentials.scopes.admin).toBe('a')
    expect(req._openapiSecurity.requirements).toEqual([{ OAuth2: ['read', 'write'] }, { ApiKeyAuth: [] }])

    // Round-trip: both schemes and the requirement list survive export
    const exported = JSON.parse(exportToOpenApi(collections))
    expect(Object.keys(exported.components.securitySchemes).sort()).toEqual(['ApiKeyAuth', 'OAuth2'])
    expect(exported.paths['/secure'].get.security).toEqual([{ OAuth2: ['read', 'write'] }, { ApiKeyAuth: [] }])
  })
})

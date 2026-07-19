import { describe, it, expect } from 'vitest'
import { parseSpecText, buildApiDocModel, resolveSchemaRef, refName } from './parseSpec'

const oas3 = {
  openapi: '3.0.0',
  info: { title: 'Pet API', version: '1.2.0', description: 'Pets' },
  servers: [{ url: 'https://api.pets.dev/v1' }],
  tags: [{ name: 'pets', description: 'Pet ops' }],
  paths: {
    '/pets': {
      get: {
        tags: ['pets'],
        summary: 'List pets',
        parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
      post: {
        tags: ['pets'],
        summary: 'Create pet',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  },
  components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
}

describe('parseSpecText', () => {
  it('parses JSON', () => {
    expect(parseSpecText('{"a":1}')).toEqual({ a: 1 })
  })
  it('falls back to YAML', () => {
    expect(parseSpecText('a: 1\nb: two')).toEqual({ a: 1, b: 'two' })
  })
  it('throws on garbage', () => {
    expect(() => parseSpecText(':::not valid:::\n  - [')).toThrow()
  })
})

describe('buildApiDocModel (OpenAPI 3)', () => {
  const model = buildApiDocModel(oas3)

  it('reads info and servers', () => {
    expect(model.title).toBe('Pet API')
    expect(model.version).toBe('1.2.0')
    expect(model.servers).toEqual(['https://api.pets.dev/v1'])
  })

  it('groups operations by tag with descriptions', () => {
    expect(model.tags).toHaveLength(1)
    expect(model.tags[0].name).toBe('pets')
    expect(model.tags[0].description).toBe('Pet ops')
    expect(model.tags[0].operations.map((o) => o.method).sort()).toEqual(['GET', 'POST'])
    expect(model.operationCount).toBe(2)
  })

  it('captures params, request body, and responses', () => {
    const get = model.tags[0].operations.find((o) => o.method === 'GET')!
    expect(get.parameters[0]).toMatchObject({ name: 'limit', in: 'query', required: false })
    const post = model.tags[0].operations.find((o) => o.method === 'POST')!
    expect(post.requestBody?.required).toBe(true)
    expect(post.requestBody?.contentTypes).toContain('application/json')
    expect(get.responses[0].status).toBe('200')
  })

  it('generates JSON examples from referenced schemas', () => {
    const get = model.tags[0].operations.find((o) => o.method === 'GET')!
    const post = model.tags[0].operations.find((o) => o.method === 'POST')!
    expect(post.requestBody?.example).toEqual({ name: 'string' })
    expect(get.responses[0].example).toEqual({ name: 'string' })
  })

  it('resolves $ref against the registry', () => {
    const resolved = resolveSchemaRef('#/components/schemas/Pet', model.schemaRegistry)
    expect(resolved?.type).toBe('object')
    expect(refName('#/components/schemas/Pet')).toBe('Pet')
  })
})

describe('buildApiDocModel (Swagger 2.0)', () => {
  const swagger2 = {
    swagger: '2.0',
    info: { title: 'Legacy', version: '1.0' },
    host: 'legacy.example.com',
    basePath: '/api',
    schemes: ['https'],
    paths: {
      '/users': {
        post: {
          tags: ['users'],
          parameters: [{ name: 'body', in: 'body', required: true, schema: { $ref: '#/definitions/User' } }],
          responses: { '200': { description: 'ok', schema: { $ref: '#/definitions/User' } } },
        },
      },
    },
    definitions: { User: { type: 'object', properties: { id: { type: 'string' } } } },
  }
  const model = buildApiDocModel(swagger2)

  it('derives server from host/basePath/schemes', () => {
    expect(model.servers).toEqual(['https://legacy.example.com/api'])
  })

  it('maps a body parameter to a request body', () => {
    const post = model.tags[0].operations[0]
    expect(post.requestBody?.required).toBe(true)
    expect(post.parameters.find((p) => p.name === 'body')).toBeUndefined()
  })
})

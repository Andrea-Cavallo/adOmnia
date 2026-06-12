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
})

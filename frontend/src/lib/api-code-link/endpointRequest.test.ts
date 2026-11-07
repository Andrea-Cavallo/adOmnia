import { describe, expect, it } from 'vitest'
import type { DevEntity } from '@/lib/devcontext-api'
import { endpointRequestShape, pathParamsFromPattern, requestForEndpoint } from './endpointRequest'

const route = (attrs: Record<string, string>): Pick<DevEntity, 'attrs' | 'label'> => ({ label: 'POST /orders/{id}', attrs: { method: 'POST', path: '/orders/{id}', ...attrs } })

describe('request generated from an endpoint', () => {
  it('fills path, query, header and cookie values from the handler', () => {
    const request = requestForEndpoint(route({
      declName: 'OrderController.update',
      requestParams: JSON.stringify([
        { name: 'id', in: 'path', type: 'long', required: true },
        { name: 'dryRun', in: 'query', type: 'boolean', default: 'false' },
        { name: 'X-Token', in: 'header', type: 'String' },
        { name: 'session', in: 'cookie', type: 'String' },
      ]),
    }))
    expect(request.method).toBe('POST')
    expect(request.name).toBe('OrderController.update')
    expect(request.url).toBe('{{baseUrl}}/orders/{{id}}')
    expect(request.pathParams?.map((row) => [row.key, row.value])).toEqual([['id', '']])
    expect(request.params.filter((row) => row.key).map((row) => [row.key, row.value])).toEqual([['dryRun', 'false']])
    expect(request.headers.filter((row) => row.key).map((row) => row.key)).toEqual(['X-Token'])
    expect(request.cookies?.filter((row) => row.key).map((row) => row.key)).toEqual(['session'])
  })

  it('builds a JSON body from the handler DTO', () => {
    const request = requestForEndpoint(route({
      requestBodyType: 'CreateOrder',
      requestBody: '{"customer":"","urgent":false}',
      requestContentType: 'application/json',
    }))
    expect(request.bodies[0].type).toBe('raw')
    expect(request.bodies[0].lang).toBe('json')
    expect(request.bodies[0].raw).toBe('{"customer":"","urgent":false}')
    expect(request.activeBodyIdx).toBe(0)
    expect(request.headers.filter((row) => row.key).map((row) => [row.key, row.value])).toEqual([['Content-Type', 'application/json']])
  })

  it('uses XML when the endpoint consumes XML', () => {
    const request = requestForEndpoint(route({ requestBody: '<order/>', requestContentType: 'application/xml' }))
    expect(request.bodies[0].lang).toBe('xml')
  })

  it('builds a urlencoded body from form parameters', () => {
    const request = requestForEndpoint(route({
      requestParams: JSON.stringify([{ name: 'name', in: 'form' }, { name: 'quantity', in: 'form', default: '1' }]),
    }))
    expect(request.bodies[0].type).toBe('urlencoded')
    expect(request.bodies[0].form.filter((row) => row.key).map((row) => [row.key, row.value])).toEqual([['name', ''], ['quantity', '1']])
  })

  it('falls back to the path template when the handler declares no parameters', () => {
    expect(pathParamsFromPattern('/files/{path...}/x/{id}').map((param) => param.name)).toEqual(['path', 'id'])
    const shape = endpointRequestShape({ attrs: { method: 'GET', path: '/files/{path...}' } })
    expect(shape.params).toEqual([])
    expect(requestForEndpoint({ attrs: { method: 'GET', path: '/files/{path...}' }, label: 'GET /files/{path...}' }).pathParams?.map((row) => row.key)).toEqual(['path'])
  })

  it('ignores malformed request attributes instead of throwing', () => {
    expect(endpointRequestShape({ attrs: { requestParams: '{not json' } }).params).toEqual([])
    expect(endpointRequestShape({ attrs: { requestParams: JSON.stringify([{ name: 'x', in: 'body' }]) } }).params).toEqual([])
  })
})

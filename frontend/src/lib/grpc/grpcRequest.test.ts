import { describe, expect, it } from 'vitest'
import { blankAuth, blankKVRow, type KVRow } from '@/lib/types'
import { blankGrpcRequest, callMetadata, descriptorSource, grpcCallBody, grpcMessage, grpcSettings, grpcStatusName, parseGrpcAddress, parseMessages, responseFromCall } from './grpcRequest'
import { legacyGrpcRequests, protoImportRoot } from './openGrpcTab'
import { rpcKind, sampleRequest, type GrpcDescriptors } from './grpcSchema'

const row = (key: string, value: string, enabled = true): KVRow => ({ ...blankKVRow(), key, value, enabled })

function callRequest() {
  const request = blankGrpcRequest('Say', '{{host}}')
  return { ...request, bodies: [grpcMessage('m', '{"name":"{{who}}"}')], grpc: { ...request.grpc!, service: 'demo.v1.Echo', method: 'Say' } }
}

describe('gRPC request', () => {
  it('reads addresses with or without a scheme', () => {
    expect(parseGrpcAddress('localhost:50051')).toEqual({ address: 'localhost:50051' })
    expect(parseGrpcAddress('grpcs://api.example.com')).toEqual({ address: 'api.example.com:443', tls: true })
    expect(parseGrpcAddress('grpc://svc:9090/')).toEqual({ address: 'svc:9090', tls: false })
  })

  it('turns headers and auth into lower-case metadata with variables', () => {
    const request = { ...callRequest(), headers: [row('X-Tenant', '{{tenant}}'), row('X-Off', '1', false)], auth: { ...blankAuth(), type: 'bearer' as const, token: '{{token}}' } }
    expect(callMetadata(request, { tenant: 'acme', token: 't' })).toEqual({ 'x-tenant': 'acme', authorization: 'Bearer t' })
    const apiKey = { ...callRequest(), auth: { ...blankAuth(), type: 'apikey' as const, username: 'X-Key', token: 's' } }
    expect(callMetadata(apiKey, {})).toEqual({ 'x-key': 's' })
  })

  it('builds the call body, with descriptors and messages', () => {
    const request = { ...callRequest(), grpc: { ...callRequest().grpc, source: 'proto' as const, protoFiles: ['/p/echo.proto'], importPaths: ['/p'], tls: true } }
    const body = grpcCallBody(request, { host: 'localhost:50051', who: 'Ada' })
    expect(body).toMatchObject({ address: 'localhost:50051', tls: true, service: 'demo.v1.Echo', method: 'Say', payload: { name: 'Ada' }, descriptors: { kind: 'proto', proto_paths: ['/p/echo.proto'], import_paths: ['/p'] } })
    expect(() => grpcCallBody({ ...request, url: '' }, {})).toThrow('host:port')
    expect(() => grpcCallBody({ ...request, grpc: { ...request.grpc, method: '' } }, { host: 'h:1' })).toThrow('Pick')
    expect(descriptorSource(grpcSettings(callRequest()))).toEqual({ kind: 'reflection' })
  })

  it('reads one message, an array (client stream) or JSON lines', () => {
    expect(parseMessages('{"a":1}')).toEqual([{ a: 1 }])
    expect(parseMessages('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }])
    expect(parseMessages('{"a":1}\n{"a":2}')).toEqual([{ a: 1 }, { a: 2 }])
    expect(parseMessages('')).toEqual([{}])
    expect(() => parseMessages('{nope')).toThrow('not valid JSON')
  })

  it('maps a call to a response that Flows and assertions read like HTTP', () => {
    const ok = responseFromCall({ status: 'OK', response: { text: 'hi' }, time_ms: 12, response_metadata: { 'x-a': '1' }, response_trailers: { 'x-t': '2' } })
    expect(ok).toMatchObject({ status: 200, statusText: 'OK', ms: 12, headers: { 'grpc-status': 'OK', 'x-a': '1', 'trailer: x-t': '2' } })
    expect(JSON.parse(ok.body)).toEqual({ text: 'hi' })
    const missing = responseFromCall({ status: 'NotFound', error: 'no user' })
    expect(missing).toMatchObject({ status: 404, statusText: 'NOT_FOUND', headers: { 'grpc-message': 'no user' } })
    expect(JSON.parse(missing.body)).toEqual({ code: 'NOT_FOUND', message: 'no user' })
    expect(JSON.parse(responseFromCall({ status: 'OK', messages: [{ n: 1 }, { n: 2 }] }).body)).toEqual([{ n: 1 }, { n: 2 }])
    expect(grpcStatusName('DeadlineExceeded')).toBe('DEADLINE_EXCEEDED')
  })
})

describe('gRPC entry points', () => {
  it('finds the import root from the package', () => {
    expect(protoImportRoot('/w/api/proto/demo/v1/echo.proto', 'syntax = "proto3";\npackage demo.v1;')).toBe('/w/api/proto')
    expect(protoImportRoot('C:\\w\\proto\\demo\\echo.proto', 'package demo;')).toBe('C:\\w\\proto')
    expect(protoImportRoot('/w/other/echo.proto', 'package demo.v1;')).toBe('')
  })

  it('migrates the old panel connections once', () => {
    const store = new Map([['adomnia.grpc.connections', JSON.stringify([{ name: 'Prod', address: 'api:443', useTls: true, caCertPath: '/ca.pem' }, { name: 'empty' }])]])
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
    const migrated = legacyGrpcRequests(storage)
    expect(migrated).toHaveLength(1)
    expect(migrated[0]).toMatchObject({ method: 'GRPC', name: 'Prod', url: 'api:443', grpc: { tls: true, caCertPath: '/ca.pem' } })
    expect(legacyGrpcRequests(storage)).toEqual([])
  })
})

describe('gRPC schema', () => {
  const descriptors: GrpcDescriptors = {
    services: [{ name: 'demo.v1.Echo', methods: [{ name: 'Chat', input_type: 'demo.v1.Req', output_type: 'demo.v1.Res', client_streaming: true, server_streaming: true }] }],
    schemas: {
      'demo.v1.Req': [
        { name: 'name', type: 'string', kind: 'string', number: 1, repeated: false },
        { name: 'tip', type: 'demo.v1.Money', message_type: 'demo.v1.Money', number: 2, repeated: false },
        { name: 'tags', type: 'string', number: 3, repeated: true },
        { name: 'level', type: 'enum', number: 4, repeated: false, enum_values: [{ name: 'LOW', number: 0 }] },
      ],
      'demo.v1.Money': [{ name: 'units', type: 'int64', kind: 'int64', number: 1, repeated: false }],
    },
  }
  it('builds an example request, an array for a client stream', () => {
    const method = descriptors.services[0].methods[0]
    expect(rpcKind(method)).toBe('bidi')
    expect(JSON.parse(sampleRequest(descriptors, method))).toEqual([{ name: '', tip: { units: 0 }, tags: [], level: 'LOW' }])
  })
})

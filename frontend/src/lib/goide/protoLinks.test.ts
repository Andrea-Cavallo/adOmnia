import { describe, expect, it } from 'vitest'
import type { GoIDEArchitecture } from '@/lib/goide-api'
import { goHandlerFor, protoRpcs } from './protoLinks'

const PROTO = `syntax = "proto3";
// service Fake { rpc Nope(A) returns (B); }
service Orders {
  // Get returns one order.
  rpc Get(GetRequest) returns (Order);
  rpc Watch(GetRequest) returns (stream Order) {
    option deprecated = true;
  }
  rpc Upload(stream Chunk) returns (google.protobuf.Empty);
}
message Order { int64 id = 1; }
service Health { rpc Check(Ping) returns (Pong); }
`

describe('protoRpcs', () => {
  it('finds rpcs with service, streaming and line', () => {
    expect(protoRpcs(PROTO)).toEqual([
      { service: 'Orders', method: 'Get', line: 5, input: 'GetRequest', output: 'Order', clientStreaming: false, serverStreaming: false },
      { service: 'Orders', method: 'Watch', line: 6, input: 'GetRequest', output: 'Order', clientStreaming: false, serverStreaming: true },
      { service: 'Orders', method: 'Upload', line: 9, input: 'Chunk', output: 'google.protobuf.Empty', clientStreaming: true, serverStreaming: false },
      { service: 'Health', method: 'Check', line: 12, input: 'Ping', output: 'Pong', clientStreaming: false, serverStreaming: false },
    ])
  })
})

describe('goHandlerFor', () => {
  const site = (relativePath: string, line: number) => ({ relativePath, line, column: 1 })
  const report = {
    entries: [
      { kind: 'grpc', name: 'Orders', detail: '*server', package: 'example.com/svc/cmd', site: site('cmd/main.go', 20) },
      { kind: 'grpc', name: 'Health', detail: '*grpcapi.Health', package: 'example.com/svc/cmd', site: site('cmd/main.go', 21) },
    ],
    functions: [
      { id: 'a', name: 'server.Get', package: 'example.com/svc/other', site: site('other/x.go', 3) },
      { id: 'b', name: 'server.Get', package: 'example.com/svc/cmd', site: site('cmd/server.go', 12) },
      { id: 'c', name: 'Health.Check', package: 'example.com/svc/grpcapi', site: site('grpcapi/health.go', 8) },
    ],
  } as unknown as GoIDEArchitecture

  it('prefers the registering package, or the qualified one', () => {
    expect(goHandlerFor(report, 'Orders', 'Get')?.site.relativePath).toBe('cmd/server.go')
    expect(goHandlerFor(report, 'Health', 'Check')?.site.relativePath).toBe('grpcapi/health.go')
  })

  it('returns null when the service or method is not served in Go', () => {
    expect(goHandlerFor(report, 'Orders', 'Watch')).toBeNull()
    expect(goHandlerFor(report, 'Billing', 'Get')).toBeNull()
  })
})

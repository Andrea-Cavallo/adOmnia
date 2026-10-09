import { describe, expect, it } from 'vitest'
import type { GoIDEArchitecture } from '@/lib/goide-api'
import { ancestorDirs, findProtoType, goHandlerFor, importCandidates, protoDeclarations, protoImports, protoRpcs, protocArguments } from './protoLinks'

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

describe('proto navigation helpers', () => {
  const text = `syntax = "proto3";
import "common/money.proto";
import public "types.proto";
message Order {
  message Line { string sku = 1; }
  enum State { NEW = 0; }
  Money total = 1;
}
service Orders {
  rpc Get(GetRequest) returns (Order);
}
`
  it('lists declarations with nesting and name columns', () => {
    expect(protoDeclarations(text).map((d) => `${d.kind}:${d.name}@${d.line}:${d.column}${d.parent ? `<${d.parent}` : ''}`)).toEqual([
      'message:Order@4:9', 'message:Line@5:11<Order', 'enum:State@6:8<Order', 'service:Orders@9:9', 'rpc:Get@10:7<Orders',
    ])
  })

  it('reads imports and resolves types by their last segment', () => {
    expect(protoImports(text)).toEqual(['common/money.proto', 'types.proto'])
    expect(findProtoType(protoDeclarations(text), 'shop.v1.Order')?.line).toBe(4)
    expect(findProtoType(protoDeclarations(text), 'Get')).toBeUndefined()
    expect(importCandidates('api/v1/orders.proto', 'common/money.proto')).toEqual(['common/money.proto', 'api/v1/common/money.proto'])
  })
})

describe('proto generation helpers', () => {
  it('builds protoc arguments with explicit plugins', () => {
    expect(protocArguments('api/orders.proto', { go: 'C:/bin/protoc-gen-go.exe', grpc: 'C:/bin/protoc-gen-go-grpc.exe' })).toEqual([
      '-I', '.', '--plugin=protoc-gen-go=C:/bin/protoc-gen-go.exe', '--go_out=.', '--go_opt=paths=source_relative',
      '--plugin=protoc-gen-go-grpc=C:/bin/protoc-gen-go-grpc.exe', '--go-grpc_out=.', '--go-grpc_opt=paths=source_relative', 'api/orders.proto',
    ])
    expect(protocArguments('m.proto', { go: 'g' })).not.toContain('--go-grpc_out=.')
  })

  it('walks up to the project root', () => {
    expect(ancestorDirs('svc/api/v1/orders.proto')).toEqual(['svc/api/v1', 'svc/api', 'svc', ''])
    expect(ancestorDirs('orders.proto')).toEqual([''])
  })
})

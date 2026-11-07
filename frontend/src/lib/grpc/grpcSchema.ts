/** Services and message schemas of a gRPC API, as the sidecar describes them (reflection, .proto, protoset). */

export interface GrpcMethodInfo {
  name: string
  input_type: string
  output_type: string
  client_streaming: boolean
  server_streaming: boolean
}

export interface GrpcServiceInfo {
  name: string
  methods: GrpcMethodInfo[]
}

export interface GrpcEnumValue {
  name: string
  number: number
}

export interface GrpcFieldInfo {
  name: string
  proto_name?: string
  type: string
  kind?: string
  number: number
  repeated: boolean
  map?: boolean
  required?: boolean
  optional?: boolean
  oneof?: boolean
  oneof_name?: string
  oneof_fields?: GrpcFieldInfo[]
  message_type?: string
  enum_type?: string
  enum_values?: GrpcEnumValue[]
  key_type?: string
  value_type?: string
  default_value?: unknown
  description?: string
}

export interface GrpcDescriptors {
  services: GrpcServiceInfo[]
  schemas?: Record<string, GrpcFieldInfo[]>
  enums?: Record<string, GrpcEnumValue[]>
  files?: string[]
}

export type GrpcRpcKind = 'unary' | 'server' | 'client' | 'bidi'

export function rpcKind(method?: Pick<GrpcMethodInfo, 'client_streaming' | 'server_streaming'>): GrpcRpcKind {
  if (!method) return 'unary'
  if (method.client_streaming && method.server_streaming) return 'bidi'
  if (method.client_streaming) return 'client'
  return method.server_streaming ? 'server' : 'unary'
}

export const RPC_KIND_LABEL: Record<GrpcRpcKind, string> = {
  unary: 'Unary',
  server: 'Server stream',
  client: 'Client stream',
  bidi: 'Bidi stream',
}

export function findMethod(descriptors: GrpcDescriptors | null | undefined, service: string, method: string): GrpcMethodInfo | undefined {
  return descriptors?.services.find((item) => item.name === service)?.methods.find((item) => item.name === method)
}

/** The short name of a service in a picker: the package stays in the group label. */
export function serviceShortName(service: string): string {
  return service.split('.').pop() ?? service
}

const SAMPLE_DEPTH = 3

function sampleValue(field: GrpcFieldInfo, schemas: Record<string, GrpcFieldInfo[]>, depth: number): unknown {
  const type = field.type.toLowerCase()
  const kind = (field.kind ?? '').toLowerCase()
  if (field.map) return {}
  if (field.repeated) return []
  if (field.enum_values?.length) return field.enum_values[0].name
  if (kind === 'bool' || type.includes('bool')) return false
  if (/int|float|double|fixed/.test(kind) || /int|float|double|fixed/.test(type)) return 0
  if (type.includes('google.protobuf.timestamp')) return new Date(0).toISOString()
  if (field.message_type && schemas[field.message_type] && depth < SAMPLE_DEPTH) return sampleMessage(schemas[field.message_type], schemas, depth + 1)
  if (field.message_type) return {}
  return ''
}

/** A request with every field filled with a typed placeholder: a starting point, not a valid request. */
export function sampleMessage(fields: GrpcFieldInfo[], schemas: Record<string, GrpcFieldInfo[]> = {}, depth = 0): Record<string, unknown> {
  const sample: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.oneof) {
      const first = field.oneof_fields?.[0]
      if (first) sample[first.name] = sampleValue(first, schemas, depth)
      continue
    }
    sample[field.name] = sampleValue(field, schemas, depth)
  }
  return sample
}

/** The sample request of a method, pretty-printed; a client stream gets an array with one message. */
export function sampleRequest(descriptors: GrpcDescriptors | null | undefined, method: GrpcMethodInfo | undefined): string {
  if (!method) return '{}'
  const schemas = descriptors?.schemas ?? {}
  const message = sampleMessage(schemas[method.input_type] ?? [], schemas)
  return JSON.stringify(method.client_streaming ? [message] : message, null, 2)
}

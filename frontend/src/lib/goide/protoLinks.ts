// .proto ↔ Go: the rpc declarations of a .proto text and the Go method that serves each one,
// resolved from the architecture analysis (RegisterXServer + the server type's methods).
import type { GoIDEArchitecture } from '@/lib/goide-api'

export interface ProtoRpc {
  service: string
  method: string
  /** 1-based line of the `rpc` keyword. */
  line: number
  input: string
  output: string
  clientStreaming: boolean
  serverStreaming: boolean
}

type ArchFunction = GoIDEArchitecture['functions'][number]

const SERVICE = /^\s*service\s+([A-Za-z_]\w*)\s*\{/
const RPC = /\brpc\s+([A-Za-z_]\w*)\s*\(\s*(stream\s+)?([\w.]+)\s*\)\s*returns\s*\(\s*(stream\s+)?([\w.]+)\s*\)/g

/** rpc declarations with their service; comments are ignored, one rpc per line (protoc style). */
export function protoRpcs(text: string): ProtoRpc[] {
  const out: ProtoRpc[] = []
  let service = ''
  let depth = 0
  let serviceDepth = -1
  text.split('\n').forEach((raw, index) => {
    const line = raw.replace(/\/\/.*$/, '')
    const declared = SERVICE.exec(line)
    if (declared) {
      service = declared[1]
      serviceDepth = depth
    }
    for (const rpc of service ? line.matchAll(RPC) : []) {
      out.push({ service, method: rpc[1], line: index + 1, input: rpc[3], output: rpc[5], clientStreaming: !!rpc[2], serverStreaming: !!rpc[4] })
    }
    for (const ch of line) {
      if (ch === '{') depth++
      if (ch === '}') {
        depth--
        if (depth === serviceDepth) { service = ''; serviceDepth = -1 }
      }
    }
  })
  return out
}

/** The Go method implementing service/method: the type passed to RegisterXServer, method of that name. */
export function goHandlerFor(report: GoIDEArchitecture, service: string, method: string): ArchFunction | null {
  const registrations = report.entries.filter((entry) => entry.kind === 'grpc' && entry.name === service)
  for (const entry of registrations) {
    const type = (entry.detail ?? '').replace(/^[*&]/, '')
    const [qualifier, typeName] = type.includes('.') ? type.split('.', 2) : ['', type]
    const candidates = report.functions.filter((fn) => fn.name === `${typeName}.${method}`)
    const match = candidates.find((fn) => (qualifier ? fn.package.endsWith(`/${qualifier}`) || fn.package === qualifier : fn.package === entry.package)) ?? candidates[0]
    if (match) return match
  }
  return null
}

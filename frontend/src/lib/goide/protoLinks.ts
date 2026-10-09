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

export interface ProtoDeclaration {
  name: string
  kind: 'message' | 'enum' | 'service' | 'rpc'
  line: number
  column: number
  /** Enclosing declaration for nested messages/enums and rpcs. */
  parent?: string
}

const DECLARATION = /\b(message|enum|service|rpc)\s+([A-Za-z_]\w*)/g

/** Top-level and nested declarations, with 1-based line/column of the name. */
export function protoDeclarations(text: string): ProtoDeclaration[] {
  const out: ProtoDeclaration[] = []
  const stack: Array<{ name: string; depth: number }> = []
  let depth = 0
  text.split('\n').forEach((raw, index) => {
    const line = raw.replace(/\/\/.*$/, '')
    for (const match of line.matchAll(DECLARATION)) {
      const column = (match.index ?? 0) + match[0].length - match[2].length + 1
      out.push({ name: match[2], kind: match[1] as ProtoDeclaration['kind'], line: index + 1, column, parent: stack[stack.length - 1]?.name })
      if (match[1] !== 'rpc') stack.push({ name: match[2], depth })
    }
    for (const ch of line) {
      if (ch === '{') depth++
      if (ch === '}') {
        depth--
        while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
      }
    }
  })
  return out
}

/** Paths of `import "…";` statements. */
export function protoImports(text: string): string[] {
  return [...text.matchAll(/^\s*import\s+(?:public\s+|weak\s+)?"([^"]+)"\s*;/gm)].map((m) => m[1])
}

/** The type declaration a (possibly qualified) name refers to, by its last segment. */
export function findProtoType(declarations: ProtoDeclaration[], name: string): ProtoDeclaration | undefined {
  const last = name.split('.').pop() ?? name
  return declarations.find((item) => (item.kind === 'message' || item.kind === 'enum' || item.kind === 'service') && item.name === last)
}

/** Candidate project-relative paths for an import: relative to the project root and to the importing file. */
export function importCandidates(fromRelativePath: string, importPath: string): string[] {
  const dir = fromRelativePath.includes('/') ? fromRelativePath.slice(0, fromRelativePath.lastIndexOf('/')) : ''
  const joined = dir ? `${dir}/${importPath}` : importPath
  return [...new Set([importPath, joined])]
}

/** protoc arguments for Go (and gRPC when the file declares a service), output next to the .proto. */
export function protocArguments(protoPath: string, plugins: { go: string; grpc?: string }): string[] {
  const args = ['-I', '.', `--plugin=protoc-gen-go=${plugins.go}`, '--go_out=.', '--go_opt=paths=source_relative']
  if (plugins.grpc) args.push(`--plugin=protoc-gen-go-grpc=${plugins.grpc}`, '--go-grpc_out=.', '--go-grpc_opt=paths=source_relative')
  return [...args, protoPath]
}

/** Directories from the file's folder up to the project root ('' = root). */
export function ancestorDirs(relativePath: string): string[] {
  const parts = relativePath.split('/').slice(0, -1)
  const dirs: string[] = []
  for (let i = parts.length; i >= 0; i--) dirs.push(parts.slice(0, i).join('/'))
  return dirs
}

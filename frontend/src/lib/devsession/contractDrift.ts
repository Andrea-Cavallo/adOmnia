import { parse } from 'yaml'
import { readDevContextFile, type DevSnapshot } from '@/lib/devcontext-api'

/** OpenAPI 3 / Swagger 2 operations as `METHOD /path` with params normalised to `{}`. */
export function contractOperations(text: string): Set<string> {
  const operations = new Set<string>()
  type OpenApiDocument = { paths?: Record<string, Record<string, unknown>> } | null
  let document: OpenApiDocument = null
  try {
    document = parse(text) as OpenApiDocument
  } catch {
    return operations
  }
  for (const [path, item] of Object.entries(document?.paths ?? {})) {
    for (const method of Object.keys(item ?? {})) {
      if (['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace', 'query'].includes(method)) {
        operations.add(`${method.toUpperCase()} ${normalise(path)}`)
      }
    }
  }
  return operations
}

const normalise = (path: string) => path.replace(/\{[^}]+\}/g, '{}').replace(/\/+$/, '') || '/'

/** Whether an operation of the code is documented; ANY routes match any documented method. */
export function documented(operations: Set<string>, method: string, path: string): boolean {
  const target = normalise(path)
  if (method.toUpperCase() !== 'ANY') return operations.has(`${method.toUpperCase()} ${target}`)
  return [...operations].some((operation) => operation.endsWith(` ${target}`))
}

const cache = new Map<string, Promise<{ file: string; operations: Set<string> } | null>>()

/** The first OpenAPI contract of a gO project, parsed once per snapshot version. */
export function projectContract(snapshot: DevSnapshot): Promise<{ file: string; operations: Set<string> } | null> {
  const contract = (snapshot.entities ?? []).find((entity) => entity.kind === 'contract' && entity.attrs.type === 'oas')
  if (!contract) return Promise.resolve(null)
  const key = `${snapshot.sessionId}:${snapshot.version}:${contract.attrs.path}`
  if (!cache.has(key)) {
    cache.set(key, readDevContextFile(snapshot.sessionId, contract.attrs.path ?? contract.label)
      .then((text) => ({ file: contract.attrs.path ?? contract.label, operations: contractOperations(text) }))
      .catch(() => null))
  }
  return cache.get(key)!
}

import type { RequestItem, ResponseData } from './types'
import type { FlowVariableMapping } from './flowStorage'

export interface RecordingSource {
  seq: number
  body: unknown
}

/** Response bodies live only in the recording session, never in saved definitions. */
export function recordingSource(seq: number, response: ResponseData): RecordingSource {
  let body: unknown
  try { body = JSON.parse(response.body) } catch { /* Non-JSON responses have no inferred fields. */ }
  return { seq, body }
}

/** Exact JSON values only: no substring guesses and no replacement of existing variables. */
export function linkRecordedRequest(request: RequestItem, sources: RecordingSource[], vars: Record<string, string> = {}) {
  const extractions = new Map<number, FlowVariableMapping[]>()
  const candidates: Array<{ seq: number; path: string; value: unknown }> = []
  const visit = (value: unknown, path: string, seq: number) => {
    if (value === null || value === undefined || typeof value === 'boolean' || value === '') return
    candidates.push({ seq, path, value })
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        visit(child, Array.isArray(value) ? `${path}[${key}]` : `${path}[${JSON.stringify(key)}]`, seq)
      }
    }
  }
  for (const source of [...sources].reverse()) visit(source.body, '$', source.seq)

  const findReference = (value: unknown): string | undefined => {
    const variable = typeof value === 'string' ? value.match(/^{{\s*([^}]+?)\s*}}$/)?.[1] : undefined
    const comparable = variable ? vars[variable] : value
    if (typeof comparable === 'string' && /{{|^(vault|secret):/.test(comparable)) return
    if (variable && comparable === undefined) return
    const serialized = JSON.stringify(comparable)
    const matches = candidates.filter(candidate => JSON.stringify(candidate.value) === serialized || (typeof comparable === 'string' && typeof candidate.value === 'number' && String(candidate.value) === comparable))
    if (!matches.length) return
    // Repeated responses use the latest producer; ambiguous fields in that
    // response are left literal so the user can map them explicitly.
    const latest = matches.filter(candidate => candidate.seq === matches[0].seq)
    if (latest.length !== 1) return
    const match = latest[0]
    const pathName = (path: string) => path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'body'
    const baseName = pathName(match.path)
    const collides = candidates.some(candidate => candidate.seq === match.seq && candidate.path !== match.path && pathName(candidate.path) === baseName)
    const suffix = collides ? `_${Array.from(match.path).map(char => char.charCodeAt(0).toString(16)).join('')}` : ''
    const name = variable ?? `step${match.seq}_${baseName}${suffix}`
    const mappings = extractions.get(match.seq) ?? []
    if (!mappings.some(mapping => mapping.name === name)) mappings.push({ id: name, name, source: 'body', path: match.path })
    extractions.set(match.seq, mappings)
    return `{{${name}}}`
  }
  const text = (value: string) => findReference(value) ?? value
  const json = (value: unknown): string => {
    const ref = findReference(value)
    if (ref) return typeof value === 'string' ? JSON.stringify(ref) : ref
    if (Array.isArray(value)) return `[${value.map(json).join(',')}]`
    if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, child]) => `${JSON.stringify(key)}:${json(child)}`).join(',')}}`
    return JSON.stringify(value)
  }
  const raw = (value: string) => {
    try { return json(JSON.parse(value)) } catch { return text(value) }
  }
  const rows = <T extends { value: string }>(values: T[] | undefined) => values?.map(row => ({ ...row, value: text(row.value) }))
  const linked: RequestItem = {
    ...request,
    url: request.url.replace(/[^/?&#=]+/g, part => text(part)),
    params: rows(request.params) ?? [],
    pathParams: rows(request.pathParams),
    headers: request.headers.map(row => ({ ...row, value: /^Bearer /i.test(row.value) ? `Bearer ${text(row.value.slice(7))}` : text(row.value) })),
    cookies: rows(request.cookies),
    auth: Object.fromEntries(Object.entries(request.auth).map(([key, value]) => [key, key !== 'type' && typeof value === 'string' ? text(value) : value])) as unknown as RequestItem['auth'],
    bodies: (request.bodies ?? []).map(body => ({ ...body, raw: raw(body.raw ?? ''), form: rows(body.form) ?? [], graphqlVariables: body.graphqlVariables ? raw(body.graphqlVariables) : undefined })),
  }
  return { request: linked, extractions }
}

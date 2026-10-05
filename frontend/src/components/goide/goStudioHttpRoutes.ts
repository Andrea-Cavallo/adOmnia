import { generateCode } from '@/lib/codegen'
import { requestWithUrlInput } from '@/lib/requestUrl'
import { blankRequest, type HttpMethod, type RequestItem } from '@/lib/types'

/** Route HTTP registrata nel codice Go: riga 1-based, metodo (GET se il router accetta qualsiasi metodo) e path. */
export interface GoStudioHttpRoute {
  line: number
  method: HttpMethod
  path: string
  /** true se il router accetta qualsiasi metodo (net/http senza metodo nel pattern). */
  anyMethod: boolean
}

export const DEFAULT_GO_BASE_URL = 'http://localhost:8080'
/** Variabile d'ambiente che, se presente, sostituisce l'indirizzo ricavato dal codice. */
const BASE_URL_VARIABLE = 'baseUrl'

const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const METHOD_NAMES = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Get|Post|Put|Patch|Delete|Head|Options'
const STRING = '(?:"([^"\\n]*)"|`([^`\\n]*)`)'

/** gin, echo, fiber, chi: receiver.GET("/path", …) oppure receiver.Get("/path", …). */
const METHOD_CALL = new RegExp(`(\\w+)\\.(${METHOD_NAMES})\\(\\s*${STRING}`)
/** net/http, gorilla/mux, chi: receiver.HandleFunc("GET /path", …) / receiver.Handle("/path", …). */
const HANDLE_CALL = new RegExp(`(\\w+)\\.(?:HandleFunc|Handle)\\(\\s*${STRING}`)
/** gorilla/mux: .Methods("POST") sulla stessa riga. */
const MUX_METHODS = /\.Methods\(\s*"([A-Za-z]+)"/
/** gin, echo, fiber: api := r.Group("/api"). */
const GROUP_DECLARATION = new RegExp(`(\\w+)\\s*:?=\\s*(\\w+)\\.Group\\(\\s*${STRING}`)
/** Indirizzo del server nello stesso file: ListenAndServe(":8080"), r.Run(":8080"), Addr: ":8080". */
const LISTEN_ADDRESS = new RegExp(`(ListenAndServeTLS|ListenAndServe|RunTLS|StartTLS|\\.Run|\\.Start|\\.Listen)\\(\\s*${STRING}|Addr:\\s*${STRING}`)

function stringLiteral(match: RegExpExecArray, first: number): string {
  return match[first] ?? match[first + 1] ?? ''
}

function isComment(line: string): boolean {
  const trimmed = line.trimStart()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

function joinPath(prefix: string, path: string): string {
  if (!prefix) return path
  return `${prefix.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`.replace(/\/$/, '') || '/'
}

/** Pattern di net/http (Go 1.22+): "[METHOD ][host]/path" con {name...} e {$}. */
function parseServeMuxPattern(pattern: string): { method: HttpMethod | null; path: string } | null {
  const trimmed = pattern.trim()
  const space = trimmed.indexOf(' ')
  const method = space > 0 ? trimmed.slice(0, space).toUpperCase() : ''
  const rest = space > 0 ? trimmed.slice(space + 1).trim() : trimmed
  const slash = rest.indexOf('/')
  if (slash < 0) return null
  const path = rest.slice(slash).replace(/\{\$\}/g, '').replace(/\{(\w+)\.\.\.\}/g, '{$1}')
  if (!method) return { method: null, path }
  return HTTP_METHODS.includes(method as HttpMethod) ? { method: method as HttpMethod, path } : null
}

/**
 * Route registrate nel file: net/http (anche con metodo nel pattern), gorilla/mux, gin, echo, fiber e chi.
 * I prefissi dei gruppi sono risolti solo se dichiarati nello stesso file; i router montati altrove no.
 */
export function findHttpRoutes(source: string): GoStudioHttpRoute[] {
  const prefixes = new Map<string, string>()
  const routes: GoStudioHttpRoute[] = []
  source.split('\n').forEach((text, index) => {
    if (isComment(text)) return
    const line = index + 1
    const group = GROUP_DECLARATION.exec(text)
    if (group) {
      prefixes.set(group[1], joinPath(prefixes.get(group[2]) ?? '', stringLiteral(group, 3)))
      return
    }
    const methodCall = METHOD_CALL.exec(text)
    if (methodCall) {
      const path = stringLiteral(methodCall, 3)
      if (!path.startsWith('/')) return
      routes.push({ line, method: methodCall[2].toUpperCase() as HttpMethod, path: joinPath(prefixes.get(methodCall[1]) ?? '', path), anyMethod: false })
      return
    }
    const handle = HANDLE_CALL.exec(text)
    if (!handle) return
    const parsed = parseServeMuxPattern(stringLiteral(handle, 2))
    if (!parsed) return
    const muxMethod = MUX_METHODS.exec(text)?.[1]?.toUpperCase() as HttpMethod | undefined
    const method = parsed.method ?? (muxMethod && HTTP_METHODS.includes(muxMethod) ? muxMethod : null)
    routes.push({ line, method: method ?? 'GET', path: joinPath(prefixes.get(handle[1]) ?? '', parsed.path), anyMethod: method === null })
  })
  return routes
}

/** Base URL del server se il file lo dichiara (":8080" → http://localhost:8080); altrimenti null. */
export function findServerBaseUrl(source: string): string | null {
  for (const text of source.split('\n')) {
    if (isComment(text)) continue
    const match = LISTEN_ADDRESS.exec(text)
    if (!match) continue
    const address = stringLiteral(match, 2) || stringLiteral(match, 4)
    const port = /:(\d+)$/.exec(address)?.[1]
    if (!port) continue
    const host = address.slice(0, address.lastIndexOf(':')) || 'localhost'
    const tls = (match[1] ?? '').endsWith('TLS')
    return `${tls ? 'https' : 'http'}://${host === '0.0.0.0' ? 'localhost' : host}:${port}`
  }
  return null
}

/** Route registrata sulla riga del cursore, se c'è. */
export function routeAtLine(routes: readonly GoStudioHttpRoute[], line: number): GoStudioHttpRoute | null {
  return routes.find((route) => route.line === line) ?? null
}

/** Base URL della richiesta: {{baseUrl}} dell'ambiente attivo, poi l'indirizzo dichiarato nel file, poi localhost:8080. */
export function resolveGoBaseUrl(source: string, environmentVariables: Record<string, string>): string {
  if (environmentVariables[BASE_URL_VARIABLE]) return `{{${BASE_URL_VARIABLE}}}`
  return findServerBaseUrl(source) ?? DEFAULT_GO_BASE_URL
}

/** Richiesta API precompilata dalla route: metodo, URL con parametri di path e origine nel codice. */
export function requestFromRoute(route: GoStudioHttpRoute, baseUrl: string, origin: string): RequestItem {
  const request = blankRequest(route.method, `${route.method} ${route.path}`)
  const anyMethodNote = route.anyMethod ? ' The handler accepts any method: GET is only the default.' : ''
  return {
    ...requestWithUrlInput(request, `${baseUrl}${route.path}`),
    description: `Opened from Go Studio: ${origin}.${anyMethodNote}`,
  }
}

/** cURL con l'indirizzo reale: la variabile baseUrl dell'ambiente se c'è, altrimenti quello trovato nel codice. */
export function routeCurl(route: GoStudioHttpRoute, source: string, variables: Record<string, string>): string {
  const baseUrl = (variables[BASE_URL_VARIABLE] || findServerBaseUrl(source) || DEFAULT_GO_BASE_URL).replace(/\/+$/, '')
  return generateCode(requestFromRoute(route, baseUrl, 'Go Studio'), 'curl')
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Leaf, Loader2, Search } from 'lucide-react'
import { CodeStudioModal } from './CodeStudioModal'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useSpringStore, springStateOf } from '@/stores/codeStudioSpring'
import { filterEndpoints } from '@/lib/code-studio/springInsights'
import type { SpringEndpoint } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/languages/java/models'

interface EndpointsRequest {
  sessionId: string
}

let openRequest: ((request: EndpointsRequest) => void) | null = null

/** Apre l'elenco degli endpoint Spring del progetto. */
export function openSpringEndpoints(sessionId: string): void {
  openRequest?.({ sessionId })
}

/**
 * Elenco degli endpoint HTTP MVC del progetto con il filtro per metodo, percorso o nome: è ciò che
 * un `@RestController` espone davvero, letto dai sorgenti senza avviare l'applicazione.
 */
export function CodeStudioSpringEndpoints() {
  const [request, setRequest] = useState<EndpointsRequest | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const index = useSpringStore((state) => (request ? state.bySession[request.sessionId]?.index ?? null : null))
  const refreshing = useSpringStore((state) => (request ? state.bySession[request.sessionId]?.refreshing ?? false : false))
  const report = useSpringStore((state) => (request ? state.bySession[request.sessionId]?.report ?? null : null))
  const indexing = useSpringStore((state) => (request ? state.bySession[request.sessionId]?.indexingMetadata ?? false : false))
  const error = useSpringStore((state) => (request ? state.bySession[request.sessionId]?.error ?? '' : ''))

  useEffect(() => {
    openRequest = (next) => {
      setRequest(next)
      setQuery('')
      setSelected(0)
      void useSpringStore.getState().refresh(next.sessionId)
    }
    return () => {
      openRequest = null
    }
  }, [])

  const endpoints = useMemo(() => filterEndpoints(index?.endpoints ?? [], query), [index, query])
  const close = () => setRequest(null)

  const open = (endpoint: SpringEndpoint) => {
    if (!endpoint.file) return
    void useCodeStudioStore.getState().openLocation(endpoint.file, endpoint.line || 1, endpoint.startColumn || 1)
    close()
  }

  return (
    <CodeStudioModal
      open={!!request}
      onClose={close}
      title="Spring endpoints"
      subtitle={request ? `${(index?.endpoints ?? []).length} endpoint(s) found without running the application` : undefined}
      icon={Leaf}
      size="lg"
      tall
      divided
      flush
      top
      actions={
        <>
        <button
          type="button"
          onClick={() => request && void import('@/lib/devsession/workspaceFlow').then(({ openWorkspaceApi }) => openWorkspaceApi(request.sessionId)).then(close)}
          disabled={!request || (index?.endpoints ?? []).length === 0}
          className="gs-badge cursor-pointer disabled:cursor-default"
          title="Create an API Workspace collection with one request per endpoint, linked to the running service"
        >
          Open API
        </button>
        <button
          type="button"
          onClick={() => request && void useSpringStore.getState().refreshMetadata(request.sessionId)}
          disabled={indexing || !request}
          className="gs-badge cursor-pointer disabled:cursor-default"
          title="Index the configuration metadata of the jars already downloaded in the local Maven repository"
        >
          {indexing ? <Loader2 size={12} className="animate-spin" /> : null}
          {indexing ? ' Indexing libraries…' : ' Index Maven libraries'}
        </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border-1 px-3 py-2">
          <Search size={14} className="text-text-3" />
          <input
            ref={searchRef}
            data-autofocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelected((current) => Math.min(current + 1, endpoints.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelected((current) => Math.max(current - 1, 0))
              } else if (event.key === 'Enter' && endpoints[selected]) {
                event.preventDefault()
                open(endpoints[selected])
              }
            }}
            placeholder="Filter by method, path or name"
            className="gs-input flex-1"
          />
          {refreshing && <Loader2 size={13} className="animate-spin text-text-3" />}
        </div>

        {error && <p className="border-b border-border-1 px-3 py-2 text-[11px] text-danger">{error}</p>}

        <div className="gs-list min-h-0 flex-1 overflow-auto">
          {endpoints.map((endpoint, position) => (
            <button
              key={`${endpoint.method}:${endpoint.path}:${endpoint.member}:${position}`}
              type="button"
              onMouseEnter={() => setSelected(position)}
              onClick={() => open(endpoint)}
              className={`gs-list-row w-full text-left ${position === selected ? 'bg-surface-2' : ''}`}
            >
              <span className="gs-badge w-16 shrink-0 text-center">{endpoint.method}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-1">{endpoint.path}</span>
              <span className="truncate text-[11px] text-text-3">{endpoint.member}</span>
              <span className="hidden truncate text-[11px] text-text-4 sm:block">{endpoint.class}</span>
              <ExternalLink size={12} className="shrink-0 text-text-4" />
            </button>
          ))}
          {!refreshing && endpoints.length === 0 && (
            <p className="px-3 py-3 text-[11px] text-text-3">
              {query ? `No endpoint matches "${query}".` : 'No @RestController or @RequestMapping method found in this project.'}
            </p>
          )}
        </div>

        {report && (
          <p className="border-t border-border-1 px-3 py-2 text-[10.5px] text-text-4">
            {report.artifacts} jar scanned · {report.cached} already known · {report.properties} properties
            {report.state === 'partial' ? ' · stopped at the artifact limit' : ''}
          </p>
        )}
      </div>
    </CodeStudioModal>
  )
}

/** La porta su cui l'applicazione risponde, dal profilo che vince: `server.port`. */
export function springServerPort(sessionId: string): string {
  return springStateOf(sessionId).index?.serverPort ?? ''
}

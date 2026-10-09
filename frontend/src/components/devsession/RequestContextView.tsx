import { useState, type ReactNode } from 'react'
import { ExternalLink, FileArchive } from 'lucide-react'
import { useDevSessionStore } from '@/stores/devSession'
import { buildReproduction } from '@/lib/devsession/reproduction'
import type { RequestRun } from '@/lib/devsession-api'
import { substVars } from '@/lib/substVars'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'
import { liveVars } from '@/lib/devsession/liveRequest'
import { openRequestTab } from '@/lib/devsession/navigation'
import { pathParams, requestPath } from '@/lib/devsession/routeMatch'
import { useRouteForRequest } from '@/lib/devsession/useRouteForRequest'

const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i

/** `Bearer abc.def` → `Bearer ***`: values of credential headers never show in the debugger. */
export function maskHeader(key: string, value: string): string {
  if (!SECRET_HEADER.test(key.trim())) return value
  const scheme = /^(Bearer|Basic|Digest|Token)\s+/i.exec(value)
  return scheme ? `${scheme[1]} ***` : '***'
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border-1 px-3 py-2">
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-4">{title}</h4>
      {children}
    </section>
  )
}

function Pairs({ pairs }: { pairs: Array<[string, string]> }) {
  if (pairs.length === 0) return <p className="text-[11.5px] text-text-4">None</p>
  return (
    <dl className="grid grid-cols-[minmax(80px,auto)_1fr] gap-x-3 gap-y-0.5 font-mono text-[11.5px]">
      {pairs.map(([key, value], index) => (
        <div key={`${key}-${index}`} className="contents">
          <dt className="truncate text-text-3">{key}</dt>
          <dd className="break-all text-text-1">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The HTTP request a paused goroutine is serving, next to Variables and Call
 * Stack: method, path/query params, headers (credentials masked), body and
 * the ids that tie it to logs and messages.
 */
/** Writes repro/<when>-<request>/ into the service's Go project and opens its README. */
export function SaveReproductionButton({ run }: { run: RequestRun }) {
  const [state, setState] = useState<{ busy: boolean; text: string; error?: boolean }>({ busy: false, text: '' })
  const save = async () => {
    const store = useDevSessionStore.getState()
    const session = store.sessions[run.sessionId]
    const tab = useTabsStore.getState().tabs.find((item) => item.id === run.tabId)
    if (!session?.goSessionId) return setState({ busy: false, text: 'The service is not a Go Studio project: open it there to save a reproduction.', error: true })
    setState({ busy: true, text: '' })
    try {
      const request = tab
        ? { method: tab.request.method, url: tab.request.url, headers: tab.request.headers, body: tab.request.bodies[tab.request.activeBodyIdx] }
        : { method: run.method, url: run.url, headers: [] }
      const result = buildReproduction({
        run, request, service: session.service, createdAt: new Date().toISOString(),
        logs: (store.logs[run.sessionId] ?? []).filter((entry) => entry.requestRunId === run.id),
        queries: store.queries.filter((query) => query.requestRunId === run.id),
        messages: store.messages.filter((message) => message.requestRunId === run.id),
      })
      const [{ createGoIDEFiles }, { useGoIDEStore }] = await Promise.all([import('@/lib/goide-api'), import('@/stores/goide')])
      await createGoIDEFiles(session.goSessionId, result.files)
      setState({ busy: false, text: `Saved ${result.files.length} files in ${result.dir}${result.secretsStripped ? ` · ${result.secretsStripped} secrets stripped` : ''}` })
      const goide = useGoIDEStore.getState()
      if (goide.activeSessionId !== session.goSessionId) await goide.selectSession(session.goSessionId)
      await useGoIDEStore.getState().openLocation(`${result.dir}/README.md`, 1, 1)
    } catch (error) {
      setState({ busy: false, text: error instanceof Error ? error.message : String(error), error: true })
    }
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <button type="button" onClick={() => void save()} disabled={state.busy} title="Save the request, logs, SQL, messages and stacks as replayable files (README, .http, Go test, fixtures) in the service's project" className="flex shrink-0 items-center gap-1 rounded border border-border-2 px-2 py-0.5 text-[11px] text-text-2 hover:border-accent hover:text-accent disabled:opacity-50">
        <FileArchive size={11} />{state.busy ? 'Saving…' : 'Save reproduction'}
      </button>
      {state.text && <span title={state.text} className={state.error ? 'min-w-0 truncate text-[11px] text-error' : 'min-w-0 truncate text-[11px] text-success'}>{state.text}</span>}
    </span>
  )
}

export function RequestContextView({ run }: { run: RequestRun }) {
  const tab = useTabsStore((state) => state.tabs.find((item) => item.id === run.tabId))
  const vars = liveVars(useEnvironmentsStore.getState().getResolvedVars())
  const route = useRouteForRequest(run.method, run.url)
  const pathname = requestPath(run.url) ?? ''
  let query: Array<[string, string]> = []
  try { query = [...new URL(run.url).searchParams.entries()] } catch { /* relative URL: no query */ }
  const params = route ? Object.entries(pathParams(route.route.attrs.path ?? '', pathname)) : []
  const headers: Array<[string, string]> = (tab?.request.headers ?? [])
    .filter((header) => header.enabled && header.key)
    .map((header) => [substVars(header.key, vars), maskHeader(header.key, substVars(header.value, vars))])
  const body = tab ? tab.request.bodies[tab.request.activeBodyIdx] : undefined
  const bodyText = !body || body.type === 'none' ? ''
    : body.type === 'urlencoded' || body.type === 'formdata'
      ? body.form.filter((row) => row.enabled && row.key).map((row) => `${row.key}=${substVars(row.value, vars)}`).join('\n')
      : substVars(body.raw, vars)

  return (
    <div className="min-h-0 flex-1 overflow-auto text-text-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-1 px-3 py-2">
        <span className="font-mono text-[12px] font-bold text-text-1">{run.method}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-1" title={run.url}>{pathname || run.url}</span>
        {run.tabId && (
          <button type="button" onClick={() => openRequestTab(run.tabId)} className="flex shrink-0 items-center gap-1 rounded border border-border-2 px-2 py-0.5 text-[11px] text-text-2 hover:border-accent hover:text-accent">
            <ExternalLink size={11} />Open full request
          </button>
        )}
        <SaveReproductionButton run={run} />
      </div>
      {route && <Section title="Handler"><p className="font-mono text-[11.5px] text-text-1">{route.name} <span className="text-text-4">· {route.file}:{route.line}</span></p></Section>}
      <Section title="Path parameters"><Pairs pairs={params} /></Section>
      <Section title="Query parameters"><Pairs pairs={query} /></Section>
      <Section title="Headers"><Pairs pairs={headers} /></Section>
      <Section title="Body">
        {bodyText ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11.5px] text-text-1">{bodyText}</pre> : <p className="text-[11.5px] text-text-4">{tab ? 'No body' : 'The request tab was closed.'}</p>}
      </Section>
      <Section title="Request ID"><Pairs pairs={[['X-AdOmnia-Request-ID', run.correlationId], ['run', run.id]]} /></Section>
    </div>
  )
}

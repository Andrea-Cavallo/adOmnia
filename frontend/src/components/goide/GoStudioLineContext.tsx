import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Boxes, Database, FlaskConical, GitFork, Globe, MessageSquare, Package, Radio, Shuffle } from 'lucide-react'
import type { GoIDEArchitectureResult, GoIDESession } from '@/lib/goide-api'
import { architectureFor, cachedArchitecture } from '@/lib/goide/architectureCache'
import { lineContext, testAt } from '@/lib/goide/lineContext'
import { lensTitle, fileCounts } from '@/lib/goide/runtimeLens'
import { sourceForStatement } from '@/lib/devsession/sqlInsights'
import { requestPath, routeMatches } from '@/lib/devsession/routeMatch'
import { openRequestTab } from '@/lib/devsession/navigation'
import { handoffToPanel } from '@/lib/entities/dispatch'
import { cn } from '@/lib/utils'
import { useDevSessionStore } from '@/stores/devSession'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { useGoIDETestsStore } from '@/stores/goideTests'
import { useGoIDEDebugStore, activeDebugView } from '@/stores/goideDebug'
import { useGoIDENavigationStore } from '@/stores/goideNavigation'
import { openHttpRouteAt } from './goStudioCodeLens'
import { runtimeLensStats } from './goStudioRuntimeLens'
import { SiteLink, openArchSite } from './GoStudioInterfaceExplorer'

const METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border-1 px-3 py-2">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">{icon}{title}</h3>
      <div className="space-y-1.5 text-[11.5px]">{children}</div>
    </section>
  )
}

function Action({ onClick, children, title }: { onClick: () => void; children: ReactNode; title?: string }) {
  return <button type="button" onClick={onClick} title={title} className="rounded border border-border-2 px-1.5 py-0.5 text-[10.5px] text-text-2 hover:border-accent hover:text-accent">{children}</button>
}

const ago = (iso: string) => {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.round(seconds / 60)}m ago` : `${Math.round(seconds / 3600)}h ago`
}

/**
 * Context pane: what the line under the cursor is in the running system — the route it serves and its
 * last live requests, its SQL and the statements captured, its topics and messages, the test around it,
 * interfaces, goroutines started here, a go.mod dependency, diagnostics and Runtime Lens numbers.
 */
export function GoStudioLineContext({ session, document }: { session: GoIDESession; document: GoIDEEditorDocument | null }) {
  const caret = useGoIDENavigationStore((state) => { const history = state.history[session.id]; return history?.entries[history.index] })
  const relativePath = document?.document.relativePath ?? ''
  const line = caret && caret.relativePath === relativePath ? caret.line : 0
  const [arch, setArch] = useState<GoIDEArchitectureResult | null>(() => cachedArchitecture(session.id))
  const [archError, setArchError] = useState('')
  useEffect(() => {
    if (arch || session.project.authorization !== 'tooling-permitted') return
    architectureFor(session.id).then(setArch).catch((error: unknown) => setArchError(error instanceof Error ? error.message : String(error)))
  }, [arch, session.id, session.project.authorization])
  const lines = useMemo(() => (document?.buffer ?? '').split('\n'), [document?.buffer])
  const context = useMemo(() => lineContext(arch?.report, relativePath, line, lines[line - 1] ?? ''), [arch, relativePath, line, lines])
  const test = useMemo(() => testAt(relativePath, lines, line), [relativePath, lines, line])

  const runs = useDevSessionStore((state) => state.runs)
  const runOrder = useDevSessionStore((state) => state.runOrder)
  const liveQueries = useDevSessionStore((state) => state.queries)
  const liveMessages = useDevSessionStore((state) => state.messages)
  const diagnostics = useGoIDELspStore((state) => state.diagnostics[session.id])
  const testRuns = useGoIDETestsStore((state) => state.runs[session.id])
  const debugView = useGoIDEDebugStore((state) => activeDebugView(state, session.id))

  if (!document || !line) {
    return <p className="p-3 text-[11px] text-text-4">Place the cursor in a Go file: this pane shows what that code is in the running system.</p>
  }

  const problems = Object.values(diagnostics ?? {}).filter((report) => report.relativePath === relativePath)
    .flatMap((report) => report.diagnostics).filter((item) => item.range.startLine <= line && line <= item.range.endLine)
  const fileLens = runtimeLensStats(session.id, relativePath)
  const lensHere = fileLens.find((stat) => stat.line === line)
  const testResult = test ? (testRuns ?? []).flatMap((run) => run.results.filter((result) => result.name === test).map((result) => ({ run, result }))).sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt))[0] : undefined
  const goroutinesHere = context.goroutine && debugView?.goroutines
    ? debugView.goroutines.goroutines.filter((goroutine) => goroutine.origin?.relativePath === relativePath && goroutine.origin.line === line)
    : null
  const importers = context.module ? (arch?.report?.packages ?? []).filter((pkg) => pkg.external.some((path) => path === context.module || path.startsWith(`${context.module}/`))) : []
  const nothing = !context.routes.length && !context.queries.length && !context.kafka.length && !context.iface && !context.implemented.length && !test && !context.goroutine && !context.module && !problems.length && !lensHere

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-border-1 px-3 py-2 text-[11px] text-text-3">
        <span className="font-mono text-text-1">{context.fn?.name ?? relativePath.split('/').pop()}</span>
        <span className="ml-1.5 text-text-4">{relativePath}:{line}</span>
      </div>

      {problems.length > 0 && (
        <Section icon={<AlertTriangle size={11} />} title="Problems on this line">
          {problems.map((item, index) => (
            <p key={index} className={cn('leading-4', item.severity === 1 ? 'text-error' : 'text-warning')}>{item.message}{item.source ? <span className="text-text-4"> · {item.source}</span> : null}</p>
          ))}
        </Section>
      )}

      {context.routes.map((route) => {
        const path = route.name.replace(METHOD, '')
        const method = METHOD.exec(route.name)?.[1]?.toUpperCase()
        const matching = runOrder.map((id) => runs[id]).filter((run) => run && route.kind === 'http' && routeMatches(path, requestPath(run.url) ?? '') && (!method || run.method === method)).reverse().slice(0, 3)
        return (
          <Section key={`${route.kind}:${route.name}:${route.site.line}`} icon={<Globe size={11} />} title={route.kind === 'grpc' ? 'gRPC service' : 'API'}>
            <p className="font-mono text-text-1">{route.name}</p>
            {route.handler && <p className="text-text-3">handler <SiteLink site={route.handlerSite ?? undefined} label={route.handler} /></p>}
            <div className="flex flex-wrap gap-1">
              {route.kind === 'http' && route.site.relativePath === relativePath && <Action onClick={() => openHttpRouteAt(document, route.site.line)} title="Create a prefilled request in the API client">Open in API Client</Action>}
              {route.site.relativePath !== relativePath && <Action onClick={() => openArchSite(route.site)}>Registration</Action>}
            </div>
            {matching.length > 0 ? matching.map((run) => (
              <button key={run.id} type="button" onClick={() => openRequestTab(run.tabId)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-surface-2">
                <span className={cn('font-mono', (run.status ?? 0) >= 400 || run.state === 'error' ? 'text-error' : 'text-success')}>{run.status ?? run.state}</span>
                <span className="text-text-3">{run.durationMs ?? '–'} ms</span>
                <span className="ml-auto text-text-4">{ago(run.startedAt)}</span>
              </button>
            )) : route.kind === 'http' && <p className="text-text-4">No live request to this route yet.</p>}
          </Section>
        )
      })}

      {context.queries.length > 0 && (
        <Section icon={<Database size={11} />} title="Database">
          {context.queries.map((query) => {
            const seen = query.sql ? liveQueries.filter((live) => sourceForStatement(live.sql, [query])) : []
            const last = seen[seen.length - 1]
            return (
              <div key={`${query.site.line}:${query.method}`} className="space-y-1">
                <p className="text-text-3"><span className="text-text-2">{query.operation}</span> {query.tables.join(', ') || query.model || ''} <span className="text-text-4">· {query.library}{query.transaction ? ' · tx' : ''}</span></p>
                {query.sql && <code className="block max-h-16 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 px-1.5 py-1 text-[10.5px] text-text-1">{query.sql}</code>}
                {last && <p className={last.error ? 'text-error' : 'text-text-3'}>{seen.length} run{seen.length === 1 ? '' : 's'} captured · last {last.durationMs != null ? `${last.durationMs.toFixed(1)} ms` : ''}{last.error ? ` · ${last.error}` : ''}</p>}
                {query.sql && <Action onClick={() => handoffToPanel('database', { kind: 'table', id: `sql:${relativePath}:${query.site.line}`, label: query.function, attrs: {} }, 'sql', { sql: query.sql! })}>Open in Database Studio</Action>}
              </div>
            )
          })}
        </Section>
      )}

      {context.kafka.length > 0 && (
        <Section icon={<Radio size={11} />} title="Broker">
          {context.kafka.map((entry) => (entry.topics ?? []).map((topic) => {
            const seen = liveMessages.filter((message) => message.topic === topic)
            const last = seen[seen.length - 1]
            return (
              <div key={`${entry.kind}:${topic}`} className="space-y-1">
                <p className="text-text-2"><span className="font-mono text-text-1">{topic}</span> <span className="text-text-4">· {entry.kind === 'kafka-producer' ? 'produces' : `consumes${entry.group ? ` · group ${entry.group}` : ''}`}</span></p>
                {last && <p className="flex items-center gap-1 text-text-3"><MessageSquare size={10} /> {seen.length} message{seen.length === 1 ? '' : 's'} seen · last offset {last.offset} · {ago(last.at)}</p>}
                <Action onClick={() => handoffToPanel('broker', { kind: 'topic', id: `topic:${topic}`, label: topic, attrs: { broker: 'kafka' } }, 'open')}>Open in Broker Studio</Action>
              </div>
            )
          }))}
        </Section>
      )}

      {test && (
        <Section icon={<FlaskConical size={11} />} title="Test">
          <p className="font-mono text-text-1">{test}</p>
          {testResult ? (
            <p className={testResult.result.status === 'fail' ? 'text-error' : testResult.result.status === 'pass' ? 'text-success' : 'text-text-3'}>
              {testResult.result.status} · {testResult.result.elapsedMillis} ms · {ago(testResult.run.startedAt)}
              {testResult.result.failure ? <span className="block text-text-3">failed at {testResult.result.failure.relativePath ?? testResult.result.failure.file}:{testResult.result.failure.line}</span> : null}
            </p>
          ) : <p className="text-text-4">Not run in this session: use ▶ next to the test.</p>}
          {(testResult?.run.raceReports?.length ?? 0) > 0 && <p className="text-warning">{testResult!.run.raceReports!.length} data race report(s) in that run.</p>}
        </Section>
      )}

      {(context.iface || context.implemented.length > 0) && (
        <Section icon={<Boxes size={11} />} title="Interfaces">
          {context.iface && (
            <>
              <p className="text-text-2"><span className="font-mono text-text-1">{context.iface.name}</span> · {context.iface.implementations.length} implementation{context.iface.implementations.length === 1 ? '' : 's'} · {context.iface.userCount} use{context.iface.userCount === 1 ? '' : 's'}</p>
              {context.iface.implementations.map((impl) => <p key={`${impl.package}.${impl.type}`}><SiteLink site={impl.site} label={`${impl.pointer ? '*' : ''}${impl.type}${impl.test ? ' (test)' : ''}`} /></p>)}
            </>
          )}
          {context.implemented.map((item) => <p key={`${item.package}.${item.name}`} className="text-text-3">implements <SiteLink site={item.site} label={item.name} /></p>)}
        </Section>
      )}

      {context.goroutine && (
        <Section icon={<Shuffle size={11} />} title="Goroutine started here">
          {goroutinesHere ? (
            goroutinesHere.length ? <p className="text-text-2">{goroutinesHere.length} live goroutine{goroutinesHere.length === 1 ? '' : 's'} created here: {Object.entries(goroutinesHere.reduce<Record<string, number>>((acc, g) => ({ ...acc, [g.state]: (acc[g.state] ?? 0) + 1 }), {})).map(([state, count]) => `${count} ${state}`).join(', ')}</p>
              : <p className="text-text-3">No goroutine from this line is alive at the pause.</p>
          ) : <p className="text-text-4">Pause in the debugger to see the goroutines created here; run with the race detector to check what they share.</p>}
        </Section>
      )}

      {context.module && (
        <Section icon={<Package size={11} />} title="Dependency">
          <p className="font-mono text-text-1">{context.module}</p>
          <p className="text-text-3">{importers.length ? `Imported by ${importers.map((pkg) => pkg.path).join(', ')}` : arch ? 'No package of the project imports it directly.' : 'Analyzing the project…'}</p>
          <div className="flex flex-wrap gap-1">
            <Action onClick={() => useGoIDELspStore.getState().showToolWindow('vulns')} title="govulncheck: is a vulnerable function of it reachable?">Vulnerabilities</Action>
            {importers[0] && <Action onClick={() => openArchSite(importers[0].site)}>First importer</Action>}
          </div>
        </Section>
      )}

      {lensHere && (
        <Section icon={<GitFork size={11} />} title="Runtime">
          <p className="text-text-2">{lensTitle(lensHere, fileCounts(fileLens), Date.now()).replace(/^runtime: /, '')}</p>
        </Section>
      )}

      {nothing && <p className="p-3 text-[11px] text-text-4">{archError || 'Nothing runtime-related on this line. Try a handler, a query, a topic, a test, an interface, a go statement or a go.mod dependency.'}</p>}
    </div>
  )
}


import { useEffect, useMemo, useState } from 'react'
import { BookOpen, FileCode2, FileText, Loader2, Network, RefreshCw, Wand2 } from 'lucide-react'
import { createGoIDEFiles, loadGoIDEDocumentation, type GoIDEDocumentation, type GoIDEErrorFinding, type GoIDESession } from '@/lib/goide-api'
import { handoffToPanel } from '@/lib/entities/dispatch'
import { renderMarkdown } from '@/lib/markdownDoc'
import { useGoIDEStore } from '@/stores/goide'
import { MarkdownPreview } from '@/components/markdown/MarkdownPreview'
import { architectureFor } from './GoStudioArchitecturePanel'
import { applyErrorFinding } from './GoStudioErrorsPanel'
import { apiDocsMarkdown, architectureMarkdown, openApiFromRoutes, packageDocMarkdown, parseSourceLink, protoMarkdown } from './goStudioDocsGen'

type DocsTab = 'packages' | 'missing' | 'protos' | 'generate'

function errorText(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem)
}

/**
 * Scrive un documento del progetto: un file nuovo viene creato, uno esistente viene aggiornato nel
 * buffer (non salvato, annullabile) così nulla viene sovrascritto senza che l'utente lo veda.
 */
async function writeProjectDocument(sessionId: string, relativePath: string, content: string): Promise<void> {
  const store = useGoIDEStore.getState()
  const existing = await store.ensureDocumentLoaded(relativePath).catch(() => null)
  if (existing) store.updateDocument(existing.document.id, content)
  else await createGoIDEFiles(sessionId, [{ relativePath, content }])
  await store.openDocument(relativePath)
}

function openSourceLink(href: string): void {
  const target = parseSourceLink(href)
  if (target) void useGoIDEStore.getState().openLocation(target.path, target.line, 1)
}

/** Documentation Intelligence: docs dei package, documentazione mancante, .proto e generatori. */
export function GoStudioDocsPanel({ session }: { session: GoIDESession }) {
  const sessionId = session.id
  const project = session.project.name || 'Project'
  const authorized = session.project.authorization === 'tooling-permitted'
  const [docs, setDocs] = useState<GoIDEDocumentation | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [tab, setTab] = useState<DocsTab>('packages')
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      setDocs(await loadGoIDEDocumentation(sessionId))
      setMessage(null)
    } catch (problem) {
      setMessage({ tone: 'error', text: errorText(problem) })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, action: () => Promise<string>) => {
    setBusy(label)
    try {
      setMessage({ tone: 'ok', text: await action() })
    } catch (problem) {
      setMessage({ tone: 'error', text: errorText(problem) })
    } finally {
      setBusy(null)
    }
  }
  const generators = docs ? [
    { id: 'api', icon: BookOpen, title: 'API docs', detail: 'docs/API.md — every package with its exported API, from the doc comments.', needsTrust: false,
      action: async () => { await writeProjectDocument(sessionId, 'docs/API.md', apiDocsMarkdown(docs.packages, project)); return 'docs/API.md is open: review it and save.' } },
    { id: 'architecture', icon: Network, title: 'Architecture docs', detail: 'docs/ARCHITECTURE.md — Mermaid diagrams of packages and modules, entry points, services and interfaces.', needsTrust: true,
      action: async () => { const result = await architectureFor(sessionId); await writeProjectDocument(sessionId, 'docs/ARCHITECTURE.md', architectureMarkdown(result.report, project)); return 'docs/ARCHITECTURE.md is open: the diagrams render in the Markdown preview.' } },
    { id: 'openapi', icon: FileCode2, title: 'OpenAPI from the routes', detail: 'docs/openapi.json from the HTTP routes found in the code, previewed in API Docs.', needsTrust: true,
      action: async () => {
        const result = await architectureFor(sessionId)
        const routes = result.report.entries.filter((entry) => entry.kind === 'http')
        if (!routes.length) return 'No HTTP routes found in the code.'
        const text = `${JSON.stringify(openApiFromRoutes(routes, project, result.report.schemas), null, 2)}\n`
        await writeProjectDocument(sessionId, 'docs/openapi.json', text)
        handoffToPanel('apidocs', { kind: 'contract', id: 'contract:docs/openapi.json', label: 'openapi.json', attrs: { type: 'oas', path: 'docs/openapi.json' }, sessionId }, 'open', { text, name: 'openapi.json' })
        return `OpenAPI with ${routes.length} route${routes.length === 1 ? '' : 's'} written to docs/openapi.json and opened in API Docs.`
      } },
    { id: 'proto', icon: FileText, title: 'Proto docs', detail: 'docs/PROTO.md — services, RPCs, messages and enums of every .proto file.', needsTrust: false,
      action: async () => {
        if (!docs.protos.length) return 'No .proto files in the project.'
        await writeProjectDocument(sessionId, 'docs/PROTO.md', protoMarkdown(docs.protos, project))
        return 'docs/PROTO.md is open: review it and save.'
      } },
  ] : []

  const tabs: Array<[DocsTab, string]> = [
    ['packages', `Packages${docs ? ` (${docs.packages.length})` : ''}`],
    ['missing', `Missing docs${docs ? ` (${docs.problems.length})` : ''}`],
    ['protos', `Proto${docs ? ` (${docs.protos.length})` : ''}`],
    ['generate', 'Generate'],
  ]
  return (
    <div className="flex h-full min-h-0 flex-col text-[11px]">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border-1 px-2" role="tablist">
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setSelected(0) }} className={`border-b-2 px-2 py-1 ${tab === id ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-1'}`}>{label}</button>)}
        <button type="button" onClick={() => void refresh()} title="Read the documentation again" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1">{loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} aria-hidden="true" />}</button>
      </div>
      {message && <div className={`shrink-0 border-b px-2 py-1 ${message.tone === 'error' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-success/30 bg-success/10 text-success'}`}>{message.text}</div>}
      <div className="flex min-h-0 flex-1">
        {!docs ? <p className="p-3 text-text-4">{loading ? 'Reading documentation…' : 'No documentation loaded.'}</p>
          : tab === 'packages' ? <DocList items={docs.packages.map((pkg) => ({ label: pkg.importPath, hint: pkg.synopsis }))} selected={selected} onSelect={setSelected} markdown={docs.packages[selected] ? packageDocMarkdown(docs.packages[selected]) : ''} empty="No Go packages." />
            : tab === 'protos' ? <DocList items={docs.protos.map((file) => ({ label: file.path, hint: file.error ? 'cannot be read' : `${file.services.length} services · ${file.messages.length} messages` }))} selected={selected} onSelect={setSelected} markdown={docs.protos[selected] ? protoMarkdown([docs.protos[selected]], project) : ''} empty="No .proto files in the project." />
              : tab === 'missing' ? <MissingDocs problems={docs.problems} />
                : (
                  <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
                    {generators.map(({ id, icon: Icon, title, detail, needsTrust, action }) => (
                      <div key={id} className="flex items-center gap-3 rounded-lg border border-border-1 bg-surface-2/60 px-3 py-2">
                        <Icon size={16} className="shrink-0 text-accent" aria-hidden="true" />
                        <div className="min-w-0 flex-1"><div className="font-semibold text-text-1">{title}</div><div className="text-text-3">{detail}</div></div>
                        <button type="button" disabled={busy !== null || (needsTrust && !authorized)} onClick={() => void run(id, action)} title={needsTrust && !authorized ? 'Trust the project: this uses the architecture analysis (go list)' : 'Generate and open it in the editor (nothing is saved until you save)'} className="flex h-7 shrink-0 items-center gap-1 rounded bg-accent px-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-40">
                          {busy === id ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} aria-hidden="true" />} Generate
                        </button>
                      </div>
                    ))}
                    <p className="text-text-4">An existing file is updated in the editor without saving, so you can review the change and undo it. Mermaid diagrams render in Go Studio's Markdown preview.</p>
                  </div>
                )}
      </div>
    </div>
  )
}

function DocList({ items, selected, onSelect, markdown, empty }: { items: Array<{ label: string; hint: string }>; selected: number; onSelect: (index: number) => void; markdown: string; empty: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown])
  if (!items.length) return <p className="p-3 text-text-4">{empty}</p>
  return (
    <>
      <ul className="w-64 shrink-0 overflow-auto border-r border-border-1 py-1">
        {items.map((item, index) => (
          <li key={item.label}><button type="button" onClick={() => onSelect(index)} title={item.hint} className={`block w-full px-2 py-0.5 text-left ${index === selected ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-3'}`}><div className="truncate font-mono">{item.label}</div>{item.hint && <div className="truncate text-[10px] text-text-4">{item.hint}</div>}</button></li>
        ))}
      </ul>
      <MarkdownPreview className="min-w-0 bg-[var(--gs-island,var(--color-surface-0))] text-[12px]" html={html} onInternalLink={openSourceLink} />
    </>
  )
}

function MissingDocs({ problems }: { problems: GoIDEErrorFinding[] }) {
  const [error, setError] = useState<string | null>(null)
  // Lo stub va nel buffer (non salvato): il file su disco cambia solo al salvataggio, quindi si marca qui.
  const [applied, setApplied] = useState<Set<GoIDEErrorFinding>>(new Set())
  if (!problems.length) return <p className="p-3 text-success">Every exported symbol is documented.</p>
  const byPackage = new Map<string, GoIDEErrorFinding[]>()
  for (const problem of problems) {
    const dir = problem.location.relativePath.split('/').slice(0, -1).join('/') || '.'
    byPackage.set(dir, [...(byPackage.get(dir) ?? []), problem])
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto py-1">
      <p className="px-2 pb-1 text-text-4">Hints only: exported symbols without a doc comment, or whose comment does not start with their name. <em>Add doc comment</em> inserts <code>// Name </code> above the declaration for you to complete.</p>
      {error && <p className="px-2 text-warning">{error}</p>}
      {[...byPackage.entries()].map(([dir, items]) => (
        <section key={dir}>
          <h4 className="px-2 py-1 font-mono text-[10px] text-text-4">{dir} ({items.length})</h4>
          {items.map((problem, index) => (
            <div key={index} className="flex items-center gap-2 py-0.5 pl-4 pr-2 hover:bg-surface-2">
              <button type="button" onClick={() => void useGoIDEStore.getState().openLocation(problem.location.relativePath, problem.location.line, problem.location.column)} className="shrink-0 font-mono text-[10px] text-text-3 hover:text-accent hover:underline">{problem.location.relativePath.split('/').pop()}:{problem.location.line}</button>
              <span className="min-w-0 flex-1 truncate"><span className="font-mono text-text-1">{problem.function}</span> <span className="text-text-3">· {problem.message}</span></span>
              {problem.fix && (applied.has(problem) ? <span className="shrink-0 text-[10px] text-success">Added</span> : <button type="button" onClick={() => void applyErrorFinding(problem).then((failure) => { setError(failure); if (!failure) setApplied((current) => new Set(current).add(problem)) })} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-accent hover:bg-accent/10"><Wand2 size={10} aria-hidden="true" /> Add doc comment</button>)}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

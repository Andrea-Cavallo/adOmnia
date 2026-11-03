import { useEffect, useMemo, useState } from 'react'
import { Boxes, FolderOpen, Loader2, Search } from 'lucide-react'
import { CodeStudioModal } from './CodeStudioModal'
import { getJavaOsgiWorkspace, selectGoIDEFolder, setJavaOsgiTarget } from '@/lib/code-studio-api'
import type { BundleStatus, MissingDependency, WorkspaceReport } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde/models'
import { withContentKeys } from '@/lib/contentKeys'

let openRequest: ((sessionId: string) => void) | null = null

/** Apre i bundle OSGi/PDE del progetto e la loro risoluzione sulla target platform. */
export function openJavaOsgi(sessionId: string): void {
  openRequest?.(sessionId)
}

const messageOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

const STATUS_CLASS: Record<string, string> = {
  Resolved: 'text-success',
  Warning: 'text-warning',
  Unresolved: 'text-danger',
}

function MissingRow({ missing }: Readonly<{ missing: MissingDependency }>) {
  const available = missing.available ?? []
  return (
    <div className="pb-1 pl-5 text-[11px]">
      <span className={missing.optional ? 'text-text-3' : 'text-danger'}>{missing.kind}: {missing.name}</span>
      {missing.range && <span className="text-text-3"> · required {missing.range}</span>}
      {missing.optional && <span className="text-text-4"> · optional</span>}
      <span className="text-text-3"> · in target: {available.length > 0 ? available.join(', ') : 'none'}</span>
    </div>
  )
}

function BundleRow({ bundle }: Readonly<{ bundle: BundleStatus }>) {
  const missing = bundle.missing ?? []
  return (
    <div className="border-b border-border-1 px-3 py-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-1" title={bundle.location}>
          {bundle.symbolicName} <span className="text-accent">{bundle.version}</span>
        </span>
        {bundle.executionEnvironment && <span className="gs-badge shrink-0">{bundle.executionEnvironment}</span>}
        {bundle.status && <span className={`shrink-0 text-[10.5px] ${STATUS_CLASS[bundle.status] ?? 'text-text-3'}`}>{bundle.status}</span>}
      </div>
      {withContentKeys(missing, (item) => `${item.kind}:${item.name}`).map(({ key, item }) => <MissingRow key={key} missing={item} />)}
      {(bundle.notes ?? []).filter((note) => note.startsWith('via ')).map((note) => <p key={note} className="pl-5 text-[11px] text-warning">{note}</p>)}
    </div>
  )
}

function subtitleOf(report: WorkspaceReport | null, busy: boolean): string {
  if (busy) return 'Reading manifests…'
  if (!report) return ''
  const bundles = `${report.bundles?.length ?? 0} workspace bundle(s)`
  if (!report.hasTarget) return `${bundles} · choose a target platform to resolve them`
  return `${bundles} · ${report.targetBundles} in target · ${report.unresolved} unresolved`
}

/** Target platform e stato dei bundle, come il Plug-in Manifest Editor di Eclipse: dice perché un bundle non si risolve. */
export function CodeStudioJavaOsgi() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [report, setReport] = useState<WorkspaceReport | null>(null)
  const [target, setTarget] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [issuesOnly, setIssuesOnly] = useState(false)

  const load = (request: Promise<WorkspaceReport | null>): void => {
    setBusy(true)
    setError('')
    request
      .then((next) => { setReport(next); setTarget(next?.targetPath ?? '') })
      .catch((reason: unknown) => setError(messageOf(reason)))
      .finally(() => setBusy(false))
  }

  useEffect(() => {
    openRequest = (next) => {
      setSessionId(next)
      setReport(null)
      setTarget('')
      setQuery('')
      setIssuesOnly(false)
      load(getJavaOsgiWorkspace(next))
    }
    return () => { openRequest = null }
  }, [])

  const browse = async (): Promise<void> => {
    const folder = await selectGoIDEFolder('Target platform: a folder of bundles or an Eclipse installation')
    if (folder && sessionId) load(setJavaOsgiTarget(sessionId, folder))
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (report?.bundles ?? []).filter((bundle) => (!issuesOnly || (bundle.missing?.length ?? 0) > 0) && (!needle || bundle.symbolicName.toLowerCase().includes(needle)))
  }, [report, query, issuesOnly])
  const problems = report?.problems ?? []
  const empty = report && (report.bundles?.length ?? 0) === 0

  return (
    <CodeStudioModal open={!!sessionId} onClose={() => setSessionId(null)} title="OSGi bundles & target platform" subtitle={subtitleOf(report, busy)} icon={Boxes} size="lg" tall divided flush top>
      <div className="flex min-h-0 flex-1 flex-col">
        <form
          className="flex items-center gap-2 border-b border-border-1 px-3 py-2"
          onSubmit={(event) => { event.preventDefault(); if (sessionId && target.trim()) load(setJavaOsgiTarget(sessionId, target.trim())) }}
        >
          <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Target platform: bundles folder, Eclipse install or .target file" className="gs-input flex-1 font-mono" aria-label="Target platform path" />
          <button type="button" className="gs-btn shrink-0" onClick={() => { void browse() }} disabled={busy}><FolderOpen size={13} /> Browse…</button>
          <button type="submit" className="gs-btn shrink-0" disabled={busy || !target.trim()}>Apply</button>
        </form>
        <div className="flex items-center gap-2 border-b border-border-1 px-3 py-2">
          <Search size={14} className="text-text-3" />
          <input data-autofocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by bundle name" className="gs-input flex-1" />
          <label className="flex shrink-0 items-center gap-1 text-[11px] text-text-3">
            <input type="checkbox" checked={issuesOnly} onChange={(event) => setIssuesOnly(event.target.checked)} /> Missing dependencies only
          </label>
        </div>
        {busy && <p className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" /> A full Eclipse target has about a thousand bundles: this can take a few seconds.</p>}
        {error && <p className="whitespace-pre-wrap px-3 py-3 text-[11px] text-danger">{error}</p>}
        <div className="min-h-0 flex-1 overflow-auto">
          {withContentKeys(visible, (bundle) => `${bundle.symbolicName}:${bundle.version}:${bundle.location}`).map(({ key, item }) => <BundleRow key={key} bundle={item} />)}
          {empty && (
            <p className="px-3 py-3 text-[11px] text-text-3">
              No OSGi bundles here: a bundle is an Eclipse project (.project) with META-INF/MANIFEST.MF.
              {report.otherProjects > 0 && ` Found ${report.otherProjects} Eclipse project(s) without a manifest; bnd workspaces, which generate it at build time, are not supported yet.`}
            </p>
          )}
          {!empty && report && visible.length === 0 && <p className="px-3 py-3 text-[11px] text-text-3">Nothing matches.</p>}
          {problems.length > 0 && (
            <section aria-label="Problems" className="px-3 py-2">
              <h3 className="pb-1 text-[11px] font-medium text-text-2">Problems ({problems.length})</h3>
              {withContentKeys(problems, (problem) => `${problem.severity}:${problem.file}:${problem.message}`).map(({ key, item }) => (
                <p key={key} className={`text-[11px] ${item.severity === 'error' ? 'text-danger' : 'text-warning'}`}>{item.file ? `${item.file}: ` : ''}{item.message}</p>
              ))}
            </section>
          )}
        </div>
      </div>
    </CodeStudioModal>
  )
}

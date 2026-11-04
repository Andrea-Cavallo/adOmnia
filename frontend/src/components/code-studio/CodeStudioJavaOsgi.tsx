import { useEffect, useMemo, useState } from 'react'
import { Boxes, FileCode2, FolderOpen, FolderPlus, Hammer, Loader2, Play, RefreshCw, Search } from 'lucide-react'
import { CodeStudioModal } from './CodeStudioModal'
import { getJavaOsgiWorkspace, importJavaOsgiPlugins, reindexJavaOsgiTarget, selectGoIDEFile, selectGoIDEFolder, selectGoIDEFolders, setJavaOsgiTarget, startJavaOsgiBuild, startJavaOsgiRun, subscribeGoIDEEvents } from '@/lib/code-studio-api'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { studioToast } from '@/stores/codeStudioToast'
import { CodeStudioJavaOsgiP2 } from './CodeStudioJavaOsgiP2'
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

/** Payload di `osgi.build` (codestudio.OsgiBuildEvent, inviato come evento e non come modello dei binding). */
interface OsgiBuildEvent {
  done: number
  total: number
  bundle: string
  finished: boolean
  stopped: boolean
  errors: number
  problems: string[]
}

function subtitleOf(report: WorkspaceReport | null, busy: boolean): string {
  if (busy) return 'Reading manifests…'
  if (!report) return ''
  const bundles = `${report.bundles?.length ?? 0} workspace bundle(s)`
  if (!report.hasTarget) return `${bundles} · choose a target platform to resolve them`
  return `${bundles} · ${report.targetBundles} in target · ${report.unresolved} unresolved`
}

/** Avvia una build o una Run dal pannello: l'output è nella console Run, gli errori in Problems. */
export function runOsgiBuild(sessionId: string): void {
  useCodeStudioLspStore.getState().showToolWindow('run')
  startJavaOsgiBuild(sessionId).catch((reason: unknown) => studioToast(messageOf(reason), 'info'))
}

export function runOsgiFramework(sessionId: string): void {
  useCodeStudioLspStore.getState().showToolWindow('run')
  startJavaOsgiRun(sessionId)
    .then((problems) => { if (problems.length > 0) studioToast(`${problems.length} bundle problem(s) at runtime: ${problems[0]}`, 'info') })
    .catch((reason: unknown) => studioToast(messageOf(reason), 'info'))
}

/** Esito di una build: i problemi che non hanno un file e una riga (dipendenze, bytecode) stanno solo qui. */
export function buildOutcomeMessage(outcome: Pick<OsgiBuildEvent, 'done' | 'total' | 'stopped' | 'errors' | 'problems'>): string {
  if (outcome.stopped) return `Build stopped after ${outcome.done} of ${outcome.total} bundle(s)`
  const base = outcome.errors > 0 ? `${outcome.errors} compile error(s) in ${outcome.total} bundle(s): see Problems` : `${outcome.total} bundle(s) compiled`
  const first = outcome.problems?.[0]
  if (!first) return base
  const others = outcome.problems.length > 1 ? ` (+${outcome.problems.length - 1} more)` : ''
  return `${base}. ${first}${others}`
}

function announceBuildOutcome(outcome: OsgiBuildEvent): void {
  const clean = outcome.errors === 0 && !outcome.stopped && (outcome.problems?.length ?? 0) === 0
  studioToast(buildOutcomeMessage(outcome), clean ? 'success' : 'info')
  if (outcome.errors > 0) useCodeStudioLspStore.getState().showToolWindow('problems')
}

/** Target platform e stato dei bundle, come il Plug-in Manifest Editor di Eclipse: dice perché un bundle non si risolve. */
export function CodeStudioJavaOsgi() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  useEffect(() => subscribeGoIDEEvents((event) => {
    if (event.type !== 'osgi.build') return
    const outcome = event.payload as OsgiBuildEvent
    if (outcome.finished) announceBuildOutcome(outcome)
  }), [])
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

  // Native pickers choose either files or folders: two buttons, one click each.
  const browseFolder = async (): Promise<void> => {
    const folder = await selectGoIDEFolder('Target platform: a folder of bundles or an Eclipse installation')
    if (folder && sessionId) load(setJavaOsgiTarget(sessionId, folder))
  }
  const browseTargetFile = async (): Promise<void> => {
    const file = await selectGoIDEFile('Target platform: an Eclipse .target definition', 'Target definitions (*.target)', '*.target')
    if (file && sessionId) load(setJavaOsgiTarget(sessionId, file))
  }

  // One dialog, several folders: each plug-in project lands under plugins/ of this workspace.
  const importPlugins = async (): Promise<void> => {
    if (!sessionId) return
    const folders = await selectGoIDEFolders('Import plug-in projects into this workspace (they are copied under plugins/)')
    if (folders.length === 0) return
    setBusy(true)
    setError('')
    try {
      const result = await importJavaOsgiPlugins(sessionId, folders)
      if (result.report) setReport(result.report)
      else if (result.imported.length > 0) load(getJavaOsgiWorkspace(sessionId))
      const first = result.skipped?.[0]
      const skipped = result.skipped?.length ?? 0
      const imported = result.imported?.length ?? 0
      if (imported === 0 && skipped > 0) setError(`Nothing imported.\n${result.skipped.join('\n')}`)
      else if (skipped > 0) studioToast(`${imported} plug-in(s) imported. ${skipped} skipped: ${first}`, 'info')
      else studioToast(`${imported} plug-in(s) imported`, 'success')
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
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
          <button type="button" className="gs-btn shrink-0" onClick={() => { void browseFolder() }} disabled={busy} title="A folder of bundles or an Eclipse installation"><FolderOpen size={13} /> Folder…</button>
          <button type="button" className="gs-btn shrink-0" onClick={() => { void browseTargetFile() }} disabled={busy} title="An Eclipse .target definition"><FileCode2 size={13} /> .target…</button>
          <button type="submit" className="gs-btn shrink-0" disabled={busy || !target.trim()}>Apply</button>
          <button type="button" className="gs-btn gs-btn-icon shrink-0" onClick={() => { if (sessionId) load(reindexJavaOsgiTarget(sessionId)) }} disabled={busy || !report?.hasTarget} title="Reindex: read every manifest of the target again" aria-label="Reindex target platform"><RefreshCw size={13} /></button>
        </form>
        {sessionId && report?.hasTarget && <CodeStudioJavaOsgiP2 sessionId={sessionId} targetPath={report.targetPath} onDownloaded={() => load(getJavaOsgiWorkspace(sessionId))} />}
        <div className="flex items-center gap-2 border-b border-border-1 px-3 py-2">
          <Search size={14} className="text-text-3" />
          <input data-autofocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by bundle name" className="gs-input flex-1" />
          <label className="flex shrink-0 items-center gap-1 text-[11px] text-text-3">
            <input type="checkbox" checked={issuesOnly} onChange={(event) => setIssuesOnly(event.target.checked)} /> Missing dependencies only
          </label>
          <button type="button" className="gs-btn shrink-0" disabled={busy || !report?.hasTarget} onClick={() => { if (sessionId) { runOsgiBuild(sessionId); setSessionId(null) } }} title="Compile with the Eclipse compiler of the target, on the project JVM (Java > Select JDK)"><Hammer size={13} /> Build</button>
          <button type="button" className="gs-btn shrink-0" disabled={busy || !report?.hasTarget} onClick={() => { if (sessionId) { runOsgiFramework(sessionId); setSessionId(null) } }} title="Start the compiled bundles in Equinox, on the project JVM"><Play size={13} /> Run</button>
          <button type="button" className="gs-btn shrink-0" disabled={busy} onClick={() => { void importPlugins() }} title="Import plug-in projects from this machine: they are copied under plugins/ so several repositories compile together"><FolderPlus size={13} /> Import…</button>
        </div>
        {busy && <p className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" /> A full Eclipse target has about a thousand bundles: this can take a few seconds.</p>}
        {error && <p className="whitespace-pre-wrap px-3 py-3 text-[11px] text-danger">{error}</p>}
        <div className="min-h-0 flex-1 overflow-auto">
          {withContentKeys(visible, (bundle) => `${bundle.symbolicName}:${bundle.version}:${bundle.location}`).map(({ key, item }) => <BundleRow key={key} bundle={item} />)}
          {empty && (
            <p className="px-3 py-3 text-[11px] text-text-3">
              No OSGi bundles here: a bundle is an Eclipse project (.project) with META-INF/MANIFEST.MF.
              {' '}Use Import… to bring the plug-in projects of another repository into plugins/ of this workspace.
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

import { useEffect, useMemo, useState } from 'react'
import { Library, Loader2, Package, RefreshCw, Search } from 'lucide-react'
import { resolveJavaLibrarySource, type GoIDEDependencySource, type GoIDESession, type JavaLibrary } from '@/lib/code-studio-api'
import { libraryCoordinate, libraryOfSourcesPath, shortGroup } from '@/lib/code-studio/javaLibraries'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useJavaLibrariesStore } from '@/stores/codeStudioJavaLibraries'
import { downloadLibrarySources } from './codeStudioJavaLibrarySource'
import { ExternalFolder, ExternalNote, ExternalRow, reasonText } from './CodeStudioExternalTree'
import { TreeChevron } from './codeStudioTreeRow'

/** Sopra questa soglia l'elenco mostra il filtro: un progetto Spring ne ha facilmente un centinaio. */
const FILTER_THRESHOLD = 15

function libraryTitle(library: JavaLibrary): string {
  const where = library.modules.map((module) => module || '(root)').join(', ')
  return `${libraryCoordinate(library)}${library.scope ? ` · ${library.scope}` : ''} · ${library.direct ? 'declared in a pom' : 'transitive'} · ${where}${library.downloaded ? '' : ' · not downloaded yet'}`
}

interface LibraryNodeProps {
  sessionId: string
  library: JavaLibrary
  revealFile: string | null
}

function JavaLibraryNode({ sessionId, library, revealFile }: LibraryNodeProps) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<GoIDEDependencySource | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (revealFile !== null) setOpen(true)
  }, [revealFile])
  useEffect(() => {
    if (!open) return
    let current = true
    const request = resolveJavaLibrarySource(sessionId, library.groupId, library.artifactId, library.version)
    request.then((next) => { if (current) { setSource(next); setError('') } }).catch((reason: unknown) => { if (current) setError(reasonText(reason)) })
    return () => { current = false; request.cancel() }
  }, [attempt, library.artifactId, library.groupId, library.version, open, sessionId])

  const download = async () => {
    setBusy(true)
    if (await downloadLibrarySources(sessionId, library)) setAttempt((value) => value + 1)
    setBusy(false)
  }
  return (
    <>
      <ExternalRow depth={2} open={open} onOpenChange={setOpen} muted={!library.direct} title={libraryTitle(library)}>
        <TreeChevron open={open} />
        <Package size={14} className="shrink-0 text-text-3" aria-hidden="true" />
        <span className="min-w-0 shrink truncate">{library.artifactId}</span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-text-4">{shortGroup(library.groupId)}</span>
        {library.scope && library.scope !== 'compile' && <span className="shrink-0 rounded bg-surface-3 px-1 text-[10px] leading-4 text-text-3">{library.scope}</span>}
        <span className="max-w-[35%] shrink-0 truncate font-mono text-[10px] text-text-4">{library.version}</span>
      </ExternalRow>
      {open && error && <ExternalNote depth={3} tone="text-danger">{error}</ExternalNote>}
      {open && !error && !source && <ExternalNote depth={3}><Loader2 size={12} className="animate-spin" /> Preparing the sources…</ExternalNote>}
      {open && source?.downloaded && <ExternalFolder sessionId={sessionId} source={source} relative="" depth={3} revealFile={revealFile} />}
      {open && source && !source.downloaded && (
        <ExternalNote depth={3}>
          <span className="min-w-0">{library.downloaded ? 'No sources jar in the local Maven repository.' : 'Not downloaded yet: build the project once.'}</span>
          <button type="button" disabled={busy} onClick={() => void download()} className="shrink-0 rounded px-1.5 text-accent hover:bg-surface-2 disabled:opacity-50">{busy ? 'Downloading…' : 'Download sources'}</button>
        </ExternalNote>
      )}
    </>
  )
}

interface CodeStudioJavaLibrariesProps {
  session: GoIDESession
  /** Percorso del documento esterno attivo: se è dei sorgenti di una libreria, l'albero si apre fin lì. */
  activeExternalPath: string | null
  collapseEpoch: number
}

/**
 * Le librerie Maven del progetto come nodo dell'albero, come External Libraries per Go: transitive comprese,
 * dai pom e dal repository locale. Il codice viene dal jar dei sorgenti, in sola lettura.
 */
export function CodeStudioJavaLibraries({ session, activeExternalPath, collapseEpoch }: CodeStudioJavaLibrariesProps) {
  const sessionId = session.id
  const hasMaven = (session.project.units ?? []).some((unit) => unit.language === 'java' && unit.kind === 'maven')
  const state = useJavaLibrariesStore((store) => store.bySession[sessionId])
  const load = useJavaLibrariesStore((store) => store.load)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Un pom salvato cambia le dipendenze: l'elenco si rilegge come External Libraries rilegge il go.mod.
  const pomContent = useCodeStudioStore((store) => store.documents.filter((item) => item.document.sessionId === sessionId && item.document.name === 'pom.xml').map((item) => item.savedContent).join('\0'))
  const needed = open || !!activeExternalPath

  useEffect(() => {
    if (hasMaven && needed) void load(sessionId, true)
  }, [hasMaven, load, needed, pomContent, sessionId])

  const libraries = useMemo(() => state?.result?.libraries ?? [], [state?.result])
  const reveal = useMemo(() => (activeExternalPath ? libraryOfSourcesPath(activeExternalPath, libraries) : null), [activeExternalPath, libraries])
  const revealKey = reveal ? libraryCoordinate(reveal.library) : null
  useEffect(() => {
    if (revealKey) setOpen(true)
  }, [revealKey])
  useEffect(() => {
    if (collapseEpoch) setOpen(false)
  }, [collapseEpoch])

  const needle = query.trim().toLowerCase()
  const visible = needle ? libraries.filter((library) => libraryCoordinate(library).toLowerCase().includes(needle)) : libraries
  if (!hasMaven) return null
  const direct = libraries.filter((library) => library.direct).length
  return (
    <div className="mt-1 border-t border-border-1/60 pt-1" data-java-libraries>
      <div
        role="treeitem"
        data-tree-external
        aria-level={1}
        aria-expanded={open}
        aria-selected={false}
        tabIndex={-1}
        title="Source code of the Maven dependencies, read-only"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen((value) => !value) }
          if (event.key === 'ArrowRight') { event.preventDefault(); setOpen(true) }
          if (event.key === 'ArrowLeft') { event.preventDefault(); setOpen(false) }
        }}
        className="code-studio-tree-row flex h-7 cursor-pointer items-center gap-1.5 rounded pl-1.5 pr-1 text-xs text-text-2 hover:bg-surface-2/60 hover:text-text-1"
      >
        <TreeChevron open={open} />
        <Library size={14} className="shrink-0 text-text-3" aria-hidden="true" />
        <span className="min-w-0 truncate">External Libraries</span>
        <span className="shrink-0 rounded bg-surface-3 px-1 text-[10px] leading-4 text-text-3">Maven</span>
        <span className="flex-1" />
        {state?.result && <span className="shrink-0 font-mono text-[10px] text-text-4" title={`${direct} declared, ${libraries.length - direct} transitive`}>{libraries.length}</span>}
        <button
          type="button"
          disabled={state?.loading}
          aria-label="Reload Maven libraries"
          title="Reload · re-read the poms and the local Maven repository"
          onClick={(event) => { event.stopPropagation(); setOpen(true); void load(sessionId, true) }}
          className="code-studio-icon-button h-5 w-5 shrink-0 disabled:opacity-50"
        >
          <RefreshCw size={12} className={state?.loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {open && libraries.length > FILTER_THRESHOLD && (
        <label className="mx-2 my-1 flex h-6 items-center gap-1.5 rounded border border-border-1 bg-surface-1 px-1.5 focus-within:border-accent/60">
          <Search size={11} className="shrink-0 text-text-4" />
          <span className="sr-only">Filter libraries</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter libraries" className="min-w-0 flex-1 bg-transparent text-[11px] text-text-1 outline-none placeholder:text-text-4" />
        </label>
      )}
      {open && state?.error && <ExternalNote depth={2} tone="text-danger">{state.error}</ExternalNote>}
      {open && !state?.result && !state?.error && <ExternalNote depth={2}><Loader2 size={12} className="animate-spin" /> Reading the poms…</ExternalNote>}
      {open && state?.result?.warnings.map((warning) => <ExternalNote key={warning} depth={2} tone="text-warning">{warning}</ExternalNote>)}
      {open && state?.result && libraries.length === 0 && <ExternalNote depth={2}>No dependencies in the poms.</ExternalNote>}
      {open && needle && visible.length === 0 && <ExternalNote depth={2}>Nothing matches.</ExternalNote>}
      {open && <div role="group">{visible.map((library) => {
        const key = libraryCoordinate(library)
        return <JavaLibraryNode key={key} sessionId={sessionId} library={library} revealFile={revealKey === key && reveal ? reveal.file : null} />
      })}</div>}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpCircle, Check, Library, Loader2, Package } from 'lucide-react'
import { goModules } from '@/lib/code-studio/goProject'
import { listGoIDEDependencies, listGoIDEDependencyUpdates, resolveGoIDEDependencySource, type GoIDEDependencySource, type GoIDESession } from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { ensureGoModDependencySource } from './codeStudioDependencySource'
import { ExternalFolder, ExternalNote, ExternalRow, reasonText } from './CodeStudioExternalTree'
import { displayName, displayVersion, libraryOfPath, mergeLibraries, type ExternalLibrary } from '@/lib/code-studio/externalLibraries'
import { TreeChevron } from './codeStudioTreeRow'

function libraryKey(library: Pick<ExternalLibrary, 'path' | 'version'>): string {
  return `${library.path}@${library.version}`
}

interface LibraryNodeProps {
  sessionId: string
  library: ExternalLibrary
  /** Versione più recente trovata; undefined se il controllo non è stato fatto, null se è già l'ultima. */
  latest: string | null | undefined
  revealFile: string | null
}

function LibraryNode({ sessionId, library, latest, revealFile }: LibraryNodeProps) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<GoIDEDependencySource | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resolution, setResolution] = useState(0)
  useEffect(() => {
    if (revealFile !== null) setOpen(true)
  }, [revealFile])
  useEffect(() => {
    if (!open) return
    let current = true
    const request = resolveGoIDEDependencySource(sessionId, library.moduleDirectory, library.path)
    request.then((next) => { if (current) { setSource(next); setError('') } }).catch((reason: unknown) => { if (current) setError(reasonText(reason)) })
    return () => { current = false; request.cancel() }
  }, [library.moduleDirectory, library.path, library.version, open, resolution, sessionId])

  const download = async () => {
    setBusy(true)
    const next = await ensureGoModDependencySource(sessionId, library.moduleDirectory, library.path)
    if (next) setSource(next)
    setBusy(false)
  }
  const detectSdk = async () => {
    setBusy(true)
    await useCodeStudioStore.getState().detectToolchain()
    setResolution((value) => value + 1)
    setBusy(false)
  }
  const installed = displayVersion(library.version)
  const replacedLabel = library.local ? 'local' : 'replaced'
  return (
    <>
      <ExternalRow depth={2} open={open} onOpenChange={setOpen} muted={library.indirect} title={`${library.path} ${library.version}${library.indirect ? ' (indirect)' : ''}${library.replaced ? ` (${replacedLabel})` : ''}`}>
        <TreeChevron open={open} />
        <Package size={14} className="shrink-0 text-text-3" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{displayName(library.path)}</span>
        {library.replaced && <span className="shrink-0 rounded bg-surface-3 px-1 text-[10px] leading-4 text-text-3">{replacedLabel}</span>}
        {latest && <span className="shrink-0 font-mono text-[10px] text-warning" title={`Newer version available: ${latest} (installed ${library.version})`}>↑ {displayVersion(latest)}</span>}
        {latest === null && <Check size={12} className="shrink-0 text-success" aria-label="Up to date" />}
        <span className="max-w-[45%] shrink-0 truncate font-mono text-[10px] text-text-4">{installed}</span>
      </ExternalRow>
      {open && error && <ExternalNote depth={3} tone="text-danger">{error}</ExternalNote>}
      {open && !error && !source && <ExternalNote depth={3}><Loader2 size={12} className="animate-spin" /> Locating the source…</ExternalNote>}
      {open && source?.downloaded && <ExternalFolder sessionId={sessionId} source={source} relative="" depth={3} revealFile={revealFile} />}
      {open && source && !source.downloaded && (
        <ExternalNote depth={3}>
          <span className="min-w-0">{source.reason || 'The source of this module is not available.'}</span>
          {source.found && <button type="button" disabled={busy} onClick={() => void (source.directory ? download() : detectSdk())} className="shrink-0 rounded px-1.5 text-accent hover:bg-surface-2 disabled:opacity-50">{busy ? 'Working…' : source.directory ? 'Download' : 'Detect SDK'}</button>}
        </ExternalNote>
      )}
    </>
  )
}

interface CodeStudioExternalLibrariesProps {
  session: GoIDESession
  /** Percorso del documento esterno attivo: se è di una dipendenza, l'albero si apre fin lì. */
  activeExternalPath: string | null
  /** Cresce con "Collapse all". */
  collapseEpoch: number
}

/**
 * Le dipendenze del go.mod come nodo dell'albero: codice da leggere, cartelle comprese, con la versione
 * installata in vista. Legge solo il filesystem; contatta il proxy Go solo con "Check for newer versions".
 */
export function CodeStudioExternalLibraries({ session, activeExternalPath, collapseEpoch }: CodeStudioExternalLibrariesProps) {
  const sessionId = session.id
  const modules = useMemo(() => goModules(session.project), [session.project])
  const [open, setOpen] = useState(false)
  const [libraries, setLibraries] = useState<ExternalLibrary[] | null>(null)
  const [error, setError] = useState('')
  // Chiave modulo@versione → ultima versione; null finché il controllo non è stato fatto.
  const [updates, setUpdates] = useState<ReadonlyMap<string, string> | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')
  const checks = useRef<Array<{ cancel: () => void }>>([])
  const goModContent = useCodeStudioStore((state) => state.documents.filter((item) => item.document.sessionId === sessionId && item.document.name === 'go.mod').map((item) => item.savedContent).join('\0'))
  const finishedRuns = useCodeStudioStore((state) => state.executions.filter((item) => item.sessionId === sessionId && item.kind === 'dependency' && item.status !== 'running').length)
  const moduleKey = modules.map((module) => module.path).join('\n')
  const needed = open || !!activeExternalPath

  useEffect(() => {
    if (!needed || modules.length === 0) return
    let current = true
    const load = async () => {
      const results = await Promise.allSettled(modules.map((module) => listGoIDEDependencies(sessionId, module.path)))
      const states = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
      const failure = results.find((result) => result.status === 'rejected')
      const merged = mergeLibraries(states, new Set(modules.flatMap((module) => module.modulePath ?? [])))
      const located = await Promise.all(merged.map(async (library) => {
        if (!library.replaced) return library
        try {
          return { ...library, directory: (await resolveGoIDEDependencySource(sessionId, library.moduleDirectory, library.path)).directory }
        } catch {
          // Una replace senza cartella resta nell'elenco: il motivo compare aprendo il suo nodo.
          return library
        }
      }))
      if (!current) return
      setLibraries(located)
      setError(states.length === 0 && failure ? reasonText(failure.reason) : '')
    }
    void load()
    return () => { current = false }
  }, [finishedRuns, goModContent, moduleKey, needed, sessionId])

  useEffect(() => () => { checks.current.forEach((request) => request.cancel()) }, [])

  const reveal = useMemo(() => (activeExternalPath && libraries ? libraryOfPath(activeExternalPath, libraries) : null), [activeExternalPath, libraries])
  const revealKey = reveal ? libraryKey(reveal.library) : null
  useEffect(() => {
    if (revealKey) setOpen(true)
  }, [revealKey])
  useEffect(() => {
    if (collapseEpoch) setOpen(false)
  }, [collapseEpoch])

  if (modules.length === 0) return null

  const checkUpdates = async () => {
    setChecking(true)
    setCheckError('')
    const requests = modules.map((module) => listGoIDEDependencyUpdates(sessionId, module.path))
    checks.current = requests
    const results = await Promise.allSettled(requests)
    if (checks.current !== requests) return
    const found = new Map<string, string>()
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      for (const update of result.value) {
        if (update.latest) found.set(libraryKey(update), update.latest)
      }
    }
    const failure = results.find((result) => result.status === 'rejected')
    // Se tutti i controlli falliscono non sappiamo nulla: nessuna spunta "aggiornato" mostrata a torto.
    setUpdates(results.some((result) => result.status === 'fulfilled') ? found : null)
    setCheckError(failure ? reasonText(failure.reason) : '')
    setChecking(false)
  }

  const newer = libraries?.filter((library) => updates?.has(libraryKey(library))).length ?? 0
  return (
    <div className="mt-1 border-t border-border-1/60 pt-1">
      <div
        role="treeitem"
        data-tree-external
        aria-level={1}
        aria-expanded={open}
        aria-selected={false}
        tabIndex={-1}
        title="Source code of the go.mod dependencies, read-only"
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
        <span className="min-w-0 flex-1 truncate">External Libraries</span>
        {libraries && <span className="shrink-0 font-mono text-[10px] text-text-4">{libraries.length}</span>}
        {updates && libraries && (newer > 0
          ? <span className="shrink-0 font-mono text-[10px] text-warning" title={`${newer} of these modules have a newer version`}>{newer} ↑</span>
          : <Check size={12} className="shrink-0 text-success" aria-label="All modules are up to date" />)}
        <button
          type="button"
          disabled={checking}
          aria-label="Check for newer versions"
          title="Check for newer versions · go list -m -u, contacts the configured Go proxy"
          onClick={(event) => { event.stopPropagation(); setOpen(true); void checkUpdates() }}
          className="code-studio-icon-button h-5 w-5 shrink-0 disabled:opacity-50"
        >
          {checking ? <Loader2 size={13} className="animate-spin" /> : <ArrowUpCircle size={13} />}
        </button>
      </div>
      {checkError && <div className="line-clamp-3 px-2 py-1 text-[11px] text-danger" title={checkError}>{checkError}</div>}
      {open && error && <ExternalNote depth={2} tone="text-danger">{error}</ExternalNote>}
      {open && !error && !libraries && <ExternalNote depth={2}><Loader2 size={12} className="animate-spin" /> Reading go.mod…</ExternalNote>}
      {open && libraries?.length === 0 && !error && <ExternalNote depth={2}>No external modules in go.mod.</ExternalNote>}
      {open && <div role="group">{libraries?.map((library) => {
        const key = libraryKey(library)
        // Una replace locale non ha un "ultimo" da confrontare: il suo codice è già quello della cartella.
        const latest = !updates || library.local ? undefined : updates.get(key) ?? null
        return <LibraryNode key={key} sessionId={sessionId} library={library} latest={latest} revealFile={revealKey === key && reveal ? reveal.file : null} />
      })}</div>}
    </div>
  )
}

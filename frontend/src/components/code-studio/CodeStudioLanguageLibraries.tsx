/**
 * External Libraries per i linguaggi senza un repository di pacchetti con layout Maven/Go: Python
 * (pacchetti installati in site-packages) e C/C++ (dipendenze dichiarate in CMake/FetchContent/vcpkg/
 * Conan/Meson). Riusa le righe comuni dell'albero: il codice di una dipendenza è una cartella in sola
 * lettura che si sfoglia e si apre come quella di Go e Maven.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Library, Loader2, Package, RefreshCw, Search } from 'lucide-react'
import {
  listNativeLibraries, listPythonLibraries, resolveNativeLibrarySource, resolvePythonLibrarySource,
  type GoIDEDependencySource, type GoIDESession, type LanguageLibraries, type LanguageLibrary,
} from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { ExternalFolder, ExternalNote, ExternalRow, reasonText } from './CodeStudioExternalTree'
import { TreeChevron } from './codeStudioTreeRow'

export type LibraryLanguage = 'python' | 'native'

const FILTER_THRESHOLD = 15

const CONFIG: Record<LibraryLanguage, {
  badge: string
  title: string
  loading: string
  empty: string
  reload: string
  list: (sessionId: string) => ReturnType<typeof listPythonLibraries>
  resolve: (sessionId: string, library: LanguageLibrary) => ReturnType<typeof resolvePythonLibrarySource>
}> = {
  python: {
    badge: 'Python',
    title: 'Source code of the installed Python packages, read-only',
    loading: 'Reading site-packages…',
    empty: 'No packages in the selected environment.',
    reload: 'Reload Python libraries',
    list: listPythonLibraries,
    resolve: (sessionId, library) => resolvePythonLibrarySource(sessionId, library.name),
  },
  native: {
    badge: 'C/C++',
    title: 'Dependencies declared by the C/C++ build files, read-only',
    loading: 'Reading the build files…',
    empty: 'No dependencies declared in the build files.',
    reload: 'Reload C/C++ libraries',
    list: listNativeLibraries,
    resolve: (sessionId, library) => resolveNativeLibrarySource(sessionId, library.name, library.module ?? ''),
  },
}

function normalized(path: string): string {
  return path.replace(/\\/g, '/')
}

function within(path: string, directory: string): boolean {
  const target = normalized(path).toLowerCase()
  const parent = normalized(directory).replace(/\/+$/, '').toLowerCase()
  return !!parent && (target === parent || target.startsWith(`${parent}/`))
}

function revealIn(path: string | null, directory: string | undefined): string | null {
  if (!path || !directory || !within(path, directory)) return null
  const target = normalized(path)
  const parent = normalized(directory).replace(/\/+$/, '')
  return target.slice(parent.length + 1)
}

const PYTHON_FILES = /(^|\/)(pyproject\.toml|requirements[^/]*\.txt|poetry\.lock|uv\.lock|Pipfile|Pipfile\.lock|setup\.cfg|setup\.py)$/i
const NATIVE_FILES = /(^|\/)(CMakeLists\.txt|[^/]+\.cmake|meson\.build|meson_options\.txt|vcpkg\.json|conanfile\.(txt|py))$/i

function isBuildConfig(language: LibraryLanguage, relativePath: string): boolean {
  return (language === 'python' ? PYTHON_FILES : NATIVE_FILES).test(relativePath)
}

function libraryTitle(library: LanguageLibrary): string {
  const parts = [library.name]
  if (library.version) parts.push(library.version)
  if (library.scope) parts.push(library.scope)
  parts.push(library.direct ? 'declared' : 'transitive')
  if (library.module) parts.push(library.module)
  if (library.kind) parts.push(library.kind)
  if (library.note) parts.push(library.note)
  return parts.join(' · ')
}

function kindLabel(library: LanguageLibrary, language: LibraryLanguage): string | null {
  if (library.scope === 'dev') return 'dev'
  if (language === 'python') return library.available ? null : 'not installed'
  if (library.kind === 'cmake' || library.kind === 'pkgconfig' || library.kind === 'meson') return library.available ? library.kind : 'system'
  return library.kind ?? null
}

interface LibraryNodeProps {
  sessionId: string
  language: LibraryLanguage
  library: LanguageLibrary
  revealFile: string | null
}

function LanguageLibraryNode({ sessionId, language, library, revealFile }: LibraryNodeProps) {
  const config = CONFIG[language]
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<GoIDEDependencySource | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (revealFile !== null) setOpen(true)
  }, [revealFile])
  useEffect(() => {
    if (!open || !library.available) return
    let current = true
    const request = config.resolve(sessionId, library)
    request.then((next) => { if (current) { setSource(next); setError('') } }).catch((reason: unknown) => { if (current) setError(reasonText(reason)) })
    return () => { current = false; request.cancel() }
  }, [config, library, open, sessionId])
  const badge = kindLabel(library, language)
  return (
    <>
      <ExternalRow
        depth={2}
        open={library.available ? open : undefined}
        onOpenChange={library.available ? setOpen : undefined}
        muted={!library.direct}
        title={libraryTitle(library)}
      >
        {library.available ? <TreeChevron open={open} /> : <span className="w-3 shrink-0" />}
        <Package size={14} className="shrink-0 text-text-3" aria-hidden="true" />
        <span className="min-w-0 shrink truncate">{library.name}</span>
        {library.module && library.module !== '.' && <span className="min-w-0 flex-1 truncate text-[10px] text-text-4">{library.module}</span>}
        <span className="flex-1" />
        {badge && <span className="shrink-0 rounded bg-surface-3 px-1 text-[10px] leading-4 text-text-3">{badge}</span>}
        {library.version && <span className="max-w-[35%] shrink-0 truncate font-mono text-[10px] text-text-4">{library.version}</span>}
      </ExternalRow>
      {open && error && <ExternalNote depth={3} tone="text-danger">{error}</ExternalNote>}
      {open && library.available && !error && !source && <ExternalNote depth={3}><Loader2 size={12} className="animate-spin" /> Preparing the sources…</ExternalNote>}
      {open && source && !source.found && <ExternalNote depth={3}>{source.reason || 'The source of this dependency is not available.'}</ExternalNote>}
      {open && source?.found && <ExternalFolder sessionId={sessionId} source={source} relative="" depth={3} revealFile={revealFile} />}
      {!open && !library.available && library.note && <ExternalNote depth={3}>{library.note}</ExternalNote>}
    </>
  )
}

interface CodeStudioLanguageLibrariesProps {
  session: GoIDESession
  language: LibraryLanguage
  /** Percorso del documento esterno attivo: se è di una libreria, l'albero si apre fin lì. */
  activeExternalPath: string | null
  collapseEpoch: number
}

export function CodeStudioLanguageLibraries({ session, language, activeExternalPath, collapseEpoch }: CodeStudioLanguageLibrariesProps) {
  const config = CONFIG[language]
  const sessionId = session.id
  const hasUnits = (session.project.units ?? []).some((unit) => unit.language === (language === 'python' ? 'python' : 'cpp'))
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<LanguageLibraries | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const flight = useRef(0)
  const buildContent = useCodeStudioStore((store) => store.documents
    .filter((item) => item.document.sessionId === sessionId && isBuildConfig(language, item.document.relativePath))
    .map((item) => item.savedContent)
    .join('\0'))

  const load = useCallback(async () => {
    const ticket = ++flight.current
    setLoading(true)
    try {
      const next = await config.list(sessionId)
      if (ticket !== flight.current) return
      setResult(next)
      setError('')
    } catch (reason) {
      if (ticket === flight.current) setError(reasonText(reason))
    } finally {
      if (ticket === flight.current) setLoading(false)
    }
  }, [config, sessionId])

  const needed = open || !!activeExternalPath
  useEffect(() => {
    if (hasUnits && needed) void load()
  }, [buildContent, hasUnits, load, needed])

  const libraries = useMemo(() => result?.libraries ?? [], [result?.libraries])
  const reveal = useMemo(
    () => (activeExternalPath ? libraries.find((library) => library.directory && within(activeExternalPath, library.directory)) ?? null : null),
    [activeExternalPath, libraries],
  )
  useEffect(() => {
    if (reveal) setOpen(true)
  }, [reveal])
  useEffect(() => {
    if (collapseEpoch) setOpen(false)
  }, [collapseEpoch])

  if (!hasUnits) return null
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? libraries.filter((library) => `${library.name} ${library.version ?? ''} ${library.module ?? ''}`.toLowerCase().includes(needle))
    : libraries
  const direct = libraries.filter((library) => library.direct).length
  return (
    <div className="mt-1 border-t border-border-1/60 pt-1" data-language-libraries={language}>
      <div
        role="treeitem"
        data-tree-external
        aria-level={1}
        aria-expanded={open}
        aria-selected={false}
        tabIndex={-1}
        title={config.title}
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
        <span className="shrink-0 rounded bg-surface-3 px-1 text-[10px] leading-4 text-text-3">{config.badge}</span>
        <span className="flex-1" />
        {result && <span className="shrink-0 font-mono text-[10px] text-text-4" title={`${direct} declared, ${libraries.length - direct} transitive`}>{libraries.length}</span>}
        <button
          type="button"
          disabled={loading}
          aria-label={config.reload}
          title="Reload · re-read the build files and the environment"
          onClick={(event) => { event.stopPropagation(); setOpen(true); void load() }}
          className="code-studio-icon-button h-5 w-5 shrink-0 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {open && libraries.length > FILTER_THRESHOLD && (
        <label className="mx-2 my-1 flex h-6 items-center gap-1.5 rounded border border-border-1 bg-surface-1 px-1.5 focus-within:border-accent/60">
          <Search size={11} className="shrink-0 text-text-4" />
          <span className="sr-only">Filter libraries</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter libraries" className="min-w-0 flex-1 bg-transparent text-[11px] text-text-1 outline-none placeholder:text-text-4" />
        </label>
      )}
      {open && error && <ExternalNote depth={2} tone="text-danger">{error}</ExternalNote>}
      {open && !result && !error && <ExternalNote depth={2}><Loader2 size={12} className="animate-spin" /> {config.loading}</ExternalNote>}
      {open && result?.warnings.map((warning) => <ExternalNote key={warning} depth={2} tone="text-warning">{warning}</ExternalNote>)}
      {open && result && libraries.length === 0 && <ExternalNote depth={2}>{config.empty}</ExternalNote>}
      {open && needle && visible.length === 0 && <ExternalNote depth={2}>Nothing matches.</ExternalNote>}
      {open && <div role="group">{visible.map((library) => (
        <LanguageLibraryNode
          key={`${library.name}:${library.module ?? ''}`}
          sessionId={sessionId}
          language={language}
          library={library}
          revealFile={reveal === library ? revealIn(activeExternalPath, library.directory) : null}
        />
      ))}</div>}
    </div>
  )
}

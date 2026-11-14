import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Package, Search } from 'lucide-react'
import { lookupJavaOsgiDependency } from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import type { DependencyLookup } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde/models'

interface CodeStudioJavaOsgiDependenciesProps {
  sessionId: string
  /** Apre un bundle nel tab Bundles. */
  onSelectBundle: (name: string) => void
}

/** Dependency Explorer: da una classe o un package a chi lo esporta, chi lo usa e chi lo usa senza dichiararlo. */
export function CodeStudioJavaOsgiDependencies({ sessionId, onSelectBundle }: Readonly<CodeStudioJavaOsgiDependenciesProps>) {
  const [query, setQuery] = useState('')
  const [lookup, setLookup] = useState<DependencyLookup | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = (): void => {
    const needle = query.trim()
    if (!needle) return
    setBusy(true)
    setError(null)
    lookupJavaOsgiDependency(sessionId, needle)
      .then((next) => setLookup(next))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form className="flex items-center gap-2 border-b border-border-1 px-3 py-2" onSubmit={(event) => { event.preventDefault(); run() }}>
        <Search size={13} className="shrink-0 text-text-3" aria-hidden="true" />
        <input
          className="gs-input min-w-0 flex-1"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Class or package, e.g. org.eclipse.swt.widgets.Shell"
          aria-label="Class or package"
        />
        <button type="submit" className="gs-btn shrink-0" disabled={busy || !query.trim()}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Find
        </button>
      </form>
      {error && <p className="px-3 py-2 text-[12px] text-danger">{error}</p>}
      {!lookup && !error && <p className="px-3 py-3 text-[12px] text-text-3">Which bundle provides a class, which workspace bundles use it and which use it without declaring it in MANIFEST.MF.</p>}
      {lookup && <LookupResult lookup={lookup} onSelectBundle={onSelectBundle} />}
    </div>
  )
}

function LookupResult({ lookup, onSelectBundle }: Readonly<{ lookup: DependencyLookup, onSelectBundle: (name: string) => void }>) {
  const open = (file: string, line: number): void => { void useCodeStudioStore.getState().openLocation(file, line, 1) }
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[12px]">
      <p className="text-text-2">
        Package <span className="font-mono text-text-1">{lookup.package}</span>
        {lookup.jre && <span className="text-text-3"> · provided by the JRE</span>}
        {lookup.missing > 0 && <span className="text-danger"> · {lookup.missing} bundle(s) use it without declaring it</span>}
      </p>

      <h3 className="mt-2 text-[11px] uppercase tracking-wide text-text-4">Exported by</h3>
      {lookup.providers.length === 0 && <p className="text-text-3">{lookup.jre ? 'The JRE (no bundle exports it).' : 'No bundle of the workspace or the target exports it.'}</p>}
      <ul>
        {lookup.providers.map((provider) => (
          <li key={`${provider.symbolicName}-${provider.version}`}>
            <button type="button" className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-surface-2" onClick={() => onSelectBundle(provider.symbolicName)}>
              <Package size={12} className="shrink-0 text-accent" aria-hidden="true" />
              <span className="truncate text-text-1">{provider.symbolicName} {provider.version}</span>
              <span className="text-text-4">{provider.source === 'workspace' ? 'workspace' : 'target'} · version {provider.exportVersion}</span>
            </button>
          </li>
        ))}
      </ul>

      <h3 className="mt-2 text-[11px] uppercase tracking-wide text-text-4">Used by</h3>
      {lookup.consumers.length === 0 && <p className="text-text-3">No workspace bundle imports it.</p>}
      <ul>
        {lookup.consumers.map((consumer) => (
          <li key={consumer.bundle} className="rounded px-1 py-1 hover:bg-surface-2">
            <div className="flex items-center gap-2">
              {consumer.problem
                ? <AlertTriangle size={12} className="shrink-0 text-danger" aria-hidden="true" />
                : <CheckCircle2 size={12} className="shrink-0 text-success" aria-hidden="true" />}
              <button type="button" className="truncate text-text-1 hover:underline" onClick={() => onSelectBundle(consumer.bundle)}>{consumer.bundle}</button>
              <span className="truncate text-text-3">{consumer.via ? `${consumer.via} ${consumer.requirement ?? ''}${consumer.provider ? ` → ${consumer.provider}` : ''}` : 'not declared'}</span>
              {consumer.file && (
                <button type="button" className="ml-auto shrink-0 font-mono text-text-4 hover:text-text-2" onClick={() => open(consumer.file ?? '', consumer.line ?? 1)}>
                  {consumer.file}:{consumer.line}
                </button>
              )}
            </div>
            {consumer.problem && <p className="pl-5 text-danger">{consumer.problem}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { ChevronRight, Library, Search } from 'lucide-react'
import type { GoIDEEditorLocation } from '@/lib/code-studio-lsp-api'
import { CodeStudioFileIcon } from './CodeStudioFileIcon'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { navigateToLocation } from './codeStudioLanguageFeatures'
import { groupByFile, groupUsagesByKind, hasUsageKinds } from './codeStudioUsages'

interface CodeStudioReferencesProps { sessionId: string }
const locationKey = (location: GoIDEEditorLocation) => `${location.uri}:${location.range.startLine}:${location.range.startColumn}`

function FileGroup({ file, locations, selected, onPick }: {
  file: string
  locations: GoIDEEditorLocation[]
  selected: string | null
  onPick: (location: GoIDEEditorLocation) => void
}) {
  const normalized = file.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  const name = normalized.slice(slash + 1)
  const directory = normalized.slice(0, slash + 1)
  return (
    <details open className="group/file min-w-0 border-b border-border-1 last:border-b-0">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded px-3 py-2 text-[13px] text-text-1 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden" title={file}>
        <ChevronRight size={14} aria-hidden="true" className="shrink-0 transition-transform group-open/file:rotate-90" />
        {locations[0].external ? <Library size={15} aria-label="External source" className="shrink-0 text-text-3" /> : <CodeStudioFileIcon name={name} relativePath={file} size={15} />}
        <span className="max-w-[60%] shrink-0 truncate font-semibold">{name}</span>
        <span className="min-w-0 truncate text-xs text-text-3">{directory}</span>
        <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-text-2" aria-label={`${locations.length} results in this file`}>{locations.length}</span>
      </summary>
      <div className="pb-2">
        {locations.map(location => {
          const active = selected === locationKey(location)
          return <button key={locationKey(location)} type="button" onClick={() => onPick(location)} aria-current={active ? 'location' : undefined}
            title={`${file}:${location.range.startLine}:${location.range.startColumn}\n${location.preview || ''}`}
            className={`grid min-h-10 w-full grid-cols-[48px_minmax(0,1fr)] items-start gap-3 border-l-2 py-2 pl-3 pr-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${active ? 'border-accent bg-surface-2' : 'border-transparent hover:bg-surface-2'}`}>
            <span className="select-none pt-px text-right font-mono text-xs leading-5 tabular-nums text-text-3" aria-label={`Line ${location.range.startLine}`}>{location.range.startLine}</span>
            <code className="min-w-0 whitespace-pre-wrap break-words font-mono text-[14px] leading-[22px] text-text-1 [overflow-wrap:anywhere]">{location.preview || '(No source preview available)'}</code>
          </button>
        })}
      </div>
    </details>
  )
}

const NO_LOCATIONS: never[] = []

/** Find Usages groups by usage kind and file; implementation results group only by file. */
export function CodeStudioReferences({ sessionId }: CodeStudioReferencesProps) {
  const view = useCodeStudioLspStore(state => state.references[sessionId] ?? null)
  const locations = view?.locations ?? NO_LOCATIONS
  const byKind = useMemo(() => hasUsageKinds(locations) ? groupUsagesByKind(locations) : null, [locations])
  const byFile = useMemo(() => groupByFile(locations), [locations])
  const [selection, setSelection] = useState<{ view: typeof view; key: string } | null>(null)
  const selected = selection?.view === view ? selection.key : null
  const pick = (location: GoIDEEditorLocation) => {
    setSelection({ view, key: locationKey(location) })
    navigateToLocation({ ...location, targetSessionId: sessionId })
  }
  if (!view) return <div className="flex items-start gap-3 p-4 text-[13px] leading-6 text-text-2"><Search size={18} className="mt-1 shrink-0 text-text-3" /><p>Use <strong className="font-medium text-text-1">Find Usages</strong> (Alt+F7) or Go to Implementation (Ctrl/Cmd+Alt+B) on a symbol.</p></div>
  return (
    <div className="min-w-0 text-[13px]">
      <header className="sticky top-0 z-10 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border-2 bg-surface-0 px-4 py-3">
        <h3 className="break-words text-sm font-semibold leading-6 text-text-1">{view.title}</h3>
        <p className="text-xs text-text-2" role="status">{locations.length} result{locations.length === 1 ? '' : 's'} · {byFile.length} file{byFile.length === 1 ? '' : 's'}</p>
      </header>
      {locations.length === 0 && <p className="px-4 py-6 text-[13px] text-text-2">No matching locations were reported by the language server.</p>}
      {byKind ? byKind.map(group => (
        <section key={group.kind} aria-label={group.label} className="border-b border-border-2 last:border-b-0">
          <h4 className="flex min-h-9 items-center gap-2 bg-surface-1 px-4 py-2 text-xs font-semibold text-text-2">{group.label}<span className="font-mono font-normal tabular-nums text-text-3">{group.count}</span></h4>
          {group.files.map(([file, items]) => <FileGroup key={file} file={file} locations={items} selected={selected} onPick={pick} />)}
        </section>
      )) : byFile.map(([file, items]) => <FileGroup key={file} file={file} locations={items} selected={selected} onPick={pick} />)}
    </div>
  )
}

import { useMemo } from 'react'
import { Library } from 'lucide-react'
import type { GoIDEEditorLocation } from '@/lib/goide-lsp-api'
import { GoGopherIcon } from './GoGopherIcon'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { navigateToLocation } from './goStudioLanguageFeatures'
import { groupByFile, groupUsagesByKind, hasUsageKinds } from './goStudioUsages'

interface GoStudioReferencesProps {
  sessionId: string
}

function FileGroup({ file, locations, indent }: { file: string; locations: GoIDEEditorLocation[]; indent: boolean }) {
  return (
    <div>
      <div className={`flex h-6 items-center gap-1.5 pr-2 font-medium text-text-2 ${indent ? 'pl-5' : 'pl-2'}`}>{locations[0].external ? <Library size={11} className="text-text-4" aria-hidden="true" /> : <GoGopherIcon size={12} />}<span className="truncate">{file}</span><span className="text-[9px] text-text-4">{locations.length}</span></div>
      {locations.map((location) => (
        <button key={`${location.range.startLine}:${location.range.startColumn}`} type="button" onClick={() => navigateToLocation(location)} className={`flex h-6 w-full items-center gap-2 pr-2 text-left hover:bg-surface-3 focus:bg-surface-3 focus:outline-none ${indent ? 'pl-9' : 'pl-6'}`}>
          <span className="w-12 shrink-0 text-right font-mono text-[9px] text-text-4">{location.range.startLine}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-2">{location.preview}</span>
        </button>
      ))}
    </div>
  )
}

/** Risultati di Find Usages (per tipo di utilizzo, poi per file) e di Go to Implementation (per file). */
export function GoStudioReferences({ sessionId }: GoStudioReferencesProps) {
  const view = useGoIDELspStore((state) => state.references[sessionId] ?? null)
  const locations = view?.locations ?? []
  const byKind = useMemo(() => hasUsageKinds(locations) ? groupUsagesByKind(locations) : null, [locations])
  const byFile = useMemo(() => groupByFile(locations), [locations])
  if (!view) return <p className="p-3 text-[10px] text-text-4">Use Find Usages (Alt+F7) or Go to Implementation (Ctrl/Cmd+Alt+B) on a symbol.</p>
  return (
    <div className="py-1 text-[11px]">
      <div className="px-2 pb-1 text-[10px] text-text-3"><span className="font-semibold text-text-1">{view.title}</span> · {locations.length} result{locations.length === 1 ? '' : 's'} in {byFile.length} file{byFile.length === 1 ? '' : 's'}</div>
      {byKind
        ? byKind.map((group) => (
          <section key={group.kind} aria-label={group.label}>
            <div className="flex h-6 items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-text-3">{group.label}<span className="font-normal normal-case text-text-4">{group.count}</span></div>
            {group.files.map(([file, items]) => <FileGroup key={file} file={file} locations={items} indent />)}
          </section>
        ))
        : byFile.map(([file, items]) => <FileGroup key={file} file={file} locations={items} indent={false} />)}
    </div>
  )
}

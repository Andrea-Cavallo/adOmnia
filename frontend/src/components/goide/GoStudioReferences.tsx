import { useMemo } from 'react'
import { Library } from 'lucide-react'
import type { GoIDEEditorLocation } from '@/lib/goide-lsp-api'
import { GoGopherIcon } from './GoGopherIcon'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { navigateToLocation } from './goStudioLanguageFeatures'

interface GoStudioReferencesProps {
  sessionId: string
}

function groupByFile(locations: GoIDEEditorLocation[]): Array<[string, GoIDEEditorLocation[]]> {
  const groups = new Map<string, GoIDEEditorLocation[]>()
  for (const location of locations) {
    const key = location.relativePath || location.path
    groups.set(key, [...(groups.get(key) ?? []), location])
  }
  return [...groups.entries()]
}

/** Risultati di Find Usages / Go to Implementation, raggruppati per file e navigabili. */
export function GoStudioReferences({ sessionId }: GoStudioReferencesProps) {
  const view = useGoIDELspStore((state) => state.references[sessionId] ?? null)
  const groups = useMemo(() => groupByFile(view?.locations ?? []), [view])
  if (!view) return <p className="p-3 text-[10px] text-text-4">Use Find Usages (Alt+F7) or Go to Implementation (Ctrl/Cmd+Alt+B) on a symbol.</p>
  return (
    <div className="py-1 text-[11px]">
      <div className="px-2 pb-1 text-[10px] text-text-3"><span className="font-semibold text-text-1">{view.title}</span> · {view.locations.length} result{view.locations.length === 1 ? '' : 's'} in {groups.length} file{groups.length === 1 ? '' : 's'}</div>
      {groups.map(([file, locations]) => (
        <div key={file}>
          <div className="flex h-6 items-center gap-1.5 px-2 font-medium text-text-2">{locations[0].external ? <Library size={11} className="text-text-4" /> : <GoGopherIcon size={12} />}<span className="truncate">{file}</span><span className="text-[9px] text-text-4">{locations.length}</span></div>
          {locations.map((location) => (
            <button key={`${location.range.startLine}:${location.range.startColumn}`} type="button" onClick={() => navigateToLocation(location)} className="flex h-6 w-full items-center gap-2 pl-6 pr-2 text-left hover:bg-surface-3 focus:bg-surface-3 focus:outline-none">
              <span className="w-12 shrink-0 text-right font-mono text-[9px] text-text-4">{location.range.startLine}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-2">{location.preview}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

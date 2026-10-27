import { CodeStudioFunctionExplorer } from './CodeStudioFunctionExplorer'
import { useEffect, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Boxes, ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { requestExpandHierarchy, type GoIDEHierarchyItem } from '@/lib/code-studio-lsp-api'
import { useCodeStudioLspStore, type GoIDEHierarchyView } from '@/stores/codeStudioLsp'
import { navigateToLocation } from './codeStudioLanguageFeatures'
import { withContentKeys } from '@/lib/contentKeys'
import { CodeStudioModal } from './CodeStudioModal'

const DIRECTIONS: Record<GoIDEHierarchyView['kind'], Array<{ id: string; label: string }>> = {
  call: [{ id: 'incoming', label: 'Callers' }, { id: 'outgoing', label: 'Callees' }],
  type: [{ id: 'supertypes', label: 'Supertypes' }, { id: 'subtypes', label: 'Subtypes' }],
}

interface NodeProps {
  sessionId: string
  item: GoIDEHierarchyItem
  direction: string
  depth: number
  /** Token degli antenati: un nodo già presente sopra di sé è una ricorsione e non si espande. */
  ancestors: ReadonlySet<string>
  initiallyOpen?: boolean
}

function nodeKey(item: GoIDEHierarchyItem): string {
  return `${item.location.uri}:${item.location.range.startLine}:${item.location.range.startColumn}`
}

function HierarchyNode({ sessionId, item, direction, depth, ancestors, initiallyOpen = false }: NodeProps) {
  const [open, setOpen] = useState(initiallyOpen)
  const [children, setChildren] = useState<GoIDEHierarchyItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recursive = ancestors.has(nodeKey(item))

  useEffect(() => {
    if (!open || children || recursive) return
    let cancelled = false
    requestExpandHierarchy(sessionId, direction, item.token)
      .then((value) => { if (!cancelled) setChildren(value) })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [children, direction, item.token, open, recursive, sessionId])

  const nextAncestors = new Set(ancestors).add(nodeKey(item))
  const where = item.location.relativePath || item.location.path
  return (
    <li>
      <div className="group flex h-8 items-center gap-1 rounded-md pr-2 hover:bg-surface-2/60" style={{ paddingLeft: 6 + depth * 16 }}>
        <button type="button" aria-label={open ? 'Collapse' : 'Expand'} disabled={recursive} onClick={() => setOpen((value) => !value)} className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-4 hover:text-text-1 disabled:opacity-30">
          {recursive ? <RefreshCw size={11} /> : open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button type="button" onClick={() => navigateToLocation(item.location)} className="flex min-w-0 flex-1 items-center gap-2 text-left" title={`${where}:${item.location.range.startLine}`}>
          <span className="gs-mono truncate text-text-1">{item.name}</span>
          {item.detail && <span className="truncate text-[12px] text-text-4">{item.detail}</span>}
          <span className="gs-mono ml-auto shrink-0 text-[11px] text-text-4">{where.split('/').pop()}:{item.location.range.startLine}</span>
          {item.callSites && item.callSites.length > 1 && <span className="gs-badge h-[18px] text-[10.5px]">×{item.callSites.length}</span>}
        </button>
      </div>
      {open && !recursive && (
        <ul>
          {children === null && !error && <li className="flex h-7 items-center gap-2 text-[11px] text-text-4" style={{ paddingLeft: 28 + depth * 16 }}><Loader2 size={11} className="animate-spin" /> Loading…</li>}
          {error && <li className="text-[11px] text-danger" style={{ paddingLeft: 28 + depth * 16 }}>{error}</li>}
          {children?.length === 0 && <li className="h-7 text-[11px] leading-7 text-text-4" style={{ paddingLeft: 28 + depth * 16 }}>Nothing found.</li>}
          {children && withContentKeys(children, nodeKey).map(({ key: childKey, item: child }) => (
            <HierarchyNode key={childKey} sessionId={sessionId} item={child} direction={direction} depth={depth + 1} ancestors={nextAncestors} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Call Hierarchy e Type Hierarchy: albero espandibile a richiesta, clic per andare al codice. */
export function CodeStudioHierarchyDialog() {
  const view = useCodeStudioLspStore((state) => state.hierarchy)
  const close = () => useCodeStudioLspStore.setState({ hierarchy: null })
  const [picked, setPicked] = useState<{ view: GoIDEHierarchyView; id: string } | null>(null)
  if (!view) return null
  if (view.kind === 'call') return <CodeStudioFunctionExplorer key={`${view.sessionId}:${view.root.token}`} view={view} onClose={close} />
  const direction = picked?.view === view ? picked.id : DIRECTIONS[view.kind][0].id
  const title = 'Type Hierarchy'
  return (
    <CodeStudioModal
      open
      onClose={close}
      top
      size="lg"
      divided
      flush
      icon={Boxes}
      title={title}
      subtitle={<span className="gs-mono">{view.root.name}</span>}
      actions={
        <div role="tablist" aria-label="Direction" className="gs-segmented">
          {DIRECTIONS[view.kind].map((option, index) => (
            <button key={option.id} type="button" role="tab" aria-selected={direction === option.id} onClick={() => setPicked({ view, id: option.id })} className="gs-segment">
              {index === 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} {option.label}
            </button>
          ))}
        </div>
      }
      footerStart={<>{'Supertypes: interfaces it satisfies. Subtypes: types that implement it.'} ↻ marks recursion.</>}
    >
      <ul className="max-h-[56vh] min-h-0 flex-1 overflow-auto p-2">
        <HierarchyNode key={`${direction}:${view.root.token}`} sessionId={view.sessionId} item={view.root} direction={direction} depth={0} ancestors={new Set()} initiallyOpen />
      </ul>
    </CodeStudioModal>
  )
}

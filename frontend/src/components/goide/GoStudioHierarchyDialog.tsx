import { useEffect, useRef, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Boxes, ChevronDown, ChevronRight, Loader2, RefreshCw, X } from 'lucide-react'
import { requestExpandHierarchy, type GoIDEHierarchyItem } from '@/lib/goide-lsp-api'
import { useModalFocusTrap } from '@/lib/accessibility'
import { useGoIDELspStore, type GoIDEHierarchyView } from '@/stores/goideLsp'
import { navigateToLocation } from './goStudioLanguageFeatures'

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
      <div className="group flex h-7 items-center gap-1 rounded-md pr-2 hover:bg-surface-3" style={{ paddingLeft: 6 + depth * 16 }}>
        <button type="button" aria-label={open ? 'Collapse' : 'Expand'} disabled={recursive} onClick={() => setOpen((value) => !value)} className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-4 hover:text-text-1 disabled:opacity-30">
          {recursive ? <RefreshCw size={11} /> : open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button type="button" onClick={() => navigateToLocation(item.location)} className="flex min-w-0 flex-1 items-center gap-2 text-left" title={`${where}:${item.location.range.startLine}`}>
          <span className="truncate font-mono text-[12px] text-text-1">{item.name}</span>
          {item.detail && <span className="truncate text-[11px] text-text-4">{item.detail}</span>}
          <span className="ml-auto shrink-0 font-mono text-[10.5px] text-text-4">{where.split('/').pop()}:{item.location.range.startLine}</span>
          {item.callSites && item.callSites.length > 1 && <span className="shrink-0 rounded bg-surface-3 px-1 text-[10px] text-text-3">×{item.callSites.length}</span>}
        </button>
      </div>
      {open && !recursive && (
        <ul>
          {children === null && !error && <li className="flex h-7 items-center gap-2 text-[11px] text-text-4" style={{ paddingLeft: 28 + depth * 16 }}><Loader2 size={11} className="animate-spin" /> Loading…</li>}
          {error && <li className="text-[11px] text-danger" style={{ paddingLeft: 28 + depth * 16 }}>{error}</li>}
          {children?.length === 0 && <li className="h-7 text-[11px] leading-7 text-text-4" style={{ paddingLeft: 28 + depth * 16 }}>Nothing found.</li>}
          {children?.map((child, index) => (
            <HierarchyNode key={`${nodeKey(child)}#${index}`} sessionId={sessionId} item={child} direction={direction} depth={depth + 1} ancestors={nextAncestors} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Call Hierarchy e Type Hierarchy: albero espandibile a richiesta, clic per andare al codice. */
export function GoStudioHierarchyDialog() {
  const view = useGoIDELspStore((state) => state.hierarchy)
  const close = () => useGoIDELspStore.setState({ hierarchy: null })
  const [direction, setDirection] = useState<string>('incoming')
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(!!view, close, dialogRef)
  useEffect(() => { if (view) setDirection(DIRECTIONS[view.kind][0].id) }, [view])
  if (!view) return null
  const title = view.kind === 'call' ? 'Call Hierarchy' : 'Type Hierarchy'
  return (
    <div className="ad-modal-backdrop fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" onClick={close}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={(event) => event.stopPropagation()} className="flex max-h-[72vh] w-[min(720px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-border-2 bg-surface-1">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-1 px-4">
          <Boxes size={14} className="text-accent" />
          <h2 className="text-[13px] font-semibold text-text-1">{title}</h2>
          <span className="truncate font-mono text-[12px] text-text-3">{view.root.name}</span>
          <div role="tablist" className="ml-auto flex rounded-lg border border-border-1 bg-surface-0 p-0.5">
            {DIRECTIONS[view.kind].map((option, index) => (
              <button key={option.id} type="button" role="tab" aria-selected={direction === option.id} onClick={() => setDirection(option.id)} className={`flex h-6 items-center gap-1 rounded-md px-2 text-[11px] ${direction === option.id ? 'bg-accent/15 font-semibold text-accent' : 'text-text-3 hover:text-text-1'}`}>
                {index === 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />} {option.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={close} aria-label="Close" className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={14} /></button>
        </div>
        <ul className="min-h-0 flex-1 overflow-auto p-2">
          <HierarchyNode key={`${direction}:${view.root.token}`} sessionId={view.sessionId} item={view.root} direction={direction} depth={0} ancestors={new Set()} initiallyOpen />
        </ul>
        <p className="shrink-0 border-t border-border-1 px-4 py-2 text-[10.5px] text-text-4">
          {view.kind === 'call' ? 'Callers: who calls this function. Callees: what it calls.' : 'Supertypes: interfaces it satisfies. Subtypes: types that implement it.'} Click a row to open the code; ↻ marks recursion.
        </p>
      </div>
    </div>
  )
}

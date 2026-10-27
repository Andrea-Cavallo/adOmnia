import { activeCodeStudioEditor } from './codeStudioEditorRegistry'
import { documentForModel } from './codeStudioLanguageFeatures'
import { useCodeStudioNavigationStore } from '@/stores/codeStudioNavigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Network, X } from 'lucide-react'
import {
  requestExpandHierarchy,
  requestHierarchyPreview,
  type GoIDEHierarchyItem,
  type GoIDEQuickDefinition,
} from '@/lib/code-studio-lsp-api'
import type { GoIDEHierarchyView } from '@/stores/codeStudioLsp'
import { navigateToLocation } from './codeStudioNavigation'
import { CodeStudioGraphView } from './CodeStudioGraphView'
import { CodeStudioModal } from './CodeStudioModal'
import {
  functionGraph,
  hierarchyKey,
  type CallDirection,
  type ExpandCalls,
} from './functionExplorerGraph'

type Mode = 'quick' | 'explorer' | 'graph'
function CallTree({
  item,
  direction,
  expand,
  selected,
  onSelect,
  onOpen,
  ancestors = new Set<string>(),
  query,
  level = 0,
}: {
  item: GoIDEHierarchyItem
  direction: CallDirection
  expand: ExpandCalls
  selected: string
  onSelect: (item: GoIDEHierarchyItem) => void
  onOpen: (item: GoIDEHierarchyItem) => void
  ancestors?: Set<string>
  query: string
  level?: number
}) {
  const [open, setOpen] = useState(level === 0)
  const [children, setChildren] = useState<GoIDEHierarchyItem[] | null>(null)
  const [error, setError] = useState('')
  const recursive = ancestors.has(hierarchyKey(item))
  useEffect(() => {
    if (!open || recursive || children) return
    let stale = false
    expand(direction, item)
      .then((value) => {
        if (!stale) setChildren(value)
      })
      .catch((error) => {
        if (!stale) setError(String(error))
      })
    return () => {
      stale = true
    }
  }, [open, recursive, children, direction, item, expand])
  const matches =
    !query ||
    level === 0 ||
    `${item.name} ${item.detail} ${item.location.relativePath}`
      .toLowerCase()
      .includes(query.toLowerCase())
  const next = new Set(ancestors).add(hierarchyKey(item))
  return (
    <li>
      <div
        hidden={!matches}
        className={`${!matches ? 'hidden' : 'flex'} items-center gap-1 py-1 ${selected === hierarchyKey(item) ? 'bg-surface-2' : ''}`}
        style={{ paddingLeft: Math.min(level, 12) * 12 }}
      >
        <button
          type="button"
          aria-label={`${open ? 'Collapse' : 'Expand'} ${item.name}`}
          aria-expanded={open}
          disabled={recursive || level >= 12}
          onClick={() => setOpen(!open)}
          className="grid h-7 w-7 shrink-0 place-items-center"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          type="button"
          onClick={() => onSelect(item)}
          onDoubleClick={() => onOpen(item)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onOpen(item)
            }
          }}
          className="min-w-0 flex-1 pr-2 text-left"
          title={item.detail || item.location.path}
        >
          <span className="block truncate text-xs text-text-1">
            {item.name}
            {recursive ? ' ↻' : ''}
          </span>
          <span className="block truncate font-mono text-[10px] text-text-3">
            {item.location.relativePath || item.location.path}:
            {item.location.range.startLine}
          </span>
        </button>
      </div>
      {open && !recursive && (
        <ul>
          {children === null && !error && (
            <li role="status" className="p-2 text-xs text-text-3">
              Loading calls…
            </li>
          )}
          {error && (
            <li role="alert" className="p-2 text-xs text-error">
              {error}
              <button
                onClick={() => {
                  setError('')
                  setOpen(false)
                  setTimeout(() => setOpen(true), 0)
                }}
                className="ml-2 underline"
              >
                Retry
              </button>
            </li>
          )}
          {children?.length === 0 && (
            <li className="p-2 text-xs text-text-3">
              No {direction === 'incoming' ? 'callers' : 'callees'} reported by
              the language server.
            </li>
          )}
          {children?.map((child) => (
            <CallTree
              key={hierarchyKey(child)}
              item={child}
              direction={direction}
              expand={expand}
              selected={selected}
              onSelect={onSelect}
              onOpen={onOpen}
              ancestors={next}
              query={query}
              level={level + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function CodeStudioFunctionExplorer({
  view,
  onClose,
}: {
  view: GoIDEHierarchyView
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>('quick')
  const [selected, setSelected] = useState(view.root)
  const [query, setQuery] = useState('')
  const [depth, setDepth] = useState(2)
  const [preview, setPreview] = useState<GoIDEQuickDefinition | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewEpoch, setPreviewEpoch] = useState(0)
  const [graph, setGraph] = useState<Awaited<
    ReturnType<typeof functionGraph>
  > | null>(null)
  const [graphError, setGraphError] = useState('')
  const cache = useRef(new Map<string, Promise<GoIDEHierarchyItem[]>>())
  const expand = useCallback<ExpandCalls>(
    (direction, item) => {
      const key = `${direction}:${hierarchyKey(item)}`
      let result = cache.current.get(key)
      if (!result) {
        result = requestExpandHierarchy(
          view.sessionId,
          direction,
          item.token,
        ).catch((error) => {
          cache.current.delete(key)
          throw error
        })
        cache.current.set(key, result)
      }
      return result
    },
    [view.sessionId],
  )
  useEffect(() => {
    let stale = false
    setPreview(null)
    setPreviewError('')
    const timer = setTimeout(() => {
      requestHierarchyPreview(view.sessionId, selected.token)
        .then((value) => {
          if (!stale) setPreview(value)
        })
        .catch((error) => {
          if (!stale) setPreviewError(String(error))
        })
    }, 120)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [selected, view.sessionId, previewEpoch])
  useEffect(() => {
    if (mode !== 'graph') return
    let stale = false
    setGraph(null)
    setGraphError('')
    functionGraph(view.root, depth, expand, () => stale)
      .then((value) => {
        if (!stale) setGraph(value)
      })
      .catch((error) => {
        if (!stale) setGraphError(String(error))
      })
    return () => {
      stale = true
    }
  }, [mode, depth, expand, view.root])
  const open = (item: GoIDEHierarchyItem) => {
    const editor = activeCodeStudioEditor(),
      model = editor?.getModel(),
      position = editor?.getPosition()
    const document = model ? documentForModel(model) : null
    if (
      document &&
      position &&
      document.document.sessionId === view.sessionId
    ) {
      useCodeStudioNavigationStore
        .getState()
        .recordJump(
          view.sessionId,
          {
            relativePath: document.document.relativePath,
            externalPath: document.document.external
              ? document.document.path
              : undefined,
            line: position.lineNumber,
            column: position.column,
          },
          {
            relativePath: item.location.relativePath ?? '',
            externalPath:
              item.location.external || !item.location.relativePath
                ? item.location.path
                : undefined,
            line: item.location.range.startLine,
            column: item.location.range.startColumn,
          },
        )
    }
    navigateToLocation({ ...item.location, targetSessionId: view.sessionId })
    if (mode === 'quick') onClose()
  }
  const actions = (
    <div
      className="gs-segmented"
      role="group"
      aria-label="Function navigation mode"
    >
      {(['quick', 'explorer', 'graph'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => setMode(value)}
          className="gs-segment"
        >
          {value === 'quick'
            ? 'Quick popup'
            : value === 'explorer'
              ? 'Function Explorer'
              : 'Visual Graph'}
        </button>
      ))}
    </div>
  )
  const selectionKey = hierarchyKey(selected)
  const treeProps = useMemo(
    () => ({
      item: view.root,
      expand,
      selected: selectionKey,
      onSelect: setSelected,
      onOpen: open,
      query,
    }),
    [view.root, expand, selectionKey, query, mode],
  )
  const content = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border-1 px-3 py-2">
        <p className="text-[10px] text-text-3">CURRENT FUNCTION</p>
        <button
          onClick={() => setSelected(view.root)}
          onDoubleClick={() => open(view.root)}
          className="text-left text-sm text-text-1"
        >
          {view.root.name}
        </button>
        <p
          className="truncate font-mono text-[10px] text-text-3"
          title={view.root.detail}
        >
          {view.root.detail || view.root.location.relativePath}
        </p>
      </div>
      {mode === 'graph' ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <label className="text-xs text-text-2">
            Depth{' '}
            <select
              aria-label="Call graph depth"
              className="gs-input ml-2 w-16"
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
            >
              {[1, 2, 3].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <p className="py-2 text-[11px] text-text-3">
            Callers above, callees below. Static calls do not prove runtime
            execution or change impact.
          </p>
          {graphError && (
            <p role="alert" className="text-xs text-error">
              {graphError}
            </p>
          )}
          {!graph && !graphError && (
            <p role="status" className="text-xs text-text-3">
              Loading call graph…
            </p>
          )}
          {graph && (
            <>
              <CodeStudioGraphView
                layout={graph.layout}
                label="Function call graph"
                selected={selectionKey}
                look={(node) => ({
                  title: node.data.name,
                  subtitle: node.data.location.relativePath,
                  color: 'var(--color-text-2)',
                })}
                onSelect={(node) => setSelected(node.data)}
                onOpen={(node) => open(node.data)}
              />
              {graph.limited && (
                <p className="text-xs text-warning">
                  Graph budget reached (120 functions / 240 calls). Reduce depth
                  to inspect a smaller graph.
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <label className="px-3 py-2 text-[11px] text-text-3">
            Filter loaded functions
            <input
              className="gs-input mt-1 w-full"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, package or file"
            />
          </label>
          <div
            className={`grid min-h-0 flex-1 overflow-auto ${mode === 'quick' ? 'grid-cols-2' : 'grid-cols-1'}`}
          >
            {(['incoming', 'outgoing'] as const).map((direction) => (
              <section
                key={direction}
                className="min-w-0 border-b border-border-1 p-2"
              >
                <h3 className="mb-2 text-xs font-semibold text-text-2">
                  {direction === 'incoming'
                    ? 'Callers · who calls'
                    : 'Callees · what it calls'}
                </h3>
                <ul>
                  <CallTree {...treeProps} direction={direction} />
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
      <section
        aria-label="Function source preview"
        className="max-h-[32vh] shrink-0 overflow-auto border-t border-border-1 p-3"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-text-2">
            {selected.name} · {selected.location.range.startLine}
          </span>
          <button className="gs-button text-xs" onClick={() => open(selected)}>
            Open source
          </button>
        </div>
        {previewError ? (
          <p role="alert" className="text-xs text-error">
            {previewError}
            <button
              onClick={() => setPreviewEpoch((value) => value + 1)}
              className="ml-2 underline"
            >
              Retry
            </button>
          </p>
        ) : !preview ? (
          <p role="status" className="text-xs text-text-3">
            Loading source…
          </p>
        ) : (
          <pre className="whitespace-pre font-mono text-[11px] text-text-2">
            {preview.code || 'Source not available.'}
            {preview.truncated ? '\n… preview truncated' : ''}
          </pre>
        )}
      </section>
    </div>
  )
  if (mode === 'quick')
    return (
      <CodeStudioModal
        open
        onClose={onClose}
        size="lg"
        top
        divided
        flush
        icon={Network}
        title="Function Explorer"
        actions={actions}
        footerStart="Click previews · double-click or Enter opens source · Alt+← returns to the previous editor position."
      >
        {content}
      </CodeStudioModal>
    )
  return (
    <aside
      role="region"
      aria-label="Function Explorer"
      className="absolute inset-y-0 right-0 z-40 flex w-[min(860px,70%)] min-w-[360px] flex-col border-l border-border-2 bg-surface-0 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border-1 p-3">
        <h2 className="mr-auto text-sm font-semibold text-text-1">
          Function Explorer
        </h2>
        <button
          aria-label="Close Function Explorer"
          className="gs-button"
          onClick={onClose}
        >
          <X size={14} />
        </button>
        {actions}
      </header>
      {content}
    </aside>
  )
}

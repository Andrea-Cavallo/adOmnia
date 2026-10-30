import { ResizeHandle } from '@/components/ui/ResizeHandle'
import type { CSSProperties } from 'react'
import './codeStudioFunctionExplorer.css'
import { CodeStudioSourcePreview } from './CodeStudioSourcePreview'
import { activeCodeStudioEditor } from './codeStudioEditorRegistry'
import { documentForModel } from './codeStudioLanguageFeatures'
import { useCodeStudioNavigationStore } from '@/stores/codeStudioNavigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Minus,
} from 'lucide-react'
import {
  requestExpandHierarchy,
  requestHierarchyPreview,
  type GoIDEHierarchyItem,
  type GoIDEQuickDefinition,
} from '@/lib/code-studio-lsp-api'
import type { GoIDEHierarchyView } from '@/stores/codeStudioLsp'
import { navigateToLocation } from './codeStudioNavigation'
import { CodeStudioGraphView } from './CodeStudioGraphView'
import { CodeStudioToolbarSelect } from './CodeStudioToolbarSelect'
import type { FunctionExplorerSide } from './useFunctionExplorerDock'
import {
  functionGraph,
  hierarchyKey,
  type CallDirection,
  type ExpandCalls,
} from './functionExplorerGraph'

type Mode = 'explorer' | 'graph'
const EMPTY_ANCESTORS = new Set<string>()
function CallTree({
  item,
  direction,
  expand,
  selected,
  onSelect,
  onOpen,
  ancestors = EMPTY_ANCESTORS,
  query,
  level = 0,
}: {
  item: GoIDEHierarchyItem
  direction: CallDirection
  expand: ExpandCalls
  selected: string
  onSelect: (item: GoIDEHierarchyItem, direction: CallDirection) => void
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
      .catch((err) => {
        if (!stale) setError(String(err))
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
  const path = item.location.relativePath || item.location.path
  const filename = path.replace(/\\/g, '/').split('/').pop()
  const next = new Set(ancestors).add(hierarchyKey(item))
  return (
    <li>
      <div
        hidden={!matches || level === 0}
        className={`fe-node ${!matches || level === 0 ? 'hidden' : 'flex'} items-center gap-1 ${selected === hierarchyKey(item) ? 'is-selected' : ''}`}
        style={{ paddingLeft: Math.min(level, 12) * 12 }}
      >
        <button
          type="button"
          aria-label={`${open ? 'Collapse' : 'Expand'} ${item.name}`}
          aria-expanded={open}
          disabled={recursive || level >= 12}
          onClick={() => setOpen(!open)}
          className="grid h-8 w-7 shrink-0 place-items-center"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          type="button"
          onClick={() => onSelect(item, direction)}
          onDoubleClick={() => onOpen(item)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onOpen(item)
            }
          }}
          aria-pressed={selected === hierarchyKey(item)}
          className="min-w-0 flex-1 pr-2 text-left"
          title={`${item.detail || item.name}\n${path}:${item.location.range.startLine}`}
        >
          <span className="fe-node-name">
            {item.name}
            {recursive ? ' ↻' : ''}
          </span>
          <span className="fe-node-path">
            {filename}:{item.location.range.startLine} ·{' '}
            {item.location.external ? 'External source' : path}
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

interface CodeStudioFunctionExplorerProps {
  view: GoIDEHierarchyView
  side: FunctionExplorerSide
  onSideChange: (side: FunctionExplorerSide) => void
  onClose: () => void
}

/** Docked tool window: lives in the workspace grid next to the editor, like Run or Chat. */
export function CodeStudioFunctionExplorer({ view, side, onSideChange, onClose }: CodeStudioFunctionExplorerProps) {
  const [mode, setMode] = useState<Mode>('explorer')
  const [sourceShare, setSourceShare] = useState(0.55)
  const sourcePane = useRef<HTMLElement>(null)
  const contentPane = useRef<HTMLDivElement>(null)
  const stopResize = useRef<(() => void) | null>(null)
  useEffect(() => () => { stopResize.current?.() }, [mode])
  const paneSizes = () => {
    const source = sourcePane.current?.getBoundingClientRect().height ?? 0
    const browser = contentPane.current?.querySelector('.fe-browser')?.getBoundingClientRect().height ?? 0
    return { source, total: source + browser }
  }
  const updateSourceSize = (height: number, total: number) => {
    if (total <= 0) return
    const minimum = Math.min(160, total * 0.4)
    const maximum = total - Math.min(100, total * 0.25)
    setSourceShare(Math.min(maximum, Math.max(minimum, height)) / total)
  }

  const [selected, setSelected] = useState(view.root)
  // Incoming call sites are lines inside the selected caller: the preview highlights them.
  const [callSiteLines, setCallSiteLines] = useState<number[]>([])
  const select = useCallback((item: GoIDEHierarchyItem, direction?: CallDirection) => {
    setSelected(item)
    setCallSiteLines(direction === 'incoming' ? (item.callSites ?? []).map((site) => site.startLine) : [])
  }, [])
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
      useCodeStudioNavigationStore.getState().recordJump(
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
  }
  const actions = (
    <div
      className="fe-modes"
      role="group"
      aria-label="Function navigation mode"
    >
      {(['explorer', 'graph'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => setMode(value)}
        >
          {value === 'explorer' ? 'Calls' : 'Visual Graph'}
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
      onSelect: select,
      onOpen: open,
      query,
    }),
    [view.root, expand, selectionKey, select, query],
  )
  const content = (
    <div ref={contentPane} className="fe-content" style={{ '--fe-source-share': sourceShare } as CSSProperties}>
      <div className="fe-current">
        <p className="fe-current-label">Current function</p>
        <button
          onClick={() => select(view.root)}
          onDoubleClick={() => open(view.root)}
          className="fe-current-name"
        >
          {view.root.name}
        </button>
        <p className="fe-current-path" title={view.root.detail}>
          {view.root.detail || view.root.location.relativePath}
        </p>
      </div>
      {mode === 'graph' ? (
        <div className="fe-browser p-4">
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
                onSelect={(node) => select(node.data)}
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
        <div className="fe-browser">
          <label className="fe-search">
            Filter loaded functions
            <input
              className="gs-input mt-1 w-full"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, package or file"
            />
          </label>
          <div className="fe-tree-columns">
            {(['incoming', 'outgoing'] as const).map((direction) => (
              <section key={direction}>
                <h3>
                  {direction === 'incoming' ? (
                    <ArrowUpRight size={15} />
                  ) : (
                    <ArrowDownLeft size={15} />
                  )}
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
        </div>
      )}
      <ResizeHandle
        label="Resize source preview · drag up to enlarge · double-click to reset"
        orientation="horizontal"
        withLine={false}
        className="fe-preview-resize"
        onDoubleClick={() => setSourceShare(0.55)}
        onArrow={delta => {
          const { source, total } = paneSizes()
          updateSourceSize(source - delta, total)
        }}
        onMouseDown={event => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.focus()
          stopResize.current?.()
          const { source, total } = paneSizes()
          const origin = event.clientY
          const previousCursor = document.body.style.cursor
          const previousSelect = document.body.style.userSelect
          document.body.style.cursor = 'row-resize'
          document.body.style.userSelect = 'none'
          const move = (next: MouseEvent) => updateSourceSize(source + origin - next.clientY, total)
          const stop = () => {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', stop)
            window.removeEventListener('blur', stop)
            document.body.style.cursor = previousCursor
            document.body.style.userSelect = previousSelect
            stopResize.current = null
          }
          stopResize.current = stop
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', stop)
          window.addEventListener('blur', stop)
        }}
      />
      <section ref={sourcePane} aria-label="Function source preview" className="fe-source">
        <div className="fe-source-header">
          <div className="fe-source-heading">
            {selected.name}
            <small>
              {selected.location.relativePath || selected.location.path}:
              {selected.location.range.startLine}
            </small>
          </div>
          <button className="fe-open-source" onClick={() => open(selected)}>
            <ExternalLink size={13} /> Open source
          </button>
        </div>
        {previewError ? (
          <p role="alert" className="fe-source-message text-error">
            {previewError}
            <button
              onClick={() => setPreviewEpoch((value) => value + 1)}
              className="ml-2 underline"
            >
              Retry
            </button>
          </p>
        ) : !preview ? (
          <p role="status" className="fe-source-message">
            Loading source…
          </p>
        ) : (
          <CodeStudioSourcePreview
            code={preview.code || 'Source not available.'}
            path={preview.location.path || selected.location.path}
            startLine={preview.startLine || selected.location.range.startLine}
            truncated={preview.truncated}
            highlightLines={callSiteLines}
          />
        )}
      </section>
    </div>
  )
  return (
    <section
      aria-label="Function Explorer"
      className="function-explorer fe-pane"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <header className="code-studio-tool-header fe-header">
        <span className="code-studio-tool-title">Function Explorer</span>
        {actions}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <CodeStudioToolbarSelect
            label="Tool position"
            value={side}
            options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]}
            onChange={(value) => onSideChange(value === 'left' ? 'left' : 'right')}
          />
          <button
            type="button"
            aria-label="Hide Function Explorer"
            title="Hide · Esc"
            className="code-studio-icon-button h-7 w-7"
            onClick={onClose}
          >
            <Minus size={14} />
          </button>
        </div>
      </header>
      {content}
    </section>
  )
}

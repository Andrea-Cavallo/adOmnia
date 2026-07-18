import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, GitBranch, List, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── layout constants ────────────────────────────────────────────────────────
const NODE_W = 240
const ROW_H = 22
const HEADER_H = 32
const NODE_PAD = 6
const COL_GAP = 100
const SIBLING_GAP = 16

// ─── types ───────────────────────────────────────────────────────────────────
interface GRow { key: string; value: string; type: string; hasChild: boolean }
interface GNode { id: string; title: string; meta: string; rows: GRow[]; height: number; x: number; y: number }
interface GEdge { source: string; target: string }

// ─── graph builder ───────────────────────────────────────────────────────────
function collectNodes(value: unknown, path: string, key: string, nodes: GNode[], edges: GEdge[]) {
  const isArr = Array.isArray(value)
  const isObj = value !== null && typeof value === 'object' && !isArr
  if (!isObj && !isArr) return

  const entries: [string, unknown][] = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>)
  const meta = isArr ? `[ ${(value as unknown[]).length} ]` : `{ ${entries.length} }`
  const rows: GRow[] = []

  for (const [k, child] of entries) {
    const childPath = isArr ? `${path}[${k}]` : `${path}.${k}`
    if (child !== null && typeof child === 'object') {
      const childIsArr = Array.isArray(child)
      const childLen = childIsArr ? (child as unknown[]).length : Object.keys(child as object).length
      rows.push({ key: k, value: childIsArr ? `[ ${childLen} ]` : `{ ${childLen} }`, type: childIsArr ? 'array' : 'object', hasChild: true })
      collectNodes(child, childPath, k, nodes, edges)
      edges.push({ source: path, target: childPath })
    } else {
      let preview: string
      if (child === null) preview = 'null'
      else if (typeof child === 'string') preview = `"${child.length > 20 ? child.slice(0, 18) + '…' : child}"`
      else preview = String(child)
      rows.push({ key: k, value: preview, type: child === null ? 'null' : typeof child, hasChild: false })
    }
  }

  const height = HEADER_H + rows.length * ROW_H + NODE_PAD
  nodes.push({ id: path, title: key === '__root__' ? '$' : key, meta, rows, height, x: 0, y: 0 })
}

function layoutGraph(nodes: GNode[], edges: GEdge[]) {
  const nodeMap: Record<string, GNode> = {}
  nodes.forEach(n => (nodeMap[n.id] = n))
  const children: Record<string, string[]> = {}
  const parents: Record<string, string> = {}
  edges.forEach(e => {
    ;(children[e.source] ??= []).push(e.target)
    parents[e.target] = e.source
  })
  const depths: Record<string, number> = {}
  const assignDepth = (id: string, d: number) => {
    depths[id] = d
    ;(children[id] ?? []).forEach(c => assignDepth(c, d + 1))
  }
  const root = nodes.find(n => !parents[n.id])
  if (root) assignDepth(root.id, 0)
  const columns: Record<number, GNode[]> = {}
  nodes.forEach(n => { const d = depths[n.id] ?? 0; (columns[d] ??= []).push(n) })
  const maxDepth = Object.keys(columns).length ? Math.max(...Object.keys(columns).map(Number)) : 0
  for (let d = 0; d <= maxDepth; d++) {
    let y = 0
    for (const node of columns[d] ?? []) {
      node.x = d * (NODE_W + COL_GAP)
      node.y = y
      y += node.height + SIBLING_GAP
    }
  }
}

function buildGraph(value: unknown): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = [], edges: GEdge[] = []
  collectNodes(value, '$', '__root__', nodes, edges)
  layoutGraph(nodes, edges)
  return { nodes, edges }
}

// ─── value colors ────────────────────────────────────────────────────────────
const VAL_COLOR: Record<string, string> = {
  string: 'var(--color-json-string)',
  number: 'var(--color-json-number)',
  boolean: 'var(--color-json-bool)',
  null: 'var(--color-json-null)',
  object: 'var(--color-accent-light)',
  array: 'var(--color-accent-light)',
}

// ─── GraphCanvas ─────────────────────────────────────────────────────────────
function GraphCanvas({ nodes, edges }: { nodes: GNode[]; edges: GEdge[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 40, y: 40 })
  const dragging = useRef(false)
  const dragOrigin = useRef({ x: 0, y: 0 })
  const [selected, setSelected] = useState<string | null>(null)

  const nodeMap = useMemo(() => {
    const m: Record<string, GNode> = {}
    nodes.forEach(n => (m[n.id] = n))
    return m
  }, [nodes])

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    setZoom(z => Math.max(0.12, Math.min(4, z * (e.deltaY > 0 ? 0.9 : 1.1))))
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const fitView = useCallback(() => {
    if (!containerRef.current || nodes.length === 0) return
    const rect = containerRef.current.getBoundingClientRect()
    const maxX = Math.max(...nodes.map(n => n.x + NODE_W))
    const maxY = Math.max(...nodes.map(n => n.y + n.height))
    const z = Math.min((rect.width - 80) / maxX, (rect.height - 80) / maxY, 1.2)
    setZoom(z)
    setPan({ x: 40, y: 40 })
  }, [nodes])

  useEffect(() => { fitView() }, [fitView])

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-gnode]')) return
    dragging.current = true
    dragOrigin.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return
    setPan({ x: e.clientX - dragOrigin.current.x, y: e.clientY - dragOrigin.current.y })
  }
  const stopDrag = () => { dragging.current = false }

  // Edge paths: bezier from right-center of source header → left-center of target header
  const edgePaths = useMemo(() => edges.map(e => {
    const src = nodeMap[e.source], tgt = nodeMap[e.target]
    if (!src || !tgt) return null
    const x1 = src.x + NODE_W, y1 = src.y + HEADER_H / 2
    const x2 = tgt.x, y2 = tgt.y + HEADER_H / 2
    const cx = (x1 + x2) / 2
    return { key: `${e.source}→${e.target}`, d: `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}` }
  }).filter(Boolean) as { key: string; d: string }[], [edges, nodeMap])

  const selectedNode = selected ? nodeMap[selected] : null

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col">
      {/* Controls overlay */}
      <div className="absolute top-2 left-2 z-10 flex gap-1">
        <button
          onClick={fitView}
          className="px-2 py-1 text-[10px] bg-surface-2 border border-border-2 rounded text-text-3 hover:text-text-1 transition-colors"
        >
          Fit
        </button>
        <button
          onClick={() => setZoom(z => Math.min(4, z * 1.25))}
          className="px-2 py-1 text-[10px] bg-surface-2 border border-border-2 rounded text-text-3 hover:text-text-1 transition-colors"
        >
          +
        </button>
        <button
          onClick={() => setZoom(z => Math.max(0.12, z * 0.8))}
          className="px-2 py-1 text-[10px] bg-surface-2 border border-border-2 rounded text-text-3 hover:text-text-1 transition-colors"
        >
          −
        </button>
        <span className="px-2 py-1 text-[10px] bg-surface-2 border border-border-2 rounded text-text-4 font-mono">
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1"
        style={{
          background: 'var(--color-surface-0)',
          backgroundImage: 'radial-gradient(circle, var(--color-border-2) 1.2px, transparent 1.2px)',
          backgroundSize: '24px 24px',
          cursor: dragging.current ? 'grabbing' : 'grab',
          overflow: 'hidden',
          position: 'relative',
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 12000,
            height: 12000,
            transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {/* SVG edges */}
          <svg
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
          >
            {edgePaths.map(ep => (
              <path key={ep.key} d={ep.d} fill="none" stroke="var(--color-border-2)" strokeWidth="1.5" opacity="0.7" />
            ))}
          </svg>

          {/* Nodes */}
          {nodes.map(node => (
            <div
              key={node.id}
              data-gnode="1"
              onClick={() => setSelected(node.id === selected ? null : node.id)}
              style={{
                position: 'absolute',
                left: node.x,
                top: node.y,
                width: NODE_W,
                background: 'var(--color-surface-1)',
                border: `1px solid ${selected === node.id ? 'var(--color-accent)' : 'var(--color-border-2)'}`,
                borderRadius: 6,
                overflow: 'hidden',
                cursor: 'pointer',
                boxShadow: selected === node.id
                  ? '0 0 0 2px color-mix(in srgb, var(--color-accent) 30%, transparent), 0 4px 12px rgba(0,0,0,0.3)'
                  : '0 2px 8px rgba(0,0,0,0.25)',
                transition: 'border-color 100ms, box-shadow 100ms',
              }}
            >
              {/* Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                background: 'var(--color-surface-2)',
                borderBottom: '1px solid var(--color-border-1)',
                minHeight: HEADER_H,
              }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 600, color: 'var(--color-accent-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {node.title}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-4)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {node.meta}
                </span>
              </div>
              {/* Rows */}
              {node.rows.map((row, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '1px 10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    minHeight: ROW_H,
                    borderBottom: i < node.rows.length - 1 ? '1px solid var(--color-border-1)' : 'none',
                  }}
                >
                  <span style={{ color: 'var(--color-text-2)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                    {row.key}
                  </span>
                  <span style={{ color: VAL_COLOR[row.type] ?? 'var(--color-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110, textAlign: 'right', flexShrink: 0 }}>
                    {row.value}
                  </span>
                  {row.hasChild && (
                    <span style={{ color: 'var(--color-accent)', fontSize: 10, flexShrink: 0 }}>→</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Inspector panel */}
      {selectedNode && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            width: 268,
            maxHeight: 300,
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-border-2)',
            borderRadius: 6,
            overflow: 'auto',
            boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            zIndex: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border-1)', color: 'var(--color-accent-light)', fontWeight: 600 }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedNode.title}</span>
            <span style={{ color: 'var(--color-text-4)', fontSize: 10, whiteSpace: 'nowrap' }}>{selectedNode.meta}</span>
            <button onClick={() => setSelected(null)} style={{ color: 'var(--color-text-4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>
              <X size={12} />
            </button>
          </div>
          <div style={{ padding: '4px 12px 5px', color: 'var(--color-text-4)', fontSize: 10, borderBottom: '1px solid var(--color-border-1)', wordBreak: 'break-all' }}>
            {selectedNode.id}
          </div>
          <div>
            {selectedNode.rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 12px' }}>
                <span style={{ color: 'var(--color-text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.key}</span>
                <span style={{ color: 'var(--color-text-3)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── TreeView ─────────────────────────────────────────────────────────────────
interface TreeRow { path: string; depth: number; key: string; meta: string; preview: string; valueType: string; expandable: boolean }

function flattenTree(value: unknown, path: string, depth: number, expanded: Set<string>, search: string, key?: string | number, out: TreeRow[] = []): TreeRow[] {
  const isArr = Array.isArray(value)
  const isObj = value !== null && typeof value === 'object' && !isArr
  const expandable = isArr || isObj
  const label = key === undefined ? '$' : String(key)
  const valueType = value === null ? 'null' : isArr ? 'array' : typeof value
  const meta = isObj ? `{${Object.keys(value as object).length}}` : isArr ? `[${(value as unknown[]).length}]` : ''
  let preview = ''
  if (!expandable) {
    if (valueType === 'string') preview = `"${String(value).length > 70 ? String(value).slice(0, 67) + '…' : String(value)}"`
    else preview = String(value)
  }

  const matches = !search || label.toLowerCase().includes(search) || (!expandable && preview.toLowerCase().includes(search))
  if (matches) out.push({ path, depth, key: label, meta, preview, valueType, expandable })

  if (expandable && expanded.has(path)) {
    const entries: [string | number, unknown][] = isArr
      ? (value as unknown[]).map((v, i) => [i, v])
      : Object.entries(value as Record<string, unknown>)
    for (const [k, v] of entries) {
      const cp = isArr ? `${path}[${k}]` : `${path}.${k}`
      flattenTree(v, cp, depth + 1, expanded, search, k, out)
    }
  }
  return out
}

function walkAllPaths(value: unknown, path: string, set: Set<string>) {
  if (value === null || typeof value !== 'object') return
  set.add(path)
  if (Array.isArray(value)) value.forEach((v, i) => walkAllPaths(v, `${path}[${i}]`, set))
  else Object.entries(value as Record<string, unknown>).forEach(([k, v]) => walkAllPaths(v, `${path}.${k}`, set))
}

interface TreeViewProps {
  parsed: unknown
  /** Controlled expansion state. When provided, the caller owns the Set. */
  expanded?: Set<string>
  onExpandedChange?: (next: Set<string>) => void
}

function TreeView({ parsed, expanded: expandedProp, onExpandedChange }: TreeViewProps) {
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(() => new Set(['$']))
  const isControlled = expandedProp !== undefined
  const expanded = isControlled ? expandedProp! : internalExpanded

  const setExpanded = useCallback((next: Set<string>) => {
    if (isControlled) onExpandedChange?.(next)
    else setInternalExpanded(next)
  }, [isControlled, onExpandedChange])

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const toggle = useCallback((path: string) => {
    setExpanded((() => {
      const next = new Set(expanded)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })())
  }, [expanded, setExpanded])

  const expandAll = () => {
    const all = new Set<string>()
    walkAllPaths(parsed, '$', all)
    setExpanded(all)
  }

  const rows = useMemo(() => flattenTree(parsed, '$', 0, expanded, search.toLowerCase()), [parsed, expanded, search])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-1 bg-surface-1 flex-shrink-0">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search keys / values…"
          className="flex-1 bg-surface-2 border border-border-2 rounded px-2 py-0.5 text-xs font-mono text-text-1 placeholder:text-text-4 outline-none focus:border-accent"
        />
        <button onClick={expandAll} className="px-2 py-0.5 text-[10px] text-text-3 hover:text-text-1 border border-border-2 rounded">expand all</button>
        <button onClick={() => setExpanded(new Set(['$']))} className="px-2 py-0.5 text-[10px] text-text-3 hover:text-text-1 border border-border-2 rounded">collapse</button>
        <span className="text-[10px] text-text-4 font-mono">{rows.length} rows</span>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {rows.length === 0
          ? <div className="flex items-center justify-center h-32 text-xs text-text-4">No matching nodes</div>
          : rows.map(row => (
            <TreeRowItem
              key={row.path}
              row={row}
              isExpanded={expanded.has(row.path)}
              isSelected={selected === row.path}
              onToggle={() => toggle(row.path)}
              onSelect={() => setSelected(row.path === selected ? null : row.path)}
            />
          ))
        }
      </div>
    </div>
  )
}

function TreeRowItem({ row, isExpanded, isSelected, onToggle, onSelect }: {
  row: TreeRow
  isExpanded: boolean
  isSelected: boolean
  onToggle: () => void
  onSelect: () => void
}) {
  const valColor = VAL_COLOR[row.valueType] ?? 'var(--color-text-3)'
  return (
    <div
      onClick={onSelect}
      style={{ paddingLeft: row.depth * 18 + 6 }}
      className={cn(
        'flex items-center gap-1.5 py-[3px] pr-3 cursor-pointer border-l-2 text-xs font-mono',
        isSelected ? 'bg-accent/8 border-accent' : 'border-transparent hover:bg-surface-2/60',
      )}
    >
      <button
        onClick={e => { e.stopPropagation(); if (row.expandable) onToggle() }}
        className="w-[14px] h-[14px] flex items-center justify-center text-text-4 hover:text-text-2 flex-shrink-0"
      >
        {row.expandable ? (
          <svg width="8" height="8" viewBox="0 0 8 8" style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 100ms' }}>
            <path d="M2.5 1.5L5.5 4l-3 2.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : <span className="w-1 h-1 rounded-full bg-border-2 block" />}
      </button>
      <span className="text-accent-light font-medium">{row.key}</span>
      {row.meta && <span className="text-text-4 text-[10px]">{row.meta}</span>}
      {!row.expandable && (
        <span style={{ color: valColor }} className="ml-1 truncate">{row.preview}</span>
      )}
    </div>
  )
}

// ─── JsonGraphModal ──────────────────────────────────────────────────────────
export function JsonGraphModal({ title, json, onClose }: { title: string; json: string; onClose: () => void }) {
  const [mode, setMode] = useState<'graph' | 'tree'>('graph')

  const parsed = useMemo(() => {
    try { return { value: JSON.parse(json), error: '' } }
    catch (e) { return { value: null, error: e instanceof Error ? e.message : 'Invalid JSON' } }
  }, [json])

  const { nodes, edges } = useMemo(() => {
    if (!parsed.value || typeof parsed.value !== 'object') return { nodes: [], edges: [] }
    return buildGraph(parsed.value)
  }, [parsed.value])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75" onClick={onClose}>
      <div
        className="flex flex-col rounded-lg border border-border-1 bg-surface-1 shadow-2xl overflow-hidden"
        style={{ width: '92vw', maxWidth: 1400, height: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border-1 bg-surface-2 flex-shrink-0">
          <span className="text-xs font-semibold text-text-1 flex-1 truncate">{title}</span>
          {mode === 'graph' && (
            <span className="text-[10px] text-text-4 font-mono">{nodes.length} nodes · {edges.length} edges</span>
          )}
          <div className="flex items-center rounded border border-border-2 overflow-hidden">
            <button
              onClick={() => setMode('graph')}
              className={cn('flex items-center gap-1 px-2.5 py-1 text-[10px] transition-colors', mode === 'graph' ? 'bg-accent/20 text-accent-light' : 'text-text-3 hover:text-text-1')}
            >
              <GitBranch size={11} /> Graph
            </button>
            <button
              onClick={() => setMode('tree')}
              className={cn('flex items-center gap-1 px-2.5 py-1 text-[10px] transition-colors border-l border-border-2', mode === 'tree' ? 'bg-accent/20 text-accent-light' : 'text-text-3 hover:text-text-1')}
            >
              <List size={11} /> Tree
            </button>
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(json)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-3 hover:text-text-1 border border-border-2 rounded transition-colors"
          >
            <Copy size={10} /> Copy
          </button>
          <button onClick={onClose} className="p-1 rounded text-text-4 hover:text-text-1 hover:bg-surface-3 transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Content */}
        {parsed.error ? (
          <div className="flex-1 flex items-center justify-center text-xs text-error font-mono px-8">{parsed.error}</div>
        ) : !parsed.value || typeof parsed.value !== 'object' ? (
          <div className="flex-1 flex items-center justify-center text-xs text-text-4">Graph requires an object or array JSON value</div>
        ) : mode === 'graph' ? (
          <GraphCanvas nodes={nodes} edges={edges} />
        ) : (
          <TreeView parsed={parsed.value} />
        )}
      </div>
    </div>
  )
}

// ─── Inline JsonGraph (tree-only, used in ResponsePanel etc.) ────────────────
export function JsonGraph({
  json,
  className,
  expandedPaths,
  onExpandedPathsChange,
}: {
  json: string
  className?: string
  /** Optional controlled expansion state — lifted to parent to survive unmount/remount */
  expandedPaths?: Set<string>
  onExpandedPathsChange?: (paths: Set<string>) => void
}) {
  const parsed = useMemo(() => {
    try { return { value: JSON.parse(json), error: '' } }
    catch (e) { return { value: null, error: e instanceof Error ? e.message : 'Invalid JSON' } }
  }, [json])

  if (parsed.error) {
    return <div className="rounded border border-error/40 bg-error/8 px-3 py-2 text-xs text-error font-mono">{parsed.error}</div>
  }

  return (
    <div className={cn('rounded border border-border-1 bg-surface-0 overflow-hidden flex flex-col', className)} style={{ minHeight: 200 }}>
      <TreeView
        parsed={parsed.value}
        expanded={expandedPaths}
        onExpandedChange={onExpandedPathsChange}
      />
    </div>
  )
}

export function JsonGraphDiagram({
  json,
  className,
}: {
  json: string
  className?: string
}) {
  const parsed = useMemo(() => {
    try { return { value: JSON.parse(json), error: '' } }
    catch (e) { return { value: null, error: e instanceof Error ? e.message : 'Invalid JSON' } }
  }, [json])

  const { nodes, edges } = useMemo(() => {
    if (!parsed.value || typeof parsed.value !== 'object') return { nodes: [], edges: [] }
    return buildGraph(parsed.value)
  }, [parsed.value])

  if (parsed.error) {
    return <div className="rounded border border-error/40 bg-error/8 px-3 py-2 text-xs text-error font-mono">{parsed.error}</div>
  }

  if (!parsed.value || typeof parsed.value !== 'object') {
    return <div className="flex flex-1 items-center justify-center text-xs text-text-4">Graph requires an object or array JSON value</div>
  }

  return (
    <div className={cn('rounded border border-border-1 bg-surface-0 overflow-hidden flex flex-col', className)} style={{ minHeight: 260 }}>
      <GraphCanvas nodes={nodes} edges={edges} />
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  enableDOM,
  getDocument,
  getComputedStyleForNode,
  getNodeHTML,
  getPageSource,
  querySelector,
  highlightNode,
  hideHighlight,
  getDOMBreakpoints,
  setDOMBreakpoint,
  removeDOMBreakpoint,
  type DOMNode,
  type DOMBreakpointInfo,
  type DOMBreakpointType,
} from '@/lib/browser-debug-api'
import {
  Code2,
  ChevronRight,
  ChevronDown,
  Search,
  Highlighter,
  FileCode2,
  RefreshCw,
  Copy,
  CircleDot,
} from 'lucide-react'

export type { DOMNode }

interface DOMNodeRowProps {
  node: DOMNode
  depth: number
  selectedNodeId: number | null
  onSelect: (node: DOMNode) => void
  onExpand: (node: DOMNode) => void
  expandedNodes: Set<number>
}

function formatAttributes(attributes: string[]): { name: string; value: string }[] {
  const pairs: { name: string; value: string }[] = []
  for (let i = 0; i < attributes.length; i += 2) {
    pairs.push({ name: attributes[i], value: attributes[i + 1] || '' })
  }
  return pairs
}

function formatHTMLSource(source: string): string {
  const compact = source.replace(/>\s+</g, '><').trim()
  const withBreaks = compact.replace(/></g, '>\n<')
  const lines = withBreaks.split('\n')
  let depth = 0

  return lines
    .map((rawLine) => {
      const line = rawLine.trim()
      if (!line) return ''
      const closing = /^<\//.test(line)
      const selfClosing =
        /\/>$/.test(line) ||
        /^<!/.test(line) ||
        /^<\?/.test(line) ||
        /^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(line)

      if (closing) depth = Math.max(depth - 1, 0)
      const formatted = `${'  '.repeat(depth)}${line}`
      if (!closing && !selfClosing) depth += 1
      return formatted
    })
    .join('\n')
}

function copyToClipboard(text: string) {
  void navigator.clipboard?.writeText(text)
}

function compactNodeValue(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized
}

const DOM_BREAKPOINTS: Array<{ type: DOMBreakpointType; label: string }> = [
  { type: 'subtree-modified', label: 'Subtree' },
  { type: 'attribute-modified', label: 'Attributes' },
  { type: 'node-removed', label: 'Removal' },
]

function DOMNodeRow({
  node,
  depth,
  selectedNodeId,
  onSelect,
  onExpand,
  expandedNodes,
}: DOMNodeRowProps) {
  const isElement = node.nodeType === 1
  const isExpanded = expandedNodes.has(node.nodeId)
  const hasChildren = node.childCount > 0 || Boolean(node.children?.length)
  const isSelected = selectedNodeId === node.nodeId

  const attrs = formatAttributes(node.attributes)
  const nonElementValue = compactNodeValue(node.nodeValue || node.localName || '')

  const renderNodeContent = () => {
    if (isElement) {
      return (
        <span className="text-[10px] font-mono flex items-center gap-0.5 truncate">
          <span className="text-text-3">&lt;</span>
          <span className="text-accent font-medium">{node.localName || node.nodeName.toLowerCase()}</span>
          {attrs.map((attr) => (
            <span key={attr.name} className="ml-1">
              <span className="text-info">{attr.name}</span>
              <span className="text-text-3">=&quot;</span>
              <span className="text-success">{attr.value}</span>
              <span className="text-text-3">&quot;</span>
            </span>
          ))}
          <span className="text-text-3">&gt;</span>
        </span>
      )
    }

    if (node.nodeType === 3) {
      const visibleText = nonElementValue || 'whitespace'
      return (
        <span className="text-[10px] font-mono flex items-center gap-1 truncate">
          <span className="rounded border border-border-1 bg-surface-0 px-1 text-text-4">#text</span>
          <span className={nonElementValue ? 'text-text-2' : 'text-text-4 italic'}>
            &quot;{visibleText}&quot;
          </span>
        </span>
      )
    }

    if (node.nodeType === 8) {
      return (
        <span className="text-[10px] font-mono flex items-center gap-1 truncate">
          <span className="rounded border border-border-1 bg-surface-0 px-1 text-text-4">comment</span>
          <span className="text-text-4 italic">&lt;!-- {nonElementValue || 'empty'} --&gt;</span>
        </span>
      )
    }

    if (node.nodeType === 9) {
      return <span className="text-[10px] font-mono text-warning">#document</span>
    }

    if (node.nodeType === 10) {
      return (
        <span className="text-[10px] font-mono flex items-center gap-1 truncate">
          <span className="text-text-3">&lt;!doctype</span>
          <span className="text-warning">{node.nodeName.toLowerCase() || 'html'}</span>
          <span className="text-text-3">&gt;</span>
        </span>
      )
    }

    return (
      <span className="text-[10px] font-mono flex items-center gap-1 truncate">
        <span className="rounded border border-border-1 bg-surface-0 px-1 text-text-4">
          node {node.nodeType}
        </span>
        <span className="text-text-2">{node.nodeName || nonElementValue || 'unnamed'}</span>
      </span>
    )
  }

  return (
    <>
      <div
        className={cn(
          'flex items-center py-px hover:bg-surface-2/50 transition-colors focus-within:ring-2 focus-within:ring-inset focus-within:ring-accent',
          isSelected && 'bg-accent/10'
        )}
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        {hasChildren ? (
          <button
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.nodeName}`}
            onClick={(e) => {
              e.stopPropagation()
              onExpand(node)
            }}
            className="h-4 w-4 flex items-center justify-center text-text-3 hover:text-text-1 flex-shrink-0"
          >
            {isExpanded ? (
              <ChevronDown size={10} />
            ) : (
              <ChevronRight size={10} />
            )}
          </button>
        ) : (
          <div className="w-4 flex-shrink-0" />
        )}

        <button type="button" role="treeitem" aria-selected={isSelected} aria-expanded={hasChildren ? isExpanded : undefined} onClick={() => onSelect(node)} className="min-w-0 flex-1 text-left outline-none">
          {renderNodeContent()}
        </button>
      </div>

      {isExpanded &&
        node.children?.map((child, index) => (
          <DOMNodeRow
            key={`${child.nodeId}-${index}`}
            node={child}
            depth={depth + 1}
            selectedNodeId={selectedNodeId}
            onSelect={onSelect}
            onExpand={onExpand}
            expandedNodes={expandedNodes}
          />
        ))}
    </>
  )
}

export function DOMInspectorPanel() {
  const [rootNode, setRootNode] = useState<DOMNode | null>(null)
  const [selectedNode, setSelectedNode] = useState<DOMNode | null>(null)
  const [computedStyles, setComputedStyles] = useState<Record<string, string>>({})
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set())
  const [selectorQuery, setSelectorQuery] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [activeView, setActiveView] = useState<'elements' | 'source'>('elements')
  const [pageSource, setPageSource] = useState('')
  const [sourceLoading, setSourceLoading] = useState(false)
  const [selectedHTML, setSelectedHTML] = useState('')
  const [domBreakpoints, setDomBreakpoints] = useState<DOMBreakpointInfo[]>([])
  const [error, setError] = useState('')

  // Initialize DOM domain
  useEffect(() => {
    const init = async () => {
      try {
        await enableDOM()
        const doc = await getDocument(3)
        if (doc) {
          setRootNode(doc)
          setInitialized(true)
        }
        setDomBreakpoints(await getDOMBreakpoints())
        setError('')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to initialize DOM inspector')
      }
    }
    init()
  }, [])

  const refreshSource = useCallback(async () => {
    setSourceLoading(true)
    try {
      const source = await getPageSource()
      setPageSource(source ? formatHTMLSource(source) : '')
      setError('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to read page source')
    } finally {
      setSourceLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeView === 'source' && !pageSource && !sourceLoading) {
      void refreshSource()
    }
  }, [activeView, pageSource, refreshSource, sourceLoading])

  const handleSelect = useCallback(async (node: DOMNode) => {
    setSelectedNode(node)
    if (node.nodeType !== 1) {
      setComputedStyles({})
      setSelectedHTML(node.nodeValue || node.nodeName || 'No node value available')
      return
    }
    try {
      const [styles, html] = await Promise.all([
        getComputedStyleForNode(node.nodeId),
        getNodeHTML(node.nodeId),
      ])
      setComputedStyles(styles)
      setSelectedHTML(html)
      setError('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to inspect selected node')
    }
  }, [])

  const handleExpand = useCallback(
    async (node: DOMNode) => {
      const isExpanded = expandedNodes.has(node.nodeId)
      if (isExpanded) {
        setExpandedNodes((prev) => {
          const next = new Set(prev)
          next.delete(node.nodeId)
          return next
        })
      } else {
        // If children are not yet loaded, fetch deeper
        if (!node.children || node.children.length === 0) {
          try {
            const doc = await getDocument(6)
            if (doc) {
              setRootNode(doc)
            }
            setError('')
          } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to expand DOM node')
          }
        }
        setExpandedNodes((prev) => {
          const next = new Set(prev)
          next.add(node.nodeId)
          return next
        })
      }
    },
    [expandedNodes]
  )

  const handleSearch = useCallback(async () => {
    if (!selectorQuery.trim()) return
    try {
      const result = await querySelector(selectorQuery.trim())
      if (result) {
        setSelectedNode(result)
        const [styles, html] = await Promise.all([
          getComputedStyleForNode(result.nodeId),
          getNodeHTML(result.nodeId),
        ])
        setComputedStyles(styles)
        setSelectedHTML(html)
        await highlightNode(result.nodeId)
      }
      setError('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to query DOM selector')
    }
  }, [selectorQuery])

  const handleHighlight = useCallback(async () => {
    if (selectedNode) {
      try {
        await highlightNode(selectedNode.nodeId)
        setError('')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to highlight node')
      }
    }
  }, [selectedNode])

  const handleHideHighlight = useCallback(async () => {
    try {
      await hideHighlight()
      setError('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to hide highlight')
    }
  }, [])

  const handleToggleDOMBreakpoint = useCallback(
    async (type: DOMBreakpointType) => {
      if (!selectedNode) return
      const active = domBreakpoints.some(
        (bp) => bp.nodeId === selectedNode.nodeId && bp.type === type
      )
      try {
        if (active) {
          await removeDOMBreakpoint(selectedNode.nodeId, type)
        } else {
          await setDOMBreakpoint(selectedNode.nodeId, type)
        }
        setDomBreakpoints(await getDOMBreakpoints())
        setError('')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to update DOM breakpoint')
      }
    },
    [domBreakpoints, selectedNode]
  )

  const styleEntries = Object.entries(computedStyles)
  const sourceLines = pageSource ? pageSource.split('\n') : []

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-1">
      {/* Top toolbar */}
      <div className="flex items-center h-8 px-3 gap-2 border-b border-border-1 bg-surface-0 flex-shrink-0">
        <Code2 size={12} className="text-text-3" />
        <div className="flex items-center h-6 rounded border border-border-1 bg-surface-1 overflow-hidden">
          <button
            onClick={() => setActiveView('elements')}
            className={cn(
              'h-6 px-2 text-[10px] font-medium transition-colors',
              activeView === 'elements' ? 'bg-accent/15 text-accent' : 'text-text-3 hover:text-text-1'
            )}
          >
            Elements
          </button>
          <button
            onClick={() => setActiveView('source')}
            className={cn(
              'h-6 px-2 text-[10px] font-medium transition-colors border-l border-border-1',
              activeView === 'source' ? 'bg-accent/15 text-accent' : 'text-text-3 hover:text-text-1'
            )}
          >
            Source
          </button>
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search
            size={10}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-text-3"
          />
          <input
            type="text"
            value={selectorQuery}
            onChange={(e) => setSelectorQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch()
            }}
            placeholder="CSS selector..."
            className="h-6 w-full pl-6 pr-2 rounded bg-surface-1 border border-border-1 text-[10px] text-text-1 font-mono placeholder:text-text-3 focus:outline-none focus:border-accent"
          />
        </div>
        {selectedNode && (
          <button
            onClick={handleHighlight}
            onMouseLeave={handleHideHighlight}
            title="Highlight node"
            className="h-6 px-2 rounded text-[10px] text-text-2 hover:text-accent hover:bg-accent/10 transition-colors flex items-center gap-1"
          >
            <Highlighter size={10} />
            Highlight
          </button>
        )}
        {activeView === 'source' && (
          <>
            <button
              onClick={refreshSource}
              title="Refresh source"
              className="h-6 w-6 rounded flex items-center justify-center text-text-2 hover:text-text-1 hover:bg-surface-2 transition-colors"
            >
              <RefreshCw size={11} />
            </button>
            <button
              onClick={() => copyToClipboard(pageSource)}
              title="Copy source"
              disabled={!pageSource}
              className="h-6 w-6 rounded flex items-center justify-center text-text-2 hover:text-text-1 hover:bg-surface-2 transition-colors disabled:opacity-30"
            >
              <Copy size={11} />
            </button>
          </>
        )}
      </div>

      {/* Main content */}
      {error && (
        <div className="mx-3 mt-3 rounded border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
          {error}
        </div>
      )}
      <div className="flex flex-1 min-h-0">
        {/* DOM Tree */}
        <div role={activeView === 'elements' ? 'tree' : undefined} aria-label={activeView === 'elements' ? 'DOM tree' : undefined} className="flex-1 overflow-y-auto py-1 border-r border-border-1">
          {activeView === 'source' ? (
            <div className="h-full min-h-0 overflow-auto bg-surface-0 font-mono text-[10px] leading-4">
              {sourceLoading && (
                <div className="flex items-center justify-center h-full text-text-3 text-xs">
                  Loading source...
                </div>
              )}
              {!sourceLoading && !pageSource && (
                <div className="flex items-center justify-center h-full text-text-3 text-xs">
                  No source available
                </div>
              )}
              {!sourceLoading &&
                sourceLines.map((line, index) => (
                  <div key={index} className="flex min-w-max hover:bg-surface-2/60">
                    <span className="w-12 flex-shrink-0 select-none border-r border-border-1 pr-2 text-right text-text-4 bg-surface-1">
                      {index + 1}
                    </span>
                    <code className="whitespace-pre px-3 text-text-2">{line}</code>
                  </div>
                ))}
            </div>
          ) : !initialized ? (
            <div className="flex items-center justify-center h-full text-text-3 text-xs">
              Loading DOM...
            </div>
          ) : rootNode && (
            <DOMNodeRow
              node={rootNode}
              depth={0}
              selectedNodeId={selectedNode?.nodeId ?? null}
              onSelect={handleSelect}
              onExpand={handleExpand}
              expandedNodes={expandedNodes}
            />
          )}
        </div>

        {/* Computed Styles */}
        <div className="w-[280px] overflow-y-auto flex-shrink-0">
          <div className="px-2 py-1.5 border-b border-border-1 bg-surface-0">
            <span className="text-[10px] text-text-3 uppercase tracking-wide font-medium">
              Selected Node
            </span>
          </div>
          {!selectedNode && (
            <div className="px-2 py-3 text-text-3 text-[10px]">
              Select an element to inspect source, styles and DOM breakpoints
            </div>
          )}
          {selectedNode && (
            <div className="px-2 py-2 space-y-2 border-b border-border-1">
              <div className="flex items-center gap-1 text-[10px] font-mono">
                <FileCode2 size={11} className="text-text-3 flex-shrink-0" />
                <span className="text-accent truncate">{selectedNode.localName || selectedNode.nodeName}</span>
                <span className="text-text-4">#{selectedNode.nodeId}</span>
              </div>
              <div className="max-h-28 overflow-auto rounded border border-border-1 bg-surface-0 p-2 text-[10px] font-mono text-text-2 whitespace-pre-wrap break-words">
                {selectedHTML || 'No outerHTML available'}
              </div>
              <div className="flex items-center gap-1">
                {DOM_BREAKPOINTS.map((item) => {
                  const active = domBreakpoints.some(
                    (bp) => bp.nodeId === selectedNode.nodeId && bp.type === item.type
                  )
                  return (
                    <button
                      key={item.type}
                      onClick={() => handleToggleDOMBreakpoint(item.type)}
                      title={`Toggle ${item.label} DOM breakpoint`}
                      className={cn(
                        'h-6 px-2 rounded border text-[10px] flex items-center gap-1 transition-colors',
                        active
                          ? 'border-red-500/40 bg-red-500/10 text-red-300'
                          : 'border-border-1 bg-surface-0 text-text-3 hover:text-text-1'
                      )}
                    >
                      <CircleDot size={9} />
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <div className="px-2 py-1.5 border-b border-border-1 bg-surface-0">
            <span className="text-[10px] text-text-3 uppercase tracking-wide font-medium">
              Computed Styles
            </span>
          </div>
          {styleEntries.length === 0 && (
            <div className="flex items-center justify-center h-24 text-text-3 text-[10px]">
              Select a node to view styles
            </div>
          )}
          <div className="px-2 py-1 space-y-px">
            {styleEntries.map(([key, value]) => (
              <div
                key={key}
                className="flex items-baseline gap-1 text-[10px] font-mono py-px"
              >
                <span className="text-accent flex-shrink-0">{key}:</span>
                <span className="text-text-2 truncate">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

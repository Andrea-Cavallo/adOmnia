import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  enableDOM,
  getDocument,
  getComputedStyleForNode,
  querySelector,
  highlightNode,
  hideHighlight,
  type DOMNode,
} from '@/lib/browser-debug-api'
import {
  Code2,
  ChevronRight,
  ChevronDown,
  Search,
  Highlighter,
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

function DOMNodeRow({
  node,
  depth,
  selectedNodeId,
  onSelect,
  onExpand,
  expandedNodes,
}: DOMNodeRowProps) {
  const isElement = node.nodeType === 1
  const isText = node.nodeType === 3
  const isExpanded = expandedNodes.has(node.nodeId)
  const hasChildren = node.childCount > 0
  const isSelected = selectedNodeId === node.nodeId

  if (isText) {
    const text = node.nodeName === '#text' ? node.localName || '' : node.nodeName
    if (!text.trim()) return null
    return (
      <div
        className="flex items-center py-px"
        style={{ paddingLeft: `${depth * 16 + 20}px` }}
      >
        <span className="text-text-3 text-[10px] font-mono truncate">
          &quot;{text.trim().slice(0, 80)}
          {text.trim().length > 80 ? '...' : ''}&quot;
        </span>
      </div>
    )
  }

  if (!isElement) return null

  const attrs = formatAttributes(node.attributes)

  return (
    <>
      <div
        className={cn(
          'flex items-center py-px cursor-pointer hover:bg-surface-2/50 transition-colors',
          isSelected && 'bg-accent/10'
        )}
        style={{ paddingLeft: `${depth * 16}px` }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <button
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

        <span className="text-[10px] font-mono flex items-center gap-0.5 truncate">
          <span className="text-text-3">&lt;</span>
          <span className="text-accent font-medium">{node.localName}</span>
          {attrs.map((attr) => (
            <span key={attr.name} className="ml-1">
              <span className="text-green-400">{attr.name}</span>
              <span className="text-text-3">=&quot;</span>
              <span className="text-text-2">{attr.value}</span>
              <span className="text-text-3">&quot;</span>
            </span>
          ))}
          <span className="text-text-3">&gt;</span>
        </span>
      </div>

      {isExpanded &&
        node.children?.map((child) => (
          <DOMNodeRow
            key={child.nodeId}
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

  // Initialize DOM domain
  useEffect(() => {
    const init = async () => {
      await enableDOM()
      const doc = await getDocument(3)
      if (doc) {
        setRootNode(doc)
        setInitialized(true)
      }
    }
    init()
  }, [])

  const handleSelect = useCallback(async (node: DOMNode) => {
    setSelectedNode(node)
    const styles = await getComputedStyleForNode(node.nodeId)
    setComputedStyles(styles)
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
          const doc = await getDocument(6)
          if (doc) {
            setRootNode(doc)
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
    const result = await querySelector(selectorQuery.trim())
    if (result) {
      setSelectedNode(result)
      const styles = await getComputedStyleForNode(result.nodeId)
      setComputedStyles(styles)
    }
  }, [selectorQuery])

  const handleHighlight = useCallback(async () => {
    if (selectedNode) {
      await highlightNode(selectedNode.nodeId)
    }
  }, [selectedNode])

  const handleHideHighlight = useCallback(async () => {
    await hideHighlight()
  }, [])

  const styleEntries = Object.entries(computedStyles)

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-1">
      {/* Top toolbar */}
      <div className="flex items-center h-8 px-3 gap-2 border-b border-border-1 bg-surface-0 flex-shrink-0">
        <Code2 size={12} className="text-text-3" />
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
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* DOM Tree */}
        <div className="flex-1 overflow-y-auto py-1 border-r border-border-1">
          {!initialized && (
            <div className="flex items-center justify-center h-full text-text-3 text-xs">
              Loading DOM...
            </div>
          )}
          {rootNode && (
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

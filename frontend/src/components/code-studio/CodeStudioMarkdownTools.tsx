import { useEffect, useMemo, useState } from 'react'
import { GitBranch, Loader2, PanelRight } from 'lucide-react'

import { BacklinksPanel } from '@/components/markdown/BacklinksPanel'
import { MarkdownGraphView } from '@/components/markdown/MarkdownGraphView'
import { MarkdownOutline } from '@/components/markdown/MarkdownOutline'
import type { MarkdownFileEntry } from '@/lib/markdown-api'
import { quickOpenGoIDEFiles } from '@/lib/code-studio-api'
import { requestProjectSearch } from '@/lib/code-studio-lsp-api'
import { buildGraphNodes, extractHeadings, type GraphNode, type MarkdownEdge } from '@/lib/markdownDoc'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import {
  backlinkEdges,
  backlinkSearchPattern,
  dedupeBacklinks,
  entryFor,
  filterGraph,
  graphNeighborhood,
  resolveEntryFrom,
  unresolvedTargets,
  type BacklinkMatch,
} from '@/lib/code-studio/codeStudioMarkdownTools'

/** Quanti target ignoti cercare prima di rinunciare a risolverli (il grafo è locale). */
const MAX_TARGET_LOOKUPS = 12
/** Quanti backlink si mostrano per nota. */
const MAX_BACKLINKS = 50

interface CodeStudioMarkdownToolsProps {
  document: GoIDEEditorDocument
  onJumpToLine: (line: number) => void
}

/**
 * Pannelli laterali del documento Markdown (FIX.md GS-7.4): outline del buffer, note che
 * citano il documento (ricerca nel progetto) e grafo locale. Nessuno stato Hub
 * (`adomnia.markdown.*`) e nessun backend `internal/markdown`.
 */
export function CodeStudioMarkdownTools({ document, onJumpToLine }: CodeStudioMarkdownToolsProps) {
  const sessionId = document.document.sessionId
  const path = document.document.relativePath
  const openDocument = useCodeStudioStore((state) => state.openDocument)
  const searchKey = `${sessionId}|${path}`
  const [backlinkResult, setBacklinkResult] = useState<{ key: string; list: BacklinkMatch[] } | null>(null)
  const backlinks = backlinkResult?.list ?? []
  const searching = backlinkResult?.key !== searchKey
  const [neighborhood, setNeighborhood] = useState<{ files: MarkdownFileEntry[]; edges: MarkdownEdge[] } | null>(null)
  const [graphOpen, setGraphOpen] = useState(false)
  const [graphPositions, setGraphPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [graphOffset, setGraphOffset] = useState({ x: 0, y: 0 })
  const [graphScale, setGraphScale] = useState(1)
  const [showOrphans, setShowOrphans] = useState(false)
  const [showUnresolved, setShowUnresolved] = useState(true)
  const [folderFilter, setFolderFilter] = useState('')

  const headings = useMemo(() => extractHeadings(document.buffer), [document.buffer])

  // Backlink: una ricerca nel progetto invece di leggere ogni nota (GS-7.4).
  useEffect(() => {
    let cancelled = false
    const request = requestProjectSearch({
      sessionId,
      pattern: backlinkSearchPattern(path),
      regex: true,
      caseSensitive: false,
      wholeWord: false,
      include: ['*.md'],
      exclude: [],
    })
    request
      .then((result) => {
        if (cancelled) return
        setBacklinkResult({ key: searchKey, list: dedupeBacklinks(path, result.matches
          .filter((match) => /\.md$/i.test(match.relativePath))
          .map((match) => ({ relativePath: match.relativePath, line: match.line, preview: match.preview }))
        ).slice(0, MAX_BACKLINKS) })
      })
      .catch(() => {
        if (cancelled) return
        setBacklinkResult({ key: searchKey, list: [] })
      })
    return () => {
      cancelled = true
      try { request.cancel() } catch { /* annullamento best-effort */ }
    }
  }, [path, sessionId, searchKey])

  /** Il grafo si costruisce all'apertura: risolve i target ignoti e poi calcola archi e nodi. */
  const openGraph = async () => {
    setGraphOpen(true)
    setNeighborhood(null)
    const active = entryFor(path)
    const wanted = unresolvedTargets(active, document.buffer, []).slice(0, MAX_TARGET_LOOKUPS)
    const resolved = (await Promise.all(wanted.map(async (target) => {
      try {
        const results = await quickOpenGoIDEFiles(sessionId, target, 6)
        return resolveEntryFrom(target, results)
      } catch {
        return undefined
      }
    }))).filter((entry): entry is MarkdownFileEntry => Boolean(entry))
    setNeighborhood(graphNeighborhood(active, document.buffer, resolved, backlinks))
  }

  const graph = useMemo<{ nodes: GraphNode[]; edges: MarkdownEdge[] }>(() => {
    if (!neighborhood) return { nodes: [], edges: [] }
    const laidOut = buildGraphNodes(neighborhood.files, neighborhood.edges, entryFor(path))
    const nodes = laidOut.map((node) => (graphPositions[node.id] ? { ...node, ...graphPositions[node.id] } : node))
    const visible = filterGraph(nodes, neighborhood.edges, path, { showOrphans, showUnresolved })
    if (!folderFilter) return visible
    const kept = visible.nodes.filter((node) => node.id === path || node.file?.dir === folderFilter)
    const ids = new Set(kept.map((node) => node.id))
    return { nodes: kept, edges: visible.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)) }
  }, [folderFilter, graphPositions, neighborhood, path, showOrphans, showUnresolved])

  const folderOptions = useMemo(() => {
    const folders = new Set<string>()
    for (const file of neighborhood?.files ?? []) if (file.dir) folders.add(file.dir)
    return [...folders].sort((a, b) => a.localeCompare(b))
  }, [neighborhood])

  const openFile = (file: MarkdownFileEntry) => { void openDocument(file.relPath) }

  return (
    <>
      <aside aria-label="Markdown tools" className="flex w-56 shrink-0 flex-col border-l border-border-1 bg-[var(--gs-island,var(--color-surface-0))]">
        <MarkdownOutline headings={headings} onJumpToLine={onJumpToLine} />
        {searching ? (
          <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-4"><Loader2 size={12} className="animate-spin" /> Searching backlinks…</div>
        ) : (
          <BacklinksPanel
            backlinks={backlinkEdges(path, backlinks)}
            files={backlinks.map((item) => entryFor(item.relativePath))}
            onOpenFile={openFile}
          />
        )}
        <button
          type="button"
          onClick={() => void openGraph()}
          className="flex items-center gap-2 border-t border-border-1 px-3 py-2 text-left text-[11px] text-text-3 hover:bg-surface-1 hover:text-text-1"
        >
          <GitBranch size={12} /> Open local graph
        </button>
      </aside>
      <MarkdownGraphView
        activeFile={entryFor(path)}
        agentGraphPath=""
        edgesCount={neighborhood?.edges.length ?? 0}
        filesCount={neighborhood?.files.length ?? 0}
        folderFilter={folderFilter}
        folderOptions={folderOptions}
        graphNodes={graph.nodes}
        graphOffset={graphOffset}
        graphScale={graphScale}
        showOrphans={showOrphans}
        showUnresolved={showUnresolved}
        unresolvedCount={(neighborhood?.edges ?? []).filter((edge) => !edge.resolved).length}
        visibleEdges={graph.edges}
        onFolderFilterChange={setFolderFilter}
        onOpenChange={setGraphOpen}
        onOpenFile={openFile}
        onResetLayout={() => { setGraphPositions({}); setGraphScale(1); setGraphOffset({ x: 0, y: 0 }) }}
        open={graphOpen}
        setGraphOffset={setGraphOffset}
        setGraphPositions={setGraphPositions}
        setGraphScale={setGraphScale}
        setShowOrphans={setShowOrphans}
        setShowUnresolved={setShowUnresolved}
      />
    </>
  )
}

/** Bottone di apertura dei pannelli: accanto al commutatore editor/split/anteprima. */
export function MarkdownToolsButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label="Markdown tools: outline, backlinks and graph"
      title="Markdown tools: outline, backlinks and graph"
      onClick={onToggle}
      className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${open ? 'bg-accent/20 text-accent' : 'text-text-4 hover:bg-surface-3 hover:text-text-2'}`}
    >
      <PanelRight size={13} />
    </button>
  )
}

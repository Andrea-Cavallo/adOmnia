// Pannelli laterali Markdown per l'IDE (FIX.md GS-7.4): outline, backlinks e grafo locale.
// I dati arrivano da Code Studio (ricerca nel progetto e buffer aperti): nessuno stato Hub
// (`adomnia.markdown.*`) e nessun backend `internal/markdown`, che restano del rail rimosso.
import type { MarkdownFileEntry } from '@/lib/markdown-api'
import { buildFileLookup, extractMarkdownEdges, noteKey, type MarkdownEdge } from '@/lib/markdownDoc'

export interface BacklinkMatch {
  relativePath: string
  line: number
  preview: string
}

export interface GraphNeighborhood {
  files: MarkdownFileEntry[]
  edges: MarkdownEdge[]
}

export interface GraphFilters {
  showOrphans: boolean
  showUnresolved: boolean
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Una sola ricerca copre tutti i modi di linkare una nota: `](…nome…)` per i link
 * Markdown e `[[nome]]`, `[[nome|etichetta]]`, `[[nome#ancora]]` per i wiki link.
 * Il pattern è una regexp Go (RE2): niente lookahead.
 */
export function backlinkSearchPattern(relPath: string): string {
  const name = relPath.split('/').pop() ?? relPath
  const stem = name.replace(/\.[A-Za-z0-9]+$/, '')
  const targets = [...new Set([relPath, name, stem])].map(escapeRegExp).join('|')
  return `\\]\\([^)]*(?:${targets})[^)]*\\)|\\[\\[(?:${targets})(?:[\\]|#])`
}

/** Via i match della nota stessa e i duplicati (stesso file e riga), tenendo la prima anteprima. */
export function dedupeBacklinks(target: string, matches: BacklinkMatch[]): BacklinkMatch[] {
  const seen = new Set<string>()
  return matches.filter((match) => {
    if (match.relativePath === target) return false
    const key = `${match.relativePath} ${match.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** `MarkdownFileEntry` minimo per i componenti riusabili, a partire da un percorso del progetto. */
export function entryFor(relPath: string): MarkdownFileEntry {
  const slash = relPath.lastIndexOf('/')
  return {
    name: slash === -1 ? relPath : relPath.slice(slash + 1),
    path: relPath,
    relPath,
    dir: slash === -1 ? '' : relPath.slice(0, slash),
    size: 0,
    modifiedAt: '',
  }
}

/** Archi che puntano alla nota attiva, uno per backlink; wiki se l'anteprima contiene `[[`. */
export function backlinkEdges(target: string, matches: BacklinkMatch[]): MarkdownEdge[] {
  return dedupeBacklinks(target, matches).map((match) => ({
    from: match.relativePath,
    to: target,
    label: match.preview.trim(),
    resolved: true,
    type: match.preview.includes('[[') ? 'wiki' : 'markdown',
  }))
}

/**
 * Grafo locale della nota attiva: i link in uscita dal buffer più le note che la citano.
 * La risoluzione dei link usa lo stesso indice del modulo Markdown (`buildFileLookup`);
 * i target ignoti restano nodi irrisolti.
 */
export function graphNeighborhood(active: MarkdownFileEntry, content: string, known: MarkdownFileEntry[], backlinks: BacklinkMatch[]): GraphNeighborhood {
  const lookup = buildFileLookup([...known, active])
  const edges = [...extractMarkdownEdges(active, content, lookup), ...backlinkEdges(active.relPath, backlinks)]
  const files = new Map<string, MarkdownFileEntry>([[active.relPath, active]])
  for (const edge of edges) {
    for (const ref of [edge.from, edge.to]) {
      const hit = lookup.get(noteKey(ref))
      if (hit) files.set(hit.relPath, hit)
    }
  }
  return { files: [...files.values()], edges }
}

/** Target dei link in uscita ancora ignoti: da cercare nel progetto prima del grafo. */
export function unresolvedTargets(active: MarkdownFileEntry, content: string, known: MarkdownFileEntry[]): string[] {
  const lookup = buildFileLookup([...known, active])
  return [...new Set(extractMarkdownEdges(active, content, lookup).filter((edge) => !edge.resolved).map((edge) => edge.to))]
}

/**
 * Tra i risultati di Quick Open cerca il file che risolve un target di link
 * ("guide.md" → "docs/guide.md"), per nome o percorso, senza approssimazioni.
 */
export function resolveEntryFrom(target: string, results: Array<{ relativePath: string }>): MarkdownFileEntry | undefined {
  const wanted = noteKey(target)
  const hit = results.find((result) => noteKey(result.relativePath) === wanted)
    ?? results.find((result) => noteKey(result.relativePath.split('/').pop() ?? '') === wanted)
  return hit ? entryFor(hit.relativePath) : undefined
}

/** Nodi senza nessun arco oltre alla nota attiva: nascosti finché "Orphans" non li mostra. */
export function isOrphan(nodeId: string, activeId: string, edges: MarkdownEdge[]): boolean {
  return nodeId !== activeId && !edges.some((edge) => edge.from === nodeId || edge.to === nodeId)
}

/** Filtri del grafo: irrisolti e orfani si nascondono, la nota attiva resta sempre. */
export function filterGraph<T extends { id: string; unresolved?: boolean }>(nodes: T[], edges: MarkdownEdge[], activeId: string, filters: GraphFilters): { nodes: T[]; edges: MarkdownEdge[] } {
  const visibleNodes = nodes.filter((node) => {
    if (node.id === activeId) return true
    if (node.unresolved && !filters.showUnresolved) return false
    return filters.showOrphans || !isOrphan(node.id, activeId, edges)
  })
  const ids = new Set(visibleNodes.map((node) => node.id))
  return {
    nodes: visibleNodes,
    edges: edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
  }
}

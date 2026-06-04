// Pure domain model + helpers for the Markdown workspace.
// No React, no DOM, no Wails — safe to unit-test and reuse across components.
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force'
import type { MarkdownFileEntry } from '@/lib/markdown-api'

export type { MarkdownFileEntry }

/** Editor/preview layout for the Markdown panel. */
export type MarkdownViewMode = 'split' | 'edit' | 'preview'

// ── Domain types ──────────────────────────────────────────────────────────────

export interface MarkdownWorkspace {
  root: string
  activeRelPath?: string
  files: MarkdownFileEntry[]
}

export interface MarkdownLink {
  from: string
  to: string
  label: string
  type: 'markdown' | 'wiki'
  resolved: boolean
}

export interface MarkdownEdge {
  from: string
  to: string
  label: string
  resolved: boolean
  type: 'markdown' | 'wiki'
}

export interface MarkdownGraphNode {
  id: string
  title: string
  relPath?: string
  unresolved?: boolean
  tags: string[]
}

export interface MarkdownGraphEdge {
  from: string
  to: string
  label: string
  resolved: boolean
}

export interface MarkdownTreeNode {
  name: string
  relPath: string
  children: MarkdownTreeNode[]
  file?: MarkdownFileEntry
}

export interface GraphNode {
  id: string
  label: string
  x: number
  y: number
  file?: MarkdownFileEntry
  unresolved?: boolean
}

export interface MarkdownHeading {
  level: number
  text: string
  line: number
}

export interface AgentGraphFile {
  schema: 'adomnia.markdown.graph'
  version: 1
  generatedAt: string
  root: string
  summary: {
    notes: number
    edges: number
    unresolved: number
    tags: string[]
  }
  workspace: MarkdownWorkspace
  links: MarkdownLink[]
  graph: {
    nodes: MarkdownGraphNode[]
    edges: MarkdownGraphEdge[]
  }
  nodes: Array<{
    id: string
    title: string
    path: string
    size: number
    modifiedAt: string
    headings: MarkdownHeading[]
    tags: string[]
    backlinks: string[]
    outgoing: string[]
    unresolvedOutgoing: string[]
  }>
  edges: Array<{
    from: string
    to: string
    label: string
    resolved: boolean
  }>
}

export const RECENT_MARKDOWN_ROOT_KEY = 'adomnia.markdown.recentRoot'
export const MARKDOWN_UI_STATE_KEY = 'adomnia.markdown.uiState'

export const welcomeNote = [
  '# Markdown Workspace',
  '',
  'Open a folder of `.md` files or create a new note.',
  '',
  '- Local files stay on disk',
  '- Ctrl+S / Cmd+S saves the active note',
  '- `[[Wiki links]]` and `[markdown links](note.md)` are indexed for graph/backlinks',
].join('\n')

export const EMPTY_FOLDER_NOTE = '# Empty Markdown Folder\n\nCreate a new note to start.'

// ── Safe rendering ──────────────────────────────────────────────────────────

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function sanitizeUrl(url: string): string {
  const t = url.trim()
  const lower = t.toLowerCase()
  if (!t) return '#'
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return '#'
  if (lower.startsWith('data:') && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(t)) return '#'
  return t
}

export function renderMarkdown(md: string): string {
  const codeBlocks: string[] = []
  const withFrontmatter = md.replace(/^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/, (_m, body) => {
    const safe = esc(body.trim())
    const html = [
      '<div class="my-3 rounded-md border border-border-2 overflow-hidden text-xs">',
      '<div class="px-3 py-1.5 bg-surface-3 border-b border-border-2 font-mono text-text-4 uppercase" style="font-size:9px">frontmatter</div>',
      `<pre class="bg-surface-2 px-4 py-3 overflow-x-auto m-0 leading-5"><code class="font-mono text-text-2 whitespace-pre" style="font-size:11px">${safe}</code></pre>`,
      '</div>',
    ].join('')
    const idx = codeBlocks.length
    codeBlocks.push(html)
    return `\x00BLK${idx}\x00`
  })
  const text = withFrontmatter.replace(/```([\w.-]*)\r?\n([\s\S]*?)```/g, (_m, lang, code) => {
    const label = lang || 'code'
    const safe = esc(code.replace(/\r?\n$/, ''))
    const html = [
      '<div class="my-3 rounded-md border border-border-2 overflow-hidden text-xs">',
      '<div class="flex items-center gap-2 px-3 py-1.5 bg-surface-3 border-b border-border-2">',
      `<span class="font-mono font-semibold text-text-4 uppercase" style="font-size:9px">${esc(label)}</span>`,
      '</div>',
      '<pre class="bg-surface-2 px-4 py-3 overflow-x-auto m-0 leading-5">',
      `<code class="font-mono text-text-2 whitespace-pre" style="font-size:11px">${safe}</code>`,
      '</pre></div>',
    ].join('')
    const idx = codeBlocks.length
    codeBlocks.push(html)
    return `\x00BLK${idx}\x00`
  })

  function inlineEsc(raw: string): string {
    let s = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const inlineCodes: string[] = []
    s = s.replace(/`([^`\n]+)`/g, (_m, c) => {
      const html = `<code class="bg-surface-2 border border-border-2 px-1 py-px rounded font-mono text-accent-light" style="font-size:11px">${esc(c)}</code>`
      const i = inlineCodes.length
      inlineCodes.push(html)
      return `\x00IC${i}\x00`
    })
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong class="font-semibold text-text-1"><em>$1</em></strong>')
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-text-1">$1</strong>')
    s = s.replace(/\*([^*\n]+)\*/g, '<em class="italic text-text-2">$1</em>')
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) =>
      `<img src="${esc(sanitizeUrl(src))}" alt="${esc(alt)}" class="max-w-full rounded my-2 block" loading="lazy" />`)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) =>
      `<a href="${esc(sanitizeUrl(href))}" class="text-accent underline hover:opacity-80 transition-opacity">${label}</a>`)
    s = s.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_m, target, alias) =>
      `<a href="adomnia-md:${esc(target)}" class="text-accent underline hover:opacity-80 transition-opacity">${esc(alias || target)}</a>`)
    inlineCodes.forEach((h, i) => { s = s.replace(`\x00IC${i}\x00`, h) })
    return s
  }

  const out: string[] = []
  let inUL = false
  let inOL = false
  const closeList = () => {
    if (inUL) { out.push('</ul>'); inUL = false }
    if (inOL) { out.push('</ol>'); inOL = false }
  }

  const lines = text.split('\n')
  for (let idx = 0; idx < lines.length; idx += 1) {
    const raw = lines[idx]
    const line = raw.trim()
    const block = line.match(/^\x00BLK(\d+)\x00$/)
    if (block) { closeList(); out.push(codeBlocks[Number(block[1])]); continue }
    if (/^---+$/.test(line)) { closeList(); out.push('<hr class="border-border-1 my-4" />'); continue }

    if (line.includes('|') && lines[idx + 1]?.trim().match(/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/)) {
      closeList()
      const header = line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
      const rows: string[][] = []
      idx += 2
      while (idx < lines.length && lines[idx].trim().includes('|')) {
        rows.push(lines[idx].trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
        idx += 1
      }
      idx -= 1
      out.push('<div class="my-3 overflow-x-auto rounded-md border border-border-2"><table class="w-full border-collapse text-xs">')
      out.push('<thead><tr>')
      header.forEach((cell) => out.push(`<th class="border-b border-border-2 bg-surface-2 px-3 py-2 text-left font-semibold text-text-1">${inlineEsc(cell)}</th>`))
      out.push('</tr></thead><tbody>')
      rows.forEach((row) => {
        out.push('<tr>')
        header.forEach((_, cellIndex) => out.push(`<td class="border-b border-border-1 px-3 py-2 text-text-2">${inlineEsc(row[cellIndex] || '')}</td>`))
        out.push('</tr>')
      })
      out.push('</tbody></table></div>')
      continue
    }

    const h = raw.match(/^(#{1,6})\s+(.+)/)
    if (h) {
      closeList()
      const level = h[1].length
      const classes = [
        'text-xl font-bold mt-4 mb-3 pb-1.5 border-b border-border-1',
        'text-lg font-bold mt-5 mb-2 pb-1 border-b border-border-1',
        'text-base font-semibold mt-4 mb-1 pb-1 border-b border-border-1',
        'text-sm font-semibold mt-3 mb-1',
        'text-xs font-semibold mt-2 mb-0.5',
        'text-xs font-medium mt-2 mb-0.5',
      ][level - 1]
      out.push(`<h${level} class="${classes} text-text-1">${inlineEsc(h[2])}</h${level}>`)
      continue
    }

    const bq = raw.match(/^>\s*(.+)/)
    if (bq) {
      closeList()
      out.push(`<blockquote class="border-l-[3px] border-accent/50 pl-3 my-2 text-text-3 italic text-xs leading-relaxed">${inlineEsc(bq[1])}</blockquote>`)
      continue
    }

    const task = raw.match(/^[-*+]\s+\[( |x|X)]\s+(.+)/)
    if (task) {
      if (!inUL) { closeList(); out.push('<ul class="my-1.5 space-y-0.5">'); inUL = true }
      const checked = task[1].toLowerCase() === 'x' ? 'checked' : ''
      out.push(`<li class="flex gap-1.5 text-text-2 text-xs leading-relaxed"><input type="checkbox" ${checked} disabled class="mt-0.5" /><span>${inlineEsc(task[2])}</span></li>`)
      continue
    }

    const ul = raw.match(/^[-*+]\s+(.+)/)
    if (ul) {
      if (!inUL) { closeList(); out.push('<ul class="my-1.5 space-y-0.5">'); inUL = true }
      out.push(`<li class="flex gap-1.5 text-text-2 text-xs leading-relaxed"><span class="text-text-4 select-none shrink-0 mt-px">-</span><span>${inlineEsc(ul[1])}</span></li>`)
      continue
    }

    const ol = raw.match(/^(\d+)\.\s+(.+)/)
    if (ol) {
      if (!inOL) { closeList(); out.push('<ol class="my-1.5 space-y-0.5 list-decimal list-inside">'); inOL = true }
      out.push(`<li class="text-text-2 text-xs leading-relaxed">${inlineEsc(ol[2])}</li>`)
      continue
    }

    if (inUL || inOL) closeList()
    if (!line) { out.push('<div class="h-2"></div>'); continue }
    out.push(`<p class="text-text-2 text-xs leading-relaxed my-1">${inlineEsc(raw)}</p>`)
  }

  closeList()
  return out.join('\n')
}

// ── Link indexing + resolution ────────────────────────────────────────────────

export function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function noteKey(path: string): string {
  return normalizeRelPath(path).replace(/#.*$/, '').replace(/\.(md|markdown)$/i, '').toLowerCase()
}

export function noteTitle(file: MarkdownFileEntry): string {
  return file.name.replace(/\.(md|markdown)$/i, '')
}

export function buildFileLookup(files: MarkdownFileEntry[]): Map<string, MarkdownFileEntry> {
  const lookup = new Map<string, MarkdownFileEntry>()
  files.forEach((file) => {
    lookup.set(noteKey(file.relPath), file)
    lookup.set(noteKey(file.name), file)
    lookup.set(noteKey(noteTitle(file)), file)
  })
  return lookup
}

// Collapse `.` and `..` segments so parent-relative links (e.g. `../concepts.md`)
// resolve against the flat note index.
function collapseRelative(path: string): string {
  const out: string[] = []
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { out.pop(); continue }
    out.push(seg)
  }
  return out.join('/')
}

export function resolveMarkdownTarget(
  target: string,
  fromFile: MarkdownFileEntry,
  lookup: Map<string, MarkdownFileEntry>,
): MarkdownFileEntry | undefined {
  const clean = target.trim().replace(/^adomnia-md:/, '').replace(/#.*$/, '')
  if (!clean || /^(https?:|mailto:|tel:|data:|javascript:)/i.test(clean)) return undefined
  const fromDir = fromFile.dir === '.' ? '' : fromFile.dir
  const candidates = [
    clean,
    `${clean}.md`,
    fromDir ? `${fromDir}/${clean}` : clean,
    fromDir ? `${fromDir}/${clean}.md` : `${clean}.md`,
  ]
  for (const candidate of candidates) {
    const hit = lookup.get(noteKey(collapseRelative(candidate)))
    if (hit) return hit
  }
  return undefined
}

export function extractMarkdownEdges(
  file: MarkdownFileEntry,
  content: string,
  lookup: Map<string, MarkdownFileEntry>,
): MarkdownEdge[] {
  const edges: MarkdownEdge[] = []
  const pushTarget = (target: string, label: string, type: MarkdownEdge['type']) => {
    const resolved = resolveMarkdownTarget(target, file, lookup)
    edges.push({
      from: file.relPath,
      to: resolved?.relPath || target.replace(/#.*$/, ''),
      label,
      resolved: Boolean(resolved),
      type,
    })
  }

  const standard = /!?\[[^\]]*]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = standard.exec(content))) pushTarget(match[1], match[1], 'markdown')

  const wiki = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?]]/g
  while ((match = wiki.exec(content))) pushTarget(match[1], match[2] || match[1], 'wiki')
  return edges
}

export function buildMarkdownTree(files: MarkdownFileEntry[]): MarkdownTreeNode[] {
  const root: MarkdownTreeNode = { name: '', relPath: '', children: [] }
  for (const file of files) {
    const parts = file.relPath.split('/').filter(Boolean)
    let current = root
    parts.forEach((part, index) => {
      const relPath = parts.slice(0, index + 1).join('/')
      let child = current.children.find((node) => node.name === part)
      if (!child) {
        child = { name: part, relPath, children: [] }
        current.children.push(child)
      }
      if (index === parts.length - 1) child.file = file
      current = child
    })
  }
  const sortNodes = (nodes: MarkdownTreeNode[]) => {
    nodes.sort((a, b) => {
      if (Boolean(a.file) !== Boolean(b.file)) return a.file ? 1 : -1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((node) => sortNodes(node.children))
  }
  sortNodes(root.children)
  return root.children
}

export function buildGraphNodes(
  files: MarkdownFileEntry[],
  edges: MarkdownEdge[],
  activeFile: MarkdownFileEntry | null,
): GraphNode[] {
  const ids = new Map<string, MarkdownFileEntry | undefined>()
  files.forEach((file) => ids.set(file.relPath, file))
  edges.forEach((edge) => {
    if (!edge.resolved && !ids.has(edge.to)) ids.set(edge.to, undefined)
  })
  const entries = Array.from(ids.entries()).slice(0, 80)
  const centerX = 150
  const centerY = 92
  const radius = Math.max(42, Math.min(76, entries.length * 4))
  type D3GraphNode = GraphNode & SimulationNodeDatum
  const nodes: D3GraphNode[] = entries.map(([id, file], index) => {
    const angle = entries.length <= 1 ? 0 : (Math.PI * 2 * index) / entries.length - Math.PI / 2
    const isActive = activeFile?.relPath === id
    return {
      id,
      file,
      label: file ? noteTitle(file) : id,
      x: isActive ? centerX : centerX + Math.cos(angle) * radius,
      y: isActive ? centerY : centerY + Math.sin(angle) * radius,
      unresolved: !file,
    }
  })
  const nodeIds = new Set(nodes.map((node) => node.id))
  const links = edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .map((edge) => ({ source: edge.from, target: edge.to }))
  const simulation = forceSimulation<D3GraphNode>(nodes)
    .force('link', forceLink<D3GraphNode, { source: string; target: string }>(links).id((node) => node.id).distance(50).strength(0.42))
    .force('charge', forceManyBody().strength(-95))
    .force('collide', forceCollide<D3GraphNode>().radius(14))
    .force('center', forceCenter(centerX, centerY).strength(0.08))
    .stop()
  simulation.tick(130)
  nodes.forEach((node) => {
    if (activeFile?.relPath === node.id) {
      node.x = centerX
      node.y = centerY
      return
    }
    node.x = Math.max(14, Math.min(286, node.x ?? centerX))
    node.y = Math.max(14, Math.min(170, node.y ?? centerY))
  })
  return nodes
}

export function extractHeadings(content: string): MarkdownHeading[] {
  return content.split('\n').flatMap((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+)/)
    if (!match) return []
    return [{ level: match[1].length, text: match[2].trim(), line: index + 1 }]
  })
}

export function extractTags(content: string): string[] {
  const tags = new Set<string>()
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (frontmatter) {
    const tagLine = frontmatter[1].match(/^tags:\s*(.+)$/m)
    if (tagLine) {
      tagLine[1]
        .replace(/[[\],]/g, ' ')
        .split(/\s+/)
        .map((tag) => tag.replace(/^#/, '').trim())
        .filter(Boolean)
        .forEach((tag) => tags.add(tag))
    }
  }
  const inline = content.matchAll(/(^|\s)#([A-Za-z0-9_/-]{2,})/g)
  for (const match of inline) tags.add(match[2])
  return Array.from(tags).sort((a, b) => a.localeCompare(b))
}

export function buildAgentGraph(
  root: string,
  files: MarkdownFileEntry[],
  contentsByPath: Record<string, string>,
  edges: MarkdownEdge[],
): AgentGraphFile {
  const allTags = new Set<string>()
  const unresolved = new Set(edges.filter((edge) => !edge.resolved).map((edge) => edge.to))
  const nodes = files.map((file) => {
    const content = contentsByPath[file.path] || ''
    const tags = extractTags(content)
    tags.forEach((tag) => allTags.add(tag))
    const outgoing = edges.filter((edge) => edge.from === file.relPath && edge.resolved).map((edge) => edge.to)
    const unresolvedOutgoing = edges.filter((edge) => edge.from === file.relPath && !edge.resolved).map((edge) => edge.to)
    const backlinks = edges.filter((edge) => edge.to === file.relPath && edge.resolved).map((edge) => edge.from)
    return {
      id: file.relPath,
      title: noteTitle(file),
      path: file.path,
      size: file.size,
      modifiedAt: file.modifiedAt,
      headings: extractHeadings(content),
      tags,
      backlinks: Array.from(new Set(backlinks)).sort(),
      outgoing: Array.from(new Set(outgoing)).sort(),
      unresolvedOutgoing: Array.from(new Set(unresolvedOutgoing)).sort(),
    }
  })
  return {
    schema: 'adomnia.markdown.graph',
    version: 1,
    generatedAt: new Date().toISOString(),
    root,
    summary: {
      notes: files.length,
      edges: edges.length,
      unresolved: unresolved.size,
      tags: Array.from(allTags).sort(),
    },
    workspace: {
      root,
      files,
    },
    links: edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      label: edge.label,
      type: edge.type,
      resolved: edge.resolved,
    })),
    graph: {
      nodes: nodes.map((node) => ({
        id: node.id,
        title: node.title,
        relPath: node.id,
        tags: node.tags,
      })),
      edges: edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        label: edge.label,
        resolved: edge.resolved,
      })),
    },
    nodes,
    edges: edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      label: edge.label,
      resolved: edge.resolved,
    })),
  }
}

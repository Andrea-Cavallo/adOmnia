import { describe, expect, it } from 'vitest'
import {
  buildAgentGraph,
  buildFileLookup,
  buildGraphNodes,
  buildMarkdownTree,
  classifyMemoryRelation,
  extractHeadings,
  extractMarkdownEdges,
  extractTags,
  renderMarkdown,
  resolveMarkdownTarget,
  type MarkdownFileEntry,
} from './markdownDoc'

// ── Fixture: a workspace of 20+ markdown notes across nested folders ───────────

function entry(relPath: string, content: string): { file: MarkdownFileEntry; content: string } {
  const name = relPath.split('/').pop() as string
  const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '.'
  return {
    file: { name, path: `/ws/${relPath}`, relPath, dir, size: content.length, modifiedAt: '2026-01-01T00:00:00Z' },
    content,
  }
}

function makeWorkspace() {
  const notes = [
    entry('index.md', '# Index\n\nSee [Getting Started](getting-started.md) and [[Concepts]].\n\nBroken: [missing](does-not-exist.md).'),
    entry('getting-started.md', '# Getting Started\n\nBack to [Index](index.md). Related: [[guides/Advanced|Advanced Guide]].'),
    entry('concepts.md', '---\ntags: [core, theory]\n---\n\n# Concepts\n\nLinks to [[Index]] and #design notes.'),
    entry('guides/advanced.md', '# Advanced\n\nRefers to [Concepts](../concepts.md) and [[Index]].\n\n## Section A\n\n## Section B'),
    entry('guides/intro.md', '# Intro\n\n[[getting-started]]'),
  ]
  // Pad out to well over 20 notes so layout/index paths are exercised at scale.
  for (let i = 1; i <= 20; i += 1) {
    notes.push(entry(`notes/note-${i}.md`, `# Note ${i}\n\nLink to [Index](../index.md).`))
  }
  return notes
}

const workspace = makeWorkspace()
const files = workspace.map((n) => n.file)
const contentsByPath = Object.fromEntries(workspace.map((n) => [n.file.path, n.content]))
const lookup = buildFileLookup(files)

function edgesFor(relPath: string) {
  const note = workspace.find((n) => n.file.relPath === relPath)!
  return extractMarkdownEdges(note.file, note.content, lookup)
}

function allEdges(fileList = files, contents = contentsByPath) {
  const lk = buildFileLookup(fileList)
  return fileList.flatMap((file) => extractMarkdownEdges(file, contents[file.path] || '', lk))
}

describe('markdown workspace fixture', () => {
  it('has more than 20 notes', () => {
    expect(files.length).toBeGreaterThanOrEqual(20)
  })
})

describe('link resolution', () => {
  it('resolves standard relative markdown links', () => {
    const idx = files.find((f) => f.relPath === 'index.md')!
    expect(resolveMarkdownTarget('getting-started.md', idx, lookup)?.relPath).toBe('getting-started.md')
  })

  it('resolves links across folders using the source dir', () => {
    const adv = files.find((f) => f.relPath === 'guides/advanced.md')!
    expect(resolveMarkdownTarget('../concepts.md', adv, lookup)?.relPath).toBe('concepts.md')
  })

  it('resolves wiki links by title and nested path', () => {
    const idx = files.find((f) => f.relPath === 'index.md')!
    expect(resolveMarkdownTarget('Concepts', idx, lookup)?.relPath).toBe('concepts.md')
    expect(resolveMarkdownTarget('guides/Advanced', idx, lookup)?.relPath).toBe('guides/advanced.md')
  })

  it('does not resolve external or empty targets', () => {
    const idx = files.find((f) => f.relPath === 'index.md')!
    expect(resolveMarkdownTarget('https://example.com', idx, lookup)).toBeUndefined()
    expect(resolveMarkdownTarget('', idx, lookup)).toBeUndefined()
  })
})

describe('edge extraction (standard + wiki)', () => {
  const edges = edgesFor('index.md')

  it('extracts a resolved standard link', () => {
    const e = edges.find((edge) => edge.type === 'markdown' && edge.to === 'getting-started.md')
    expect(e).toBeTruthy()
    expect(e?.resolved).toBe(true)
  })

  it('extracts a resolved wiki link', () => {
    const e = edges.find((edge) => edge.type === 'wiki' && edge.to === 'concepts.md')
    expect(e?.resolved).toBe(true)
  })

  it('flags unresolved links and keeps them visible in the edge list', () => {
    const broken = edges.find((edge) => !edge.resolved)
    expect(broken).toBeTruthy()
    expect(broken?.to).toBe('does-not-exist.md')
  })

  it('uses the alias as the wiki link label', () => {
    const gs = edgesFor('getting-started.md')
    const aliased = gs.find((edge) => edge.type === 'wiki' && edge.to === 'guides/advanced.md')
    expect(aliased?.label).toBe('Advanced Guide')
  })
})

describe('folder tree', () => {
  it('builds a nested tree with directories sorted before files', () => {
    const tree = buildMarkdownTree(files)
    const names = tree.map((node) => node.name)
    // 'guides' and 'notes' are directories and should come before top-level files.
    expect(names.indexOf('guides')).toBeLessThan(names.indexOf('index.md'))
    const guides = tree.find((node) => node.name === 'guides')
    expect(guides?.children.some((c) => c.file?.relPath === 'guides/advanced.md')).toBe(true)
  })
})

describe('graph build', () => {
  const edges = allEdges()
  const nodes = buildGraphNodes(files, edges, null)

  it('creates a node for every file plus unresolved targets', () => {
    expect(nodes.find((n) => n.id === 'index.md')).toBeTruthy()
    const unresolvedNode = nodes.find((n) => n.id === 'does-not-exist.md')
    expect(unresolvedNode?.unresolved).toBe(true)
  })

  it('keeps node coordinates within the viewport bounds', () => {
    for (const node of nodes) {
      expect(node.x).toBeGreaterThanOrEqual(14)
      expect(node.x).toBeLessThanOrEqual(286)
      expect(node.y).toBeGreaterThanOrEqual(14)
      expect(node.y).toBeLessThanOrEqual(170)
    }
  })

  it('centers the active note', () => {
    const active = files.find((f) => f.relPath === 'concepts.md')!
    const centered = buildGraphNodes(files, edges, active).find((n) => n.id === 'concepts.md')
    expect(centered?.x).toBe(150)
    expect(centered?.y).toBe(92)
  })
})

describe('agent-readable graph export', () => {
  it('exports a supermemory-compatible memory graph alongside visual nodes and edges', () => {
    const graph = buildAgentGraph('/ws', files, contentsByPath, allEdges())
    expect(graph.schema).toBe('adomnia.markdown.graph')
    expect(graph.memory.format).toBe('adomnia.supermemory-compatible')
    expect(graph.memory.documents.length).toBe(files.length)
    expect(graph.memory.relations.length).toBe(graph.edges.length)
    expect(graph.memory.unresolved).toContain('does-not-exist.md')

    const indexMemory = graph.memory.documents.find((doc) => doc.id === 'index.md')
    expect(indexMemory?.contentType).toBe('text/markdown')
    expect(indexMemory?.memoryEntries.some((entry) => entry.type === 'document' && entry.current)).toBe(true)
    expect(indexMemory?.memoryEntries.some((entry) => entry.type === 'unresolved-link' && !entry.current)).toBe(true)
  })

  it('classifies memory relations so agents can reason over graph edges', () => {
    expect(classifyMemoryRelation({ to: 'docs/architecture.md', label: 'Architecture', resolved: true })).toBe('extends')
    expect(classifyMemoryRelation({ to: 'CHANGELOG.md', label: 'Release notes', resolved: true })).toBe('updates')
    expect(classifyMemoryRelation({ to: 'source-plan.md', label: 'Based on source', resolved: true })).toBe('derives')
    expect(classifyMemoryRelation({ to: 'missing.md', label: 'Missing', resolved: false })).toBe('unresolved')
  })
})

describe('backlinks', () => {
  it('reports notes that link to the active note', () => {
    const edges = allEdges()
    const backlinks = edges.filter((edge) => edge.resolved && edge.to === 'index.md')
    const sources = new Set(backlinks.map((edge) => edge.from))
    expect(sources.has('getting-started.md')).toBe(true)
    expect(sources.has('guides/advanced.md')).toBe(true)
    expect(sources.size).toBeGreaterThan(2)
  })
})

describe('rename re-indexing', () => {
  it('turns a previously resolved link unresolved after the target is renamed (graph re-index)', () => {
    const before = allEdges().find((e) => e.from === 'getting-started.md' && e.to === 'index.md')
    expect(before?.resolved).toBe(true)

    // Rename index.md -> home.md without updating the link in getting-started.md.
    const renamedFiles = files.map((f) => f.relPath === 'index.md'
      ? { ...f, name: 'home.md', relPath: 'home.md', path: '/ws/home.md' }
      : f)
    const renamedContents = { ...contentsByPath }
    renamedContents['/ws/home.md'] = renamedContents['/ws/index.md']
    delete renamedContents['/ws/index.md']

    const after = allEdges(renamedFiles, renamedContents).find((e) => e.from === 'getting-started.md' && e.to === 'index.md')
    expect(after?.resolved).toBe(false)
  })
})

describe('headings and tags', () => {
  it('extracts headings with levels and line numbers', () => {
    const headings = extractHeadings(workspace.find((n) => n.file.relPath === 'guides/advanced.md')!.content)
    expect(headings[0]).toMatchObject({ level: 1, text: 'Advanced' })
    expect(headings.filter((h) => h.level === 2).map((h) => h.text)).toEqual(['Section A', 'Section B'])
  })

  it('extracts frontmatter and inline tags', () => {
    const tags = extractTags(workspace.find((n) => n.file.relPath === 'concepts.md')!.content)
    expect(tags).toContain('core')
    expect(tags).toContain('theory')
    expect(tags).toContain('design')
  })
})

describe('safe rendering', () => {
  it('renders wiki links as internal anchors and standard links as anchors', () => {
    const html = renderMarkdown('See [[Concepts]] and [docs](getting-started.md).')
    expect(html).toContain('href="adomnia-md:Concepts"')
    expect(html).toContain('href="getting-started.md"')
  })

  it('neutralizes dangerous link protocols', () => {
    const html = renderMarkdown('[click](javascript:alert(1))')
    expect(html).not.toContain('javascript:alert')
    expect(html).toContain('href="#"')
  })
})

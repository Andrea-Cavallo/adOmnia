import { describe, expect, it } from 'vitest'

import {
  backlinkEdges,
  backlinkSearchPattern,
  dedupeBacklinks,
  entryFor,
  filterGraph,
  graphNeighborhood,
  isOrphan,
  resolveEntryFrom,
  unresolvedTargets,
  type BacklinkMatch,
} from './codeStudioMarkdownTools'

const match = (relativePath: string, line: number, preview: string): BacklinkMatch => ({ relativePath, line, preview })

describe('backlinkSearchPattern', () => {
  const pattern = new RegExp(backlinkSearchPattern('docs/guide.md'))

  it('covers markdown links with any prefix', () => {
    expect(pattern.test('](../docs/guide.md#setup)')).toBe(true)
    expect(pattern.test('](guide.md)')).toBe(true)
    expect(pattern.test('](guide)')).toBe(true)
    expect(pattern.test('](other.md)')).toBe(false)
  })

  it('covers wiki links with label or anchor', () => {
    expect(pattern.test('[[guide]]')).toBe(true)
    expect(pattern.test('[[guide|the guide]]')).toBe(true)
    expect(pattern.test('[[guide#setup]]')).toBe(true)
    expect(pattern.test('[[guidebook]]')).toBe(false)
  })
})

describe('dedupeBacklinks', () => {
  it('drops the active note and repeated hits on the same line', () => {
    const matches = [
      match('docs/guide.md', 3, 'self'),
      match('a.md', 1, 'first'),
      match('a.md', 1, 'second'),
      match('a.md', 7, 'other line'),
    ]
    expect(dedupeBacklinks('docs/guide.md', matches).map((item) => `${item.relativePath}:${item.line}`)).toEqual(['a.md:1', 'a.md:7'])
  })
})

describe('backlinkEdges', () => {
  it('builds resolved edges and reads the wiki type from the preview', () => {
    const edges = backlinkEdges('guide.md', [match('a.md', 2, 'see ](guide.md)'), match('b.md', 5, '[[guide|read me]]')])
    expect(edges).toEqual([
      { from: 'a.md', to: 'guide.md', label: 'see ](guide.md)', resolved: true, type: 'markdown' },
      { from: 'b.md', to: 'guide.md', label: '[[guide|read me]]', resolved: true, type: 'wiki' },
    ])
  })
})

describe('entryFor', () => {
  it('splits name and folder', () => {
    expect(entryFor('docs/guide.md')).toMatchObject({ name: 'guide.md', relPath: 'docs/guide.md', dir: 'docs' })
    expect(entryFor('readme.md')).toMatchObject({ name: 'readme.md', dir: '' })
  })
})

describe('graphNeighborhood', () => {
  const active = entryFor('index.md')

  it('keeps outgoing links, backlinks and resolves only the files it knows', () => {
    const known = [entryFor('a.md')]
    const backlinks = [match('a.md', 1, '](index.md)')]
    const graph = graphNeighborhood(active, 'See [A](a.md) and [missing](missing.md).', known, backlinks)
    expect(graph.files.map((file) => file.relPath)).toEqual(['index.md', 'a.md'])
    const targets = graph.edges.map((edge) => `${edge.from}->${edge.to}`)
    expect(targets).toContain('index.md->a.md')
    expect(targets).toContain('index.md->missing.md')
    expect(targets).toContain('a.md->index.md')
    expect(graph.edges.find((edge) => edge.to === 'a.md')?.resolved).toBe(true)
    expect(graph.edges.find((edge) => edge.to === 'missing.md')?.resolved).toBe(false)
  })

  it('resolves links by name even without the folder prefix', () => {
    const known = [entryFor('docs/deep/guide.md')]
    const graph = graphNeighborhood(entryFor('docs/deep/index.md'), '[G](../deep/guide.md)', known, [])
    expect(graph.edges[0]).toMatchObject({ to: 'docs/deep/guide.md', resolved: true })
    expect(graph.files.map((file) => file.relPath)).toEqual(['docs/deep/index.md', 'docs/deep/guide.md'])
  })
})

describe('unresolvedTargets', () => {
  it('lists only the link targets with no known file', () => {
    const active = entryFor('index.md')
    expect(unresolvedTargets(active, '](a.md) and [x](missing.md)', [entryFor('a.md')])).toEqual(['missing.md'])
    expect(unresolvedTargets(active, '](https://example.com)', [])).toEqual([])
  })
})

describe('resolveEntryFrom', () => {
  const results = [{ relativePath: 'docs/guide.md' }, { relativePath: 'guide.md' }]

  it('matches by full path first, then by file name', () => {
    expect(resolveEntryFrom('docs/guide.md', results)?.relPath).toBe('docs/guide.md')
    expect(resolveEntryFrom('guide', results)?.relPath).toBe('guide.md')
    expect(resolveEntryFrom('other.md', results)).toBeUndefined()
  })
})

describe('filterGraph', () => {
  const edges = [
    { from: 'index.md', to: 'a.md', label: '', resolved: true, type: 'markdown' as const },
    { from: 'index.md', to: 'ghost.md', label: '', resolved: false, type: 'markdown' as const },
  ]
  const nodes = [{ id: 'index.md' }, { id: 'a.md' }, { id: 'ghost.md', unresolved: true }, { id: 'orphan.md' }]

  it('hides unresolved nodes and orphans by default, never the active note', () => {
    const visible = filterGraph(nodes, edges, 'index.md', { showOrphans: false, showUnresolved: false })
    expect(visible.nodes.map((node) => node.id)).toEqual(['index.md', 'a.md'])
    expect(visible.edges).toHaveLength(1)
  })

  it('shows everything when both filters are on', () => {
    const visible = filterGraph(nodes, edges, 'index.md', { showOrphans: true, showUnresolved: true })
    expect(visible.nodes.map((node) => node.id)).toEqual(['index.md', 'a.md', 'ghost.md', 'orphan.md'])
    expect(visible.edges).toHaveLength(2)
  })

  it('marks a node orphan only when it has no edges at all', () => {
    expect(isOrphan('orphan.md', 'index.md', edges)).toBe(true)
    expect(isOrphan('a.md', 'index.md', edges)).toBe(false)
    expect(isOrphan('index.md', 'index.md', edges)).toBe(false)
  })
})

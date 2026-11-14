import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosave, type SaveStatus } from './autosave'
import { diagramFromBlueprint, graphFromBlueprint } from './blueprint'
import { base64OfDataUrl, base64OfText, exportFileName, themeStylesheet } from './export'
import { createNode } from './graphOps'
import { applyLayout, elkGraph, DEFAULT_LAYOUT } from './layout'
import { emptyDiagram } from './model'
import { createDiagramRepository, memoryBackend } from './storage'
import { DIAGRAM_TEMPLATES } from './templates'

describe('diagram repository', () => {
  it('saves, lists newest first, loads and removes diagrams', async () => {
    const backend = memoryBackend()
    const repository = createDiagramRepository(backend)
    const older = { ...emptyDiagram('Older', 1), nodes: [createNode('process', { x: 0, y: 0 })] }
    const newer = emptyDiagram('Newer', 2)
    await repository.save(older)
    await repository.save(newer)
    expect((await repository.list()).map((summary) => [summary.name, summary.nodeCount])).toEqual([['Newer', 0], ['Older', 1]])
    expect((await repository.load(older.id))?.nodes).toHaveLength(1)
    await repository.remove(older.id)
    expect(await repository.load(older.id)).toBeNull()
    expect([...backend.data.keys()]).toEqual([`doc:${newer.id}`, `meta:${newer.id}`])
  })

  it('lists the readable diagrams when one entry is damaged', async () => {
    const repository = createDiagramRepository(memoryBackend({ 'meta:bad': '{nope' }))
    await repository.save(emptyDiagram('Good'))
    expect((await repository.list()).map((summary) => summary.name)).toEqual(['Good'])
  })
})

describe('diagram autosave', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('saves the last change once after the delay', async () => {
    const save = vi.fn(async () => {})
    const statuses: SaveStatus[] = []
    const autosave = createAutosave<number>({ delayMs: 500, save, onStatus: (status) => statuses.push(status) })
    autosave.schedule(1)
    autosave.schedule(2)
    await vi.advanceTimersByTimeAsync(499)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledExactlyOnceWith(2)
    expect(statuses[statuses.length - 1]).toBe('saved')
  })

  it('reports a failure and saves the same change on flush', async () => {
    const save = vi.fn<(value: number) => Promise<void>>().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue()
    const errors: string[] = []
    const autosave = createAutosave<number>({ delayMs: 10, save, onStatus: (_status, error) => { if (error) errors.push(error) } })
    autosave.schedule(7)
    await vi.advanceTimersByTimeAsync(10)
    expect(errors).toEqual(['disk full'])
    await autosave.flush()
    expect(save).toHaveBeenLastCalledWith(7)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('flushes a pending change immediately', async () => {
    const save = vi.fn(async () => {})
    const autosave = createAutosave<string>({ delayMs: 10_000, save, onStatus: () => {} })
    autosave.schedule('now')
    await autosave.flush()
    expect(save).toHaveBeenCalledWith('now')
  })
})

describe('diagram blueprints and layout', () => {
  it('builds every template with containers first and links between existing nodes', () => {
    for (const template of DIAGRAM_TEMPLATES) {
      if (!template.blueprint) continue
      const graph = graphFromBlueprint(template.blueprint, 'orthogonal')
      const ids = new Set(graph.nodes.map((node) => node.id))
      expect(graph.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target)), template.id).toBe(true)
      graph.nodes.forEach((node, index) => {
        if (node.parentId) expect(graph.nodes.findIndex((parent) => parent.id === node.parentId), template.id).toBeLessThan(index)
      })
    }
  })

  it('lays out top-level nodes with ELK and leaves container children in place', async () => {
    const graph = await diagramFromBlueprint({
      nodes: [
        { key: 'box', shape: 'boundary', label: 'service' },
        { key: 'in', shape: 'process', label: 'in', parent: 'box' },
        { key: 'out', shape: 'process', label: 'out', parent: 'box' },
        { key: 'db', shape: 'database', label: 'db' },
        { key: 'client', shape: 'client', label: 'client' },
      ],
      links: [{ from: 'client', to: 'in' }, { from: 'in', to: 'out' }, { from: 'out', to: 'db' }],
    }, 'orthogonal')
    const topLevel = graph.nodes.filter((node) => !node.parentId)
    const positions = new Set(topLevel.map((node) => `${node.position.x},${node.position.y}`))
    expect(positions.size).toBe(topLevel.length)
    expect(elkGraph(graph, DEFAULT_LAYOUT).children).toHaveLength(topLevel.length)
  })

  it('keeps locked nodes where they are and clears manual bends', () => {
    const locked = { ...createNode('process', { x: 5, y: 5 }), id: 'l', data: { ...createNode('process', { x: 0, y: 0 }).data, locked: true } }
    const free = { ...createNode('process', { x: 0, y: 0 }), id: 'f' }
    const edge = { id: 'e', type: 'smart' as const, source: 'l', target: 'f', data: { routing: 'orthogonal' as const, label: '', color: '', thickness: 1, dashed: false, arrowStart: 'none' as const, arrowEnd: 'arrow' as const, flow: false, waypoints: [{ x: 1, y: 1 }] } }
    const after = applyLayout({ nodes: [locked, free], edges: [edge] }, { id: 'root', children: [{ id: 'l', x: 99, y: 99 }, { id: 'f', x: 200, y: 0 }] })
    expect(after.nodes[0].position).toEqual({ x: 5, y: 5 })
    expect(after.nodes[1].position).toEqual({ x: 200, y: 0 })
    expect(after.edges[0].data?.waypoints).toEqual([])
  })
})

describe('diagram export helpers', () => {
  it('carries the theme colors into the exported copy as a stylesheet', () => {
    expect(themeStylesheet({ '--diagram-edge': '#888', '--diagram-node-fill': 'rgb(20, 20, 20)' }))
      .toBe('.react-flow__viewport { --diagram-edge: #888; --diagram-node-fill: rgb(20, 20, 20); }')
  })

  it('makes safe file names', () => {
    expect(exportFileName('  Orders / Billing v2 ', 'png')).toBe('orders-billing-v2.png')
    expect(exportFileName('***', 'json')).toBe('diagram.adomnia-diagram.json')
  })

  it('reads Base64 and percent-encoded data URLs', () => {
    expect(base64OfDataUrl('data:image/png;base64,AAAA')).toBe('AAAA')
    expect(atob(base64OfDataUrl('data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E'))).toBe('<svg></svg>')
    expect(new TextDecoder().decode(Uint8Array.from(atob(base64OfText('ciao → è')), (c) => c.charCodeAt(0)))).toBe('ciao → è')
  })
})

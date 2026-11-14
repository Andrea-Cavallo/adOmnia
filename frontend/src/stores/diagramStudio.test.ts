import { describe, expect, it, vi } from 'vitest'
import { createDiagramRepository, memoryBackend, type DiagramRepository } from '@/lib/diagrams/storage'
import { serializeDiagram } from '@/lib/diagrams/serialization'
import { emptyDiagram } from '@/lib/diagrams/model'
import { createDiagramStudioStore } from './diagramStudio'

async function studio(repository: DiagramRepository = createDiagramRepository(memoryBackend())) {
  const store = createDiagramStudioStore(repository)
  await store.getState().init()
  return store
}

const select = (store: Awaited<ReturnType<typeof studio>>, ids: string[]) => store.setState((state) => ({
  doc: state.doc && { ...state.doc, nodes: state.doc.nodes.map((node) => ({ ...node, selected: ids.includes(node.id) })) },
}))

describe('Diagram Studio editing', () => {
  it('starts with a blank diagram and saves it', async () => {
    const backend = memoryBackend()
    const store = await studio(createDiagramRepository(backend))
    const { doc } = store.getState()
    expect(doc?.name).toBe('Untitled diagram')
    await store.getState().flush()
    expect(backend.data.has(`doc:${doc!.id}`)).toBe(true)
    expect(store.getState().saveStatus).toBe('saved')
  })

  it('adds shapes, connects them and undoes and redoes both steps', async () => {
    const store = await studio()
    const a = store.getState().addShape('go-service', { x: 0, y: 0 })!
    const b = store.getState().addShape('database', { x: 300, y: 0 })!
    store.getState().connect({ source: a, target: b, sourceHandle: 'right-50', targetHandle: 'left-50' })
    expect(store.getState().doc?.edges).toHaveLength(1)
    expect(store.getState().doc?.edges[0].data?.routing).toBe('orthogonal')
    store.getState().undo()
    expect(store.getState().doc?.edges).toHaveLength(0)
    store.getState().undo()
    expect(store.getState().doc?.nodes).toHaveLength(1)
    store.getState().redo()
    store.getState().redo()
    expect(store.getState().doc?.edges).toHaveLength(1)
  })

  it('refuses a connector from a node to itself', async () => {
    const store = await studio()
    const a = store.getState().addShape('process', { x: 0, y: 0 })!
    store.getState().connect({ source: a, target: a, sourceHandle: null, targetHandle: null })
    expect(store.getState().doc?.edges).toHaveLength(0)
  })

  it('copies, pastes beside the original and pastes again further along', async () => {
    const store = await studio()
    const a = store.getState().addShape('process', { x: 100, y: 100 })!
    select(store, [a])
    store.getState().copy()
    store.getState().paste()
    store.getState().paste()
    const positions = store.getState().doc!.nodes.map((node) => node.position)
    expect(positions).toEqual([{ x: 100, y: 100 }, { x: 132, y: 132 }, { x: 164, y: 164 }])
  })

  it('groups, locks against deletion and deletes the rest', async () => {
    const store = await studio()
    const a = store.getState().addShape('process', { x: 0, y: 0 })!
    const b = store.getState().addShape('process', { x: 300, y: 0 })!
    select(store, [a, b])
    store.getState().group()
    expect(store.getState().doc!.nodes.filter((node) => node.parentId)).toHaveLength(2)
    select(store, [a])
    store.getState().lock(true)
    select(store, [a, b])
    store.getState().deleteSelection()
    expect(store.getState().doc!.nodes.map((node) => node.id)).toContain(a)
    expect(store.getState().doc!.nodes.map((node) => node.id)).not.toContain(b)
  })

  it('does not record selection or measuring in the history, but saves a resize', async () => {
    const store = await studio()
    const a = store.getState().addShape('process', { x: 0, y: 0 })!
    await store.getState().flush()
    const steps = store.getState().history.past.length
    store.getState().onNodesChange([{ type: 'select', id: a, selected: true }])
    store.getState().onNodesChange([{ type: 'dimensions', id: a, dimensions: { width: 160, height: 72 } }])
    expect(store.getState().history.past).toHaveLength(steps)
    expect(store.getState().saveStatus).not.toBe('pending')
    store.getState().onNodesChange([{ type: 'dimensions', id: a, dimensions: { width: 300, height: 72 }, resizing: true, setAttributes: true }])
    expect(store.getState().saveStatus).toBe('pending')
    expect(store.getState().doc!.nodes[0].width).toBe(300)
  })

  it('imports a diagram as a new one and reports a broken file', async () => {
    const store = await studio()
    const source = { ...emptyDiagram('Imported'), id: 'fixed-id' }
    await store.getState().importJson(serializeDiagram(source))
    expect(store.getState().doc?.name).toBe('Imported')
    expect(store.getState().doc?.id).not.toBe('fixed-id')
    await store.getState().importJson('{broken')
    expect(store.getState().notice).toMatch(/Could not import/)
  })

  it('grows a connected shape of the same kind where a connector is dropped', async () => {
    const store = await studio()
    const source = store.getState().addShape('decision', { x: 0, y: 0 })!
    const created = store.getState().connectToNew(source, 'right-50', { x: 400, y: 50 })
    const { doc } = store.getState()
    expect(doc?.nodes.find((node) => node.id === created)?.data.shape).toBe('decision')
    expect(doc?.edges).toMatchObject([{ source, target: created, sourceHandle: 'right-50', targetHandle: null }])
    store.getState().undo()
    expect(store.getState().doc?.nodes).toHaveLength(1)
    expect(store.getState().doc?.edges).toHaveLength(0)
  })

  it('puts the grown shape in line with a source that sits in a container', async () => {
    const store = await studio()
    store.getState().addShape('container', { x: 0, y: 0 })
    const source = store.getState().addShape('process', { x: 100, y: 100 })!
    store.getState().dropInContainer(source)
    const nodes = () => store.getState().doc!.nodes
    const from = nodes().find((node) => node.id === source)!
    expect(from.parentId).toBeTruthy()
    const parent = nodes().find((node) => node.id === from.parentId)!
    const centerY = parent.position.y + from.position.y + from.height! / 2
    const created = store.getState().connectToNew(source, 'right-50', { x: 600, y: centerY + 10 })
    const grown = nodes().find((node) => node.id === created)!
    expect(grown.parentId).toBeUndefined()
    expect(grown.position.y + grown.height! / 2).toBe(centerY)
  })

  it('builds a legend from the colors already in the diagram, and refuses an uncolored one', async () => {
    const store = await studio()
    const plain = store.getState().addShape('process', { x: 0, y: 0 })!
    expect(store.getState().addLegend({ x: 0, y: 300 })).toBe(false)
    expect(store.getState().notice).toMatch(/Nothing to describe/)
    select(store, [plain])
    store.getState().updateNodes([plain], { style: { ...store.getState().doc!.nodes[0].data.style, fill: '#14241b', stroke: '#3fb96b' } })
    expect(store.getState().addLegend({ x: 0, y: 300 })).toBe(true)
    const legend = store.getState().doc!.nodes.find((node) => node.data.shape === 'legend')!
    expect(legend.data.legend).toMatchObject([{ label: 'Green', color: '#3fb96b' }])
    expect(legend.selected).toBe(true)
  })

  it('renames a page without touching the others', async () => {
    const store = await studio()
    store.getState().addPage()
    const [first, second] = store.getState().doc!.pages
    store.getState().renamePage(second.id, '  Checkout  ')
    expect(store.getState().doc!.pages.map((page) => page.name)).toEqual([first.name, 'Checkout'])
    store.getState().renamePage(second.id, '   ')
    expect(store.getState().doc!.pages[1].name).toBe('Checkout')
  })

  it('creates a diagram from a template, laid out', async () => {
    const store = await studio()
    await store.getState().create('saga')
    const { doc } = store.getState()
    expect(doc?.name).toBe('Saga (orchestrated)')
    expect(doc?.nodes.length).toBeGreaterThan(5)
    expect(new Set(doc?.nodes.map((node) => `${node.position.x},${node.position.y}`)).size).toBe(doc?.nodes.length)
  })

  it('keeps unsaved work after a failed save and saves it on retry', async () => {
    const backend = memoryBackend()
    const repository = createDiagramRepository(backend)
    const store = await studio(repository)
    await store.getState().flush()
    const save = vi.spyOn(repository, 'save').mockRejectedValueOnce(new Error('database locked'))
    store.getState().addShape('process', { x: 0, y: 0 })
    await store.getState().flush()
    expect(store.getState().saveStatus).toBe('error')
    expect(store.getState().saveError).toBe('database locked')
    await store.getState().flush()
    expect(store.getState().saveStatus).toBe('saved')
    expect(save).toHaveBeenCalledTimes(2)
    const saved = await repository.load(store.getState().doc!.id)
    expect(saved?.nodes).toHaveLength(1)
  })

  it('opens a workspace diagram with source refs, then refreshes without moving the nodes', async () => {
    const store = await studio()
    const generated = (line: number) => ({
      blueprint: {
        nodes: [
          { key: 'mod:payments', shape: 'go-service', label: 'payments', generated: true, source: { sessionId: 's1', entityId: 'mod:payments', kind: 'service', file: 'go.mod', line: 1 } },
          { key: 'fn:payments.CreatePayment', shape: 'process', label: 'CreatePayment()', generated: true, source: { sessionId: 's1', entityId: 'fn:payments.CreatePayment', kind: 'function', file: 'service/payment.go', line } },
        ],
        links: [{ from: 'mod:payments', to: 'fn:payments.CreatePayment', label: 'contains', confidence: 'derived' as const, generated: true }],
      },
      origin: { sessionId: 's1', projectName: 'payments', generatedAt: 1, view: 'architecture' as const, fingerprint: 'fp1' },
      notes: [], entityCount: 2, truncated: false,
    })
    await store.getState().showWorkspaceDiagram(generated(10), 'new', 'payments')
    const first = store.getState().doc!
    expect(first.origin).toMatchObject({ sessionId: 's1', view: 'architecture' })
    expect(first.nodes.every((node) => node.data.source?.sessionId === 's1')).toBe(true)
    const functionNode = first.nodes.find((node) => node.data.source?.entityId === 'fn:payments.CreatePayment')!
    // The user moves the node and renames it.
    store.setState({ doc: { ...first, nodes: first.nodes.map((node) => node.id === functionNode.id ? { ...node, position: { x: 640, y: 280 }, data: { ...node.data, label: 'CreatePayment (mine)' } } : node) } })
    await store.getState().showWorkspaceDiagram(generated(99), 'refresh', 'payments')
    const refreshed = store.getState().doc!
    const kept = refreshed.nodes.find((node) => node.data.source?.entityId === 'fn:payments.CreatePayment')!
    expect(kept.position).toEqual({ x: 640, y: 280 })
    expect(kept.data.label).toBe('CreatePayment (mine)')
    expect(kept.data.source?.line).toBe(99)
    expect(refreshed.origin?.fingerprint).toBe('fp1')
    expect(refreshed.edges.filter((edge) => edge.data?.generated)).toHaveLength(1)
  })

  it('adds the callers of a selected node without clearing the layout', async () => {
    const store = await studio()
    const id = store.getState().addShape('process', { x: 120, y: 80 })!
    select(store, [id])
    const added = store.getState().addRelated(
      [
        { id: 'fn:caller', kind: 'function', label: 'caller()', service: 'mod:x' },
        { id: 'fn:target', kind: 'function', label: 'target()', service: 'mod:x' },
      ],
      [{ from: 'fn:caller', to: 'fn:target', kind: 'calls', confidence: 'derived' }],
      { sessionId: 's1', fingerprint: 'fp1' },
    )
    expect(added).toBe(2)
    expect(store.getState().doc!.nodes).toHaveLength(3)
    expect(store.getState().doc!.edges).toHaveLength(1)
    expect(store.getState().doc!.nodes[0].position).toEqual({ x: 120, y: 80 })
  })
})

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

  it('creates a diagram from a template, laid out', async () => {
    const store = await studio()
    await store.getState().create('microservices')
    const { doc } = store.getState()
    expect(doc?.name).toBe('Go & Java microservices')
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
})

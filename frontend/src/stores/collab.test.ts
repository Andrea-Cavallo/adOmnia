import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollabShare } from '@/lib/collab-api'

// Il backend è finto: qui si verifica solo la logica del store (idratazione, salvataggi in ordine,
// riapertura della sessione), non il trasporto.
const api = vi.hoisted(() => ({
  saveInbox: vi.fn<(data: string) => Promise<void>>(),
  inbox: vi.fn<() => Promise<string>>(),
  status: vi.fn<() => Promise<unknown>>(),
  host: vi.fn<() => Promise<unknown>>(),
  join: vi.fn<() => Promise<unknown>>(),
  stop: vi.fn<() => Promise<void>>(),
}))
const events = vi.hoisted(() => ({ handler: null as ((event: unknown) => void) | null }))

vi.mock('@/lib/collab-api', () => ({
  collabApi: {
    saveInbox: api.saveInbox,
    inbox: api.inbox,
    status: api.status,
    host: api.host,
    join: api.join,
    stop: api.stop,
  },
  subscribeCollabEvents: (handler: (event: unknown) => void) => {
    events.handler = handler
    return () => { events.handler = null }
  },
}))

vi.mock('@/stores/collections', () => ({ useCollectionsStore: { getState: () => ({ importCollection: vi.fn() }) } }))
vi.mock('@/stores/environments', () => ({ useEnvironmentsStore: { getState: () => ({ addEnvironment: () => ({ id: 'x' }), updateVariables: vi.fn() }) } }))
vi.mock('@/stores/tabs', () => ({ useTabsStore: { getState: () => ({ openTab: vi.fn() }) } }))

// Lo store ha stato di modulo (idratazione, coda dei salvataggi): ogni test riparte da un modulo
// nuovo, altrimenti `init()` non farebbe nulla dopo il primo test del file.
async function loadStore() {
  vi.resetModules()
  events.handler = null
  const module = await import('./collab')
  return module.useCollabStore
}

const share = (id: string, title = 'Items'): CollabShare =>
  ({ id, kind: 'collection', title, data: JSON.stringify({ name: title, items: [] }) }) as CollabShare

const persisted = (id: string) =>
  JSON.stringify([{ id, title: 'Vecchia condivisione', from: 'Ada', redacted: [], hasScripts: false, receivedAt: 1 }])

const item = (id: string) => ({ id, title: id, from: 'Ada', redacted: [], hasScripts: false, receivedAt: 1 })

beforeEach(() => {
  api.saveInbox.mockReset().mockResolvedValue(undefined)
  api.inbox.mockReset().mockResolvedValue('[]')
  api.status.mockReset().mockResolvedValue({ mode: 'guest', participants: [] })
  api.host.mockReset().mockResolvedValue({ mode: 'host', participants: [] })
  api.join.mockReset().mockResolvedValue({ mode: 'guest', participants: [] })
  api.stop.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('collab store — recovery inbox', () => {
  it('idrata l’inbox salvata quando non c’è nulla in memoria', async () => {
    api.inbox.mockResolvedValue(persisted('old-1'))
    const store = await loadStore()
    store.getState().init()
    await vi.waitFor(() => expect(store.getState().inbox.map((entry) => entry.id)).toEqual(['old-1']))
  })

  it('non perde una condivisione arrivata prima che l’idratazione finisca', async () => {
    let release: (value: string) => void = () => {}
    api.inbox.mockReturnValue(new Promise<string>((resolve) => { release = resolve }))
    const store = await loadStore()
    store.getState().init()
    // La condivisione arriva mentre la lettura del backend è ancora in corso.
    events.handler?.({ type: 'share', from: 'bob', payload: share('new-1', 'Nuova') })
    release(persisted('old-1'))
    await vi.waitFor(() => expect(store.getState().inbox.map((entry) => entry.id)).toEqual(['new-1', 'old-1']))
  })

  it('dopo un comando che azzera l’inbox l’idratazione non riporta i vecchi elementi', async () => {
    let release: (value: string) => void = () => {}
    api.inbox.mockReturnValue(new Promise<string>((resolve) => { release = resolve }))
    const store = await loadStore()
    store.getState().init()
    await store.getState().host('127.0.0.1', 0, 'io')
    release(persisted('old-1'))
    await Promise.resolve()
    expect(store.getState().inbox).toEqual([])
  })

  it('non idrata due volte lo stesso elemento', async () => {
    api.inbox.mockResolvedValue(persisted('dup'))
    const store = await loadStore()
    store.setState({ inbox: [item('dup')] })
    store.getState().init()
    await vi.waitFor(() => expect(store.getState().inbox).toHaveLength(1))
    expect(store.getState().inbox[0].title).toBe('dup')
  })

  it('salva in ordine: l’ultimo dismiss scritto è quello con l’inbox più aggiornata', async () => {
    const writes: string[] = []
    api.saveInbox.mockImplementation(async (data: string) => { writes.push(data) })
    const store = await loadStore()
    store.setState({ inbox: [item('a'), item('b')] })
    store.getState().dismiss('a')
    store.getState().dismiss('b')
    await vi.waitFor(() => expect(writes).toHaveLength(2))
    expect(writes.map((data) => (JSON.parse(data) as { id: string }[]).map((entry) => entry.id))).toEqual([['b'], []])
  })

  it('un errore del backend resta visibile e non blocca i salvataggi successivi', async () => {
    api.saveInbox.mockRejectedValueOnce(new Error('bbolt chiuso')).mockResolvedValue(undefined)
    const store = await loadStore()
    store.setState({ inbox: [item('a')] })
    store.getState().dismiss('a')
    await vi.waitFor(() => expect(store.getState().notice).toContain('Recovery inbox non salvato'))
    expect(api.saveInbox).toHaveBeenCalledTimes(1)
    store.getState().dismiss('b')
    await vi.waitFor(() => expect(api.saveInbox).toHaveBeenCalledTimes(2))
  })
})

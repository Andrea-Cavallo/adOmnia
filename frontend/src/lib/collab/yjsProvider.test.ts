import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { CollabYjsProvider, decodeBytes, encodeBytes, type DocumentMessage, type DocumentTransport } from './yjsProvider'

function endpoint() {
  const sent: DocumentMessage[] = []
  let handler: (message: DocumentMessage) => void = () => {}
  const transport: DocumentTransport = { send: async message => { sent.push(message) }, subscribe: listener => { handler = listener; return () => { handler = () => {} } } }
  return { sent, transport, receive: (message: DocumentMessage) => handler(message) }
}

describe('Yjs collaboration provider', () => {
  it('resends unsent local text after reconnect and does not send viewer edits', async () => {
    const e=endpoint(), provider=new CollabYjsProvider('room',e.transport,()=>{})
    provider.seed('base');provider.suspend('offline');provider.text.insert(4,' local')
    await provider.resume(true)
    const update=e.sent.find(message=>message.action==='update')
    const replica=new Y.Doc();Y.applyUpdate(replica,decodeBytes(update!.data!))
    expect(replica.getText('code').toString()).toBe('base local')
    e.sent.length=0
    await provider.resume(false)
    expect(e.sent.some(message=>message.action==='update')).toBe(false)
    provider.destroy();replica.destroy()
  })
  it('converges concurrent edits without guest seeding or remote echoes', async () => {
    const a = endpoint(), b = endpoint()
    const host = new CollabYjsProvider('room', a.transport, () => {})
    const guest = new CollabYjsProvider('room', b.transport, () => {})
    const initial = host.seed('abc')
    b.receive({ id: 'room', action: 'sync', updates: [initial] })
    expect(guest.text.toString()).toBe('abc')
    expect(b.sent).toEqual([])
    host.text.insert(1, 'H')
    guest.text.insert(2, 'G')
    // Exchange full states while the local batched updates are pending.
    const h = encodeBytes(Y.encodeStateAsUpdate(host.doc))
    const g = encodeBytes(Y.encodeStateAsUpdate(guest.doc))
    a.receive({ id: 'room', action: 'update', data: g })
    b.receive({ id: 'room', action: 'update', data: h })
    expect(host.text.toString()).toBe(guest.text.toString())
    const before = guest.text.toString()
    b.receive({ id: 'room', action: 'update', data: h })
    expect(guest.text.toString()).toBe(before)
    host.destroy(); guest.destroy()
  })

  it('preserves local text and reports malformed updates', () => {
    const e = endpoint(), errors: string[] = []
    const provider = new CollabYjsProvider('room', e.transport, error => errors.push(error))
    provider.seed('local')
    e.receive({ id: 'room', action: 'update', data: 'not base64!' })
    expect(provider.text.toString()).toBe('local')
    expect(errors).toHaveLength(1)
    provider.destroy()
  })

  it('encodes binary values including zero and high bytes', () => {
    const bytes = new Uint8Array([0,1,127,128,255])
    expect(decodeBytes(encodeBytes(bytes))).toEqual(bytes)
  })
})

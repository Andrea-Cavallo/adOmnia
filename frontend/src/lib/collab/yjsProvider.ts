import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'

export interface DocumentMessage {
  id: string
  action: string
  data?: string
  updates?: string[]
}

export interface DocumentTransport {
  send: (message: DocumentMessage) => Promise<void>
  subscribe: (handler: (message: DocumentMessage, from?: string) => void) => () => void
}

export function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

export function decodeBytes(data: string): Uint8Array {
  return Uint8Array.from(atob(data), char => char.charCodeAt(0))
}

/** Instantiated only by a shared editor. A guest never seeds its document.
 * Remote updates have an origin, so they cannot echo back into the transport.
 */
export class CollabYjsProvider {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)
  readonly text = this.doc.getText('code')
  private readonly remote = Symbol('collab-remote')
  private unsubscribe: () => void
  private pending: Uint8Array[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private awarenessTimer: ReturnType<typeof setTimeout> | undefined
  private awarenessClients = new Map<string, Set<number>>()
  private destroyed = false
  private paused = false
  private chain = Promise.resolve()

  constructor(readonly id: string, private transport: DocumentTransport, private onError: (message: string) => void) {
    this.doc.on('update', this.onUpdate)
    this.awareness.on('update', this.onAwareness)
    this.unsubscribe = transport.subscribe((message, from) => {
      if (message.id !== id || this.destroyed) return
      try {
        if (message.action === 'sync' || message.action === 'open') {
          for (const update of message.updates ?? []) Y.applyUpdate(this.doc, decodeBytes(update), this.remote)
        } else if (message.action === 'update' && message.data) {
          Y.applyUpdate(this.doc, decodeBytes(message.data), this.remote)
        } else if (message.action === 'awareness' && message.data) {
          const before = new Set(this.awareness.getStates().keys())
          applyAwarenessUpdate(this.awareness, decodeBytes(message.data), this.remote)
          if (from) {
            const clients = this.awarenessClients.get(from) ?? new Set<number>()
            for (const client of this.awareness.getStates().keys()) if (!before.has(client)) clients.add(client)
            this.awarenessClients.set(from, clients)
          }
        } else if (message.action === 'close') {
          this.paused = true
          this.onError('L’host ha chiuso la condivisione. Il testo locale resta disponibile.')
        }
      } catch {
        this.paused = true
        this.onError('Update condiviso non valido: sincronizzazione sospesa, testo locale conservato.')
      }
    })
  }

  seed(text: string): string {
    // Host calls once before publishing the initial state; no network echo.
    this.doc.transact(() => this.text.insert(0, text), this.remote)
    return encodeBytes(Y.encodeStateAsUpdate(this.doc))
  }

  sync(): Promise<void> { return this.transport.send({ id: this.id, action: 'sync' }) }

  suspend(message: string) { this.paused = true; this.onError(message) }

  async resume(canEdit: boolean) {
    await this.chain
    this.paused = false
    try {
      await this.sync()
      if (canEdit) await this.transport.send({ id: this.id, action: 'update', data: encodeBytes(Y.encodeStateAsUpdate(this.doc)) })
      await this.transport.send({ id: this.id, action: 'awareness', data: encodeBytes(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) })
      this.onError('')
    } catch (error) { this.suspend(`Ripresa interrotta: ${String(error)}. Testo locale conservato.`) }
  }

  removeParticipant(id: string) {
    removeAwarenessStates(this.awareness, [...(this.awarenessClients.get(id) ?? [])], this.remote)
    this.awarenessClients.delete(id)
  }

  private send(message: DocumentMessage) {
    this.chain = this.chain.then(async () => {
      if (this.paused) return
      await this.transport.send(message)
    }).catch(error => {
      this.paused = true
      this.onError(`Sincronizzazione interrotta: ${String(error)}. Il testo locale resta disponibile.`)
    })
  }

  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this.remote || this.destroyed || this.paused) return
    this.pending.push(update)
    this.timer ??= setTimeout(() => this.flush(), 150)
  }

  private flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (!this.pending.length) return
    const update = Y.mergeUpdates(this.pending)
    this.pending = []
    this.send({ id: this.id, action: 'update', data: encodeBytes(update) })
  }

  private onAwareness = (_change: unknown, origin: unknown) => {
    if (origin === this.remote || this.destroyed || this.paused) return
    // Coalesce cursor movement; text + presence stay below the transport rate limit.
    this.awarenessTimer ??= setTimeout(() => {
      this.awarenessTimer = undefined
      this.send({ id: this.id, action: 'awareness', data: encodeBytes(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) })
    }, 200)
  }

  destroy() {
    if (this.destroyed) return
    this.flush()
    this.destroyed = true
    if (this.awarenessTimer) clearTimeout(this.awarenessTimer)
    this.awareness.setLocalState(null)
    if (!this.paused) this.send({ id: this.id, action: 'awareness', data: encodeBytes(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) })
    this.unsubscribe()
    this.doc.off('update', this.onUpdate)
    this.awareness.off('update', this.onAwareness)
    this.awareness.destroy()
    this.doc.destroy()
  }
}

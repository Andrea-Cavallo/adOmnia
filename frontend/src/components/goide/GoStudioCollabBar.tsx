import { useEffect, useState } from 'react'
import type { editor } from 'monaco-editor'
import { MonacoBinding } from 'y-monaco'
import { collabApi, subscribeCollabEvents } from '@/lib/collab-api'
import { CollabYjsProvider, type DocumentMessage } from '@/lib/collab/yjsProvider'
import { maskSecretValues } from '@/lib/secretScanner'
import { useCollabStore } from '@/stores/collab'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import './goStudioCollab.css'

const rooms = new Map<string, { provider: CollabYjsProvider; binding: MonacoBinding; stop: () => void }>()

export default function GoStudioCollabBar({ document, editor }: { document: GoIDEEditorDocument; editor: editor.IStandaloneCodeEditor | null }) {
  const status = useCollabStore(state => state.status)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const path = document.document.relativePath
  const id = status?.project ? `${status.project.id}:${path}` : ''
  const shared = status?.documents?.includes(id)
  useEffect(() => { useCollabStore.getState().init() }, [])
  const eligible = status?.mode === 'host' && status.project?.sourceSessionId === document.document.sessionId && !document.document.external && !document.document.readOnly
  if (!eligible) return null

  const share = async () => {
    const model = editor?.getModel()
    if (!model || busy) return
    setBusy(true); setError('')
    let provider: CollabYjsProvider | undefined
    let opened = false
    try {
      const content = model.getValue()
      const version = model.getVersionId()
      if (maskSecretValues(content) !== content) throw new Error('Il file contiene un possibile segreto: spostalo nel vault prima di condividerlo.')
      await collabApi.validateProjectDocument(path, content)
      if(model.isDisposed() || model.getVersionId()!==version) throw new Error('Il buffer è cambiato durante la verifica. Ripeti la condivisione: il testo locale è conservato.')
      provider = new CollabYjsProvider(id, {
        send: message => collabApi.document(message),
        subscribe: handler => subscribeCollabEvents(event => { if (event.type === 'document') handler(event.payload as DocumentMessage, event.from) }),
      }, message => useCollabStore.setState({ notice: message }))
      const initial = provider.seed(content)
      await collabApi.openDocument(id, initial)
      opened=true
      if(model.isDisposed() || model.getVersionId()!==version) throw new Error('Il buffer è cambiato durante l’apertura live. Ripeti la condivisione: il testo locale è conservato.')
      const binding = new MonacoBinding(provider.text, model, new Set([editor!]), provider.awareness)
      provider.awareness.setLocalStateField('user', { name: status?.participants.find(p => p.id === status.self)?.name ?? 'Host', file: path })
      const update = () => {
        const current = useGoIDEStore.getState().documents.find(d => d.document.id === document.document.id)
        if (current && current.buffer !== provider!.text.toString()) useGoIDEStore.getState().updateDocument(current.document.id, provider!.text.toString())
      }
      provider.text.observe(update)
      const stop = () => { binding.destroy(); provider!.text.unobserve(update); provider!.destroy(); rooms.delete(id) }
      rooms.set(id, { provider, binding, stop })
      await useCollabStore.getState().refresh()
    } catch (err) {
      if(opened) void collabApi.document({id,action:'close'}).catch(closeError=>useCollabStore.setState({notice:String(closeError)}))
      provider?.destroy()
      setError(String(err))
    } finally { setBusy(false) }
  }
  const stop = async () => {
    setBusy(true)
    try { await collabApi.document({ id, action: 'close' }); rooms.get(id)?.stop(); await useCollabStore.getState().refresh() }
    catch (err) { setError(String(err)) }
    finally { setBusy(false) }
  }
  return <div className="flex items-center gap-2 border-b border-border-1 bg-surface-1 px-3 py-1 text-xs">
    <span className="min-w-0 flex-1 text-text-3">{shared ? 'Live · le modifiche dei partecipanti restano nel buffer. Salva per scrivere sul disco.' : 'Progetto condiviso · abilita esplicitamente questo file per la modifica live.'}</span>
    <button type="button" disabled={busy} className="shrink-0 rounded border border-border-2 px-2 py-1 text-accent disabled:opacity-50" onClick={() => void (shared ? stop() : share())}>{shared ? 'Interrompi live' : 'Condividi file live'}</button>
    {error && <span role="alert" className="text-status-err">{error}</span>}
  </div>
}

useCollabStore.subscribe((state, previous) => {
  if (state.status?.sessionId !== previous.status?.sessionId || state.status?.mode === 'idle') {
    for (const room of [...rooms.values()]) room.stop()
  }
  const participants = new Set(state.status?.participants.map(p => p.id))
  for (const participant of previous.status?.participants ?? []) if (!participants.has(participant.id)) for (const room of rooms.values()) room.provider.removeParticipant(participant.id)
})

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { compareCollections } from '@/lib/collab/merge'
import { QUICK_REQUESTS_COLLECTION_ID, useCollectionsStore } from '@/stores/collections'
import { useCollabStore, type CollabInboxItem } from '@/stores/collab'

const display = (value: unknown) => value === undefined ? 'Assente' : JSON.stringify(value, null, 2)

export function CollabCollectionImport({ item, onClose }: { item: CollabInboxItem; onClose: () => void }) {
  const collections = useCollectionsStore(s => s.collections)
  const [targetId, setTargetId] = useState('')
  const [mode, setMode] = useState<'new' | 'replace' | 'merge'>('new')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const target = collections.find(c => c.id === targetId)
  const incoming = item.content?.kind === 'collection' ? item.content.collection : null
  const plan = useMemo(() => target && incoming ? compareCollections(target, { ...incoming, name: target.name }) : null, [target, incoming])
  // A preview is bound to the exact local revision: changes while open require a new review.
  const [reviewedRevision, setReviewedRevision] = useState('')
  if (!incoming) return null

  function chooseTarget(id: string) {
    setTargetId(id)
    setSelected(new Set())
    setReviewedRevision(JSON.stringify(collections.find(c => c.id === id)))
    setError('')
  }
  function apply() {
    if (!incoming) return
    if (mode === 'new') useCollabStore.getState().accept(item.id)
    else {
      const latest = useCollectionsStore.getState().collections.find(c => c.id === targetId)
      if (!latest || JSON.stringify(latest) !== reviewedRevision) {
        setError('La collection locale è cambiata. Seleziona di nuovo la destinazione per rivedere il confronto.')
        return
      }
      const result = mode === 'replace' ? { ...incoming, id: latest.id, name: latest.name } : plan?.apply(selected)
      if (!result) return
      useCollectionsStore.getState().updateCollection(latest.id, result)
      useCollabStore.getState().dismiss(item.id)
    }
    onClose()
  }
  return <section className="mt-2 space-y-3 rounded border border-border-2 bg-surface-0 p-3" aria-label={`Importa ${item.title}`}>
    {item.revision && <p className="break-all font-mono text-[10px] text-text-3">Revisione ricevuta: {item.revision.slice(0, 16)}</p>}
    <div className="flex flex-wrap gap-2">
      {([['new', 'Importa come nuova'], ['replace', 'Sostituisci'], ['merge', 'Confronta e unisci']] as const).map(([id, label]) => <Button key={id} size="sm" variant={mode === id ? 'default' : 'secondary'} onClick={() => setMode(id)}>{label}</Button>)}
    </div>
    {mode !== 'new' && <label className="block text-xs text-text-3">Collection di destinazione
      <select value={targetId} onChange={e => chooseTarget(e.target.value)} className="mt-1 h-8 w-full rounded border border-border-2 bg-surface-1 px-2 text-text-1">
        <option value="">Seleziona…</option>
        {collections.filter(c => c.id !== QUICK_REQUESTS_COLLECTION_ID).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>}
    {mode === 'replace' && target && <p className="text-xs text-warning">Sostituisce tutti i contenuti di {target.name}. Nome e ID della collection locale restano invariati.</p>}
    {mode === 'merge' && plan && <>
      <p className="text-xs text-text-3">{plan.changes.length} differenze · {plan.changes.filter(c => c.conflict).length} conflitti. Seleziona i valori ricevuti da applicare; quelli non selezionati restano locali.</p>
      <div className="max-h-80 space-y-2 overflow-auto">{plan.changes.map(change => <label key={change.path} className="block rounded border border-border-1 p-2 text-xs">
        <span className="flex items-center gap-2"><input type="checkbox" checked={selected.has(change.path)} onChange={e => setSelected(current => { const next = new Set(current); if (e.target.checked) next.add(change.path); else next.delete(change.path); return next })}/><span className="break-all font-mono">{decodeURIComponent(change.path)}</span><span className="ml-auto text-warning">{change.conflict ? 'Conflitto' : 'Nuovo'}</span></span>
        <div className="mt-2 grid grid-cols-2 gap-2"><div><span className="text-text-3">Locale</span><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono">{display(change.local)}</pre></div><div><span className="text-text-3">Ricevuto</span><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono">{display(change.incoming)}</pre></div></div>
      </label>)}</div>
    </>}
    {error && <p role="alert" className="text-xs text-error">{error}</p>}
    <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={onClose}>Annulla</Button><Button size="sm" onClick={apply} disabled={mode !== 'new' && (!target || (mode === 'merge' && !selected.size))}>{mode === 'replace' ? 'Conferma sostituzione' : 'Applica'}</Button></div>
  </section>
}

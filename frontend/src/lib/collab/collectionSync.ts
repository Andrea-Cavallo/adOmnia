import { collabApi } from '@/lib/collab-api'
import { useCollabStore } from '@/stores/collab'
import { useCollectionsStore } from '@/stores/collections'
import type { Collection } from '@/lib/types'

let active: {id:string;sessionId:string;stop:()=>void} | null = null

export function stopCollectionSync() { const previous=active;active=null;previous?.stop();useCollabStore.setState({syncingCollectionId:null}) }

/** Explicit sender opt-in. Receiver always gets a snapshot for manual merge. */
export function startCollectionSync(id:string, reviewed:Collection) {
  stopCollectionSync()
  const sessionId=useCollabStore.getState().status?.sessionId
  if(!sessionId)return
  let previous=JSON.stringify(reviewed)
  let timer:ReturnType<typeof setTimeout> | undefined
  let stopped=false
  let pending:Collection | null=null
  let sending=false
  const flush=async()=>{
    if(sending || stopped || !pending)return
    const value=pending;pending=null;sending=true
    try {await collabApi.syncCollection(id,value.name,value)}
    catch(err){useCollabStore.setState({notice:`Sync collection interrotto: ${String(err)}. Le modifiche locali sono conservate.`});stopCollectionSync()}
    finally {sending=false;if(pending && !stopped)void flush()}
  }
  const observe=()=>{
    const value=useCollectionsStore.getState().collections.find(c=>c.id===id)
    if(!value){stopCollectionSync();return}
    const next=JSON.stringify(value)
    if(next===previous)return
    previous=next;pending=value
    if(timer)clearTimeout(timer)
    timer=setTimeout(()=>void flush(),750)
  }
  const unsubscribe=useCollectionsStore.subscribe(observe)
  const sessionUnsubscribe=useCollabStore.subscribe(state=>{
    const status=state.status,self=status?.participants.find(p=>p.id===status.self)
    if(status?.sessionId!==sessionId || status.disconnected || status.mode==='idle' || self?.role==='viewer')stopCollectionSync()
  })
  active={id,sessionId,stop:()=>{stopped=true;unsubscribe();sessionUnsubscribe();if(timer)clearTimeout(timer)}}
  useCollabStore.setState({syncingCollectionId:id})
  // Include local changes made after the reviewed initial preview, within explicit opt-in.
  observe()
}

export function syncedCollectionId() {return active?.id ?? null}

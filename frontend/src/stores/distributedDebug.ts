import { create } from 'zustand'

type Group = { sessionIds: string[]; traceId: string }
let channel: BroadcastChannel | undefined
/** Explicit, transient group shared with detached panels; never written to storage. */
export const useDistributedDebugStore = create<Group & { set: (ids: string[], trace: string) => void; clear: () => void }>(set => ({
  sessionIds: [], traceId: '',
  set: (ids, trace) => { const group = { sessionIds: [...new Set(ids)], traceId: trace }; set(group); channel?.postMessage(group) },
  clear: () => { const group = { sessionIds: [], traceId: '' }; set(group); channel?.postMessage(group) },
}))
if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  channel = new BroadcastChannel('adomnia-distributed-debug')
  channel.onmessage = ({data}) => {
    if (data === 'snapshot') { const {sessionIds, traceId} = useDistributedDebugStore.getState(); if (sessionIds.length) channel?.postMessage({sessionIds, traceId}); return }
    if (data && Array.isArray(data.sessionIds) && data.sessionIds.length <= 16 && data.sessionIds.every((id: unknown) => typeof id === 'string') && typeof data.traceId === 'string') useDistributedDebugStore.setState({sessionIds: data.sessionIds, traceId: data.traceId})
  }
  channel.postMessage('snapshot')
  import.meta.hot?.dispose(() => channel?.close())
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Collection } from '@/lib/types'

const mock=vi.hoisted(()=>({
  send:vi.fn().mockResolvedValue({}),
  collections:[] as Collection[],
  status:{sessionId:'session',mode:'host',self:'host',disconnected:false,participants:[{id:'host',role:'controller'}]},
  collectionListeners:new Set<()=>void>(),sessionListeners:new Set<(state:unknown)=>void>(),
}))
vi.mock('@/lib/collab-api',()=>({collabApi:{syncCollection:mock.send}}))
vi.mock('@/stores/collections',()=>({useCollectionsStore:{getState:()=>({collections:mock.collections}),subscribe:(handler:()=>void)=>{mock.collectionListeners.add(handler);return()=>mock.collectionListeners.delete(handler)}}}))
vi.mock('@/stores/collab',()=>({useCollabStore:{getState:()=>({status:mock.status}),setState:()=>{},subscribe:(handler:(state:unknown)=>void)=>{mock.sessionListeners.add(handler);return()=>mock.sessionListeners.delete(handler)}}}))
import { startCollectionSync, stopCollectionSync } from './collectionSync'

afterEach(()=>{stopCollectionSync();vi.useRealTimers();mock.send.mockClear()})
describe('explicit live collection snapshot sync',()=>{
  it('coalesces edits, ignores unrelated changes and stops after disconnect',async()=>{
    vi.useFakeTimers()
    const collection:Collection={id:'c',name:'Original',children:[]}
    mock.collections=[collection]
    startCollectionSync('c',collection)
    for(const name of ['First','Latest']){
      mock.collections=[{...collection,name}]
      for(const listener of mock.collectionListeners)listener()
    }
    await vi.advanceTimersByTimeAsync(750)
    expect(mock.send).toHaveBeenCalledTimes(1)
    expect(mock.send.mock.calls[0][1]).toBe('Latest')
    for(const listener of mock.collectionListeners)listener()
    await vi.advanceTimersByTimeAsync(750)
    expect(mock.send).toHaveBeenCalledTimes(1)
    for(const listener of mock.sessionListeners)listener({status:{...mock.status,disconnected:true}})
    mock.collections=[{...collection,name:'Offline'}]
    for(const listener of mock.collectionListeners)listener()
    await vi.advanceTimersByTimeAsync(750)
    expect(mock.send).toHaveBeenCalledTimes(1)
  })
})

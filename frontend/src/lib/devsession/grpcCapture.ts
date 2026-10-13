import { beginLiveRequest, endLiveRPC, CORRELATION_HEADER, type RequestRun } from '@/lib/devsession-api'
import { useDevSessionStore } from '@/stores/devSession'
import { useDistributedDebugStore } from '@/stores/distributedDebug'
import { sessionForRequest } from '@/stores/devSessionModel'
import { traceparentFor } from './traceparent'

export async function beginGrpcCapture(address: string, service: string, method: string, tls: boolean, metadata: Record<string, string>) {
 if (!useDevSessionStore.getState().ready) await useDevSessionStore.getState().load()
 const state = useDevSessionStore.getState()
 const url = `${tls ? 'https' : 'http'}://${address}/${service}/${method}`
 const session = sessionForRequest(state,url,url)
 if (!session) return {run: null as RequestRun | null,metadata,debug:false}
 const members=useDistributedDebugStore.getState().sessionIds
 const run=await beginLiveRequest({protocol:'grpc',sessionIds:members.includes(session.id)?members:[],sessionId:session.id,tabId:'grpc:live',name:`${service}/${method}`,method:'GRPC',url})
 if (!run.id) return {run:null as RequestRun | null,metadata,debug:false}
 useDevSessionStore.getState().apply({type:'request.started',sessionId:run.sessionId,payload:run})
 const correlated={...metadata}
 const keys=Object.keys(correlated).map(key=>key.toLowerCase())
 if (state.prefs.correlationHeader) {
  if (!keys.includes(CORRELATION_HEADER.toLowerCase())) correlated[CORRELATION_HEADER.toLowerCase()]=run.correlationId
  if (!keys.includes('traceparent')) correlated.traceparent=traceparentFor(run.correlationId)
 }
 return {run,metadata:correlated,debug:session.kind==='debug'}
}
export async function endGrpcCapture(run: RequestRun | null,status: string,duration: number,error='') {
 if (!run) return
 const completed=await endLiveRPC(run.id,status,Math.round(duration),error)
 useDevSessionStore.getState().apply({type:'request.completed',sessionId:run.sessionId,payload:completed})
}

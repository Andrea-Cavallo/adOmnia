import { useState } from 'react'
import { captureRequestGoroutines, type RequestRun } from '@/lib/devsession-api'
import { useDevSessionStore } from '@/stores/devSession'
import { openFrameInCodeStudio } from '@/lib/devsession/navigation'

export function RequestGoroutines({run}: {run:RequestRun}) {
 const sessions=useDevSessionStore(state=>state.sessions)
 const [busy,setBusy]=useState(false);const [error,setError]=useState('')
 const paused=(run.sessionIds ?? [run.sessionId]).filter(id=>sessions[id]?.state==='paused')
 const capture=async () => {
  setBusy(true);setError('')
  try {for (const id of paused) {
   // oxlint-disable-next-line eslint/no-await-in-loop -- sequential captures: one debugger session at a time
   const updated=await captureRequestGoroutines(run.id,id);useDevSessionStore.getState().apply({type:'request.updated',sessionId:id,payload:updated})}}
  catch(err){setError(String(err))}finally{setBusy(false)}
 }
 return <div className="space-y-2 p-3 text-xs text-text-2">
  <div className="flex items-center gap-2"><span className="font-semibold">Goroutine snapshots</span><button type="button" disabled={busy||!paused.length} onClick={()=>void capture()} className="rounded border border-border-2 px-2 py-1 text-accent disabled:opacity-40">{busy?'Capturing goroutines…':'Capture paused services'}</button></div>
  <p className="text-text-4">All goroutines listed by Delve at the stop. Only the stopped goroutine is highlighted; background goroutines are not attributed to this request.</p>
  {error && <p role="alert" className="text-error">{error}</p>}
  {!(run.goroutineCaptures?.length) && <p className="text-text-4">Pause a participating service to capture its goroutines.</p>}
  {[...(run.goroutineCaptures ?? [])].reverse().map((snapshot)=><section key={`${snapshot.sessionId}:${snapshot.at}`} className="rounded border border-border-1 p-2">
   <p className="mb-2">{sessions[snapshot.sessionId]?.service ?? snapshot.sessionId} · {new Date(snapshot.at).toLocaleTimeString()} · {snapshot.goroutines.length}/{snapshot.total} goroutines{snapshot.truncated?' · capture limit reached':''}</p>
   {snapshot.error && <p className="text-error">{snapshot.error}</p>}
   {snapshot.goroutines.map(thread=><details key={thread.id} className="border-t border-border-1 py-1"><summary className={thread.id===snapshot.stoppedThreadId?'cursor-pointer text-warning':'cursor-pointer'}>#{thread.id} {thread.name}{thread.id===snapshot.stoppedThreadId?' · stopped':''}</summary>
    {thread.error && <p className="text-error">{thread.error}</p>}
    {(thread.stack ?? []).map((frame)=><button key={`${frame.file}:${frame.line}:${frame.function}`} type="button" disabled={!sessions[snapshot.sessionId]} onClick={()=>void openFrameInCodeStudio(sessions[snapshot.sessionId],frame)} className="block max-w-full truncate py-1 font-mono text-accent">{frame.function} · {frame.relativePath||frame.file}:{frame.line}</button>)}
   </details>)}
  </section>)}
 </div>
}

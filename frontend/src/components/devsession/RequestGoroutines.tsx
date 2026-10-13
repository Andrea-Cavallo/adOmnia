import { useState } from 'react'
import { captureRequestGoroutines, type RequestRun } from '@/lib/devsession-api'
import { useDevSessionStore } from '@/stores/devSession'
import { openFrameInGoStudio } from '@/lib/devsession/navigation'

export function RequestGoroutines({run}: {run:RequestRun}) {
 const sessions=useDevSessionStore(state=>state.sessions)
 const [busy,setBusy]=useState(false);const [error,setError]=useState('')
 const paused=(run.sessionIds ?? [run.sessionId]).filter(id=>sessions[id]?.state==='paused')
 const capture=async () => {
  setBusy(true);setError('')
  try {for (const id of paused) {const updated=await captureRequestGoroutines(run.id,id);useDevSessionStore.getState().apply({type:'request.updated',sessionId:id,payload:updated})}}
  catch(error){setError(String(error))}finally{setBusy(false)}
 }
 return <div className="space-y-2 p-3 text-xs text-text-2">
  <div className="flex items-center gap-2"><span className="font-semibold">Goroutine snapshots</span><button type="button" disabled={busy||!paused.length} onClick={()=>void capture()} className="rounded border border-border-2 px-2 py-1 text-accent disabled:opacity-40">{busy?'Capturing goroutines…':'Capture paused services'}</button></div>
  <p className="text-text-4">All goroutines listed by Delve at the stop. Only the stopped goroutine is highlighted; background goroutines are not attributed to this request.</p>
  {error && <p role="alert" className="text-error">{error}</p>}
  {!(run.goroutineCaptures?.length) && <p className="text-text-4">Pause a participating service to capture its goroutines.</p>}
  {[...(run.goroutineCaptures ?? [])].reverse().map((capture,index)=><section key={`${capture.sessionId}:${capture.at}:${index}`} className="rounded border border-border-1 p-2">
   <p className="mb-2">{sessions[capture.sessionId]?.service ?? capture.sessionId} · {new Date(capture.at).toLocaleTimeString()} · {capture.goroutines.length}/{capture.total} goroutines{capture.truncated?' · capture limit reached':''}</p>
   {capture.error && <p className="text-error">{capture.error}</p>}
   {capture.goroutines.map(thread=><details key={thread.id} className="border-t border-border-1 py-1"><summary className={thread.id===capture.stoppedThreadId?'cursor-pointer text-warning':'cursor-pointer'}>#{thread.id} {thread.name}{thread.id===capture.stoppedThreadId?' · stopped':''}</summary>
    {thread.error && <p className="text-error">{thread.error}</p>}
    {(thread.stack ?? []).map((frame,i)=><button key={i} type="button" disabled={!sessions[capture.sessionId]} onClick={()=>void openFrameInGoStudio(sessions[capture.sessionId],frame)} className="block max-w-full truncate py-1 font-mono text-accent">{frame.function} · {frame.relativePath||frame.file}:{frame.line}</button>)}
   </details>)}
  </section>)}
 </div>
}

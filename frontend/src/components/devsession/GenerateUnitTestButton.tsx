import { lazy, Suspense, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import type { RequestRun } from '@/lib/devsession-api'
import { useDevSessionStore } from '@/stores/devSession'
import { useRouteForRequest } from '@/lib/devsession/useRouteForRequest'
const UnitTestModal=lazy(()=>import('./UnitTestModal'))

export function GenerateUnitTestButton({run}: {run:RequestRun}) {
 const session=useDevSessionStore(state=>state.sessions[run.sessionId])
 const route=useRouteForRequest(run.method,run.url,session?.goSessionId)
 const [open,setOpen]=useState(false)
 if(run.protocol==='grpc') return null
 return <><button type="button" disabled={!route} onClick={()=>setOpen(true)} aria-label="Generate unit test" title={route?'Generate an in-process handler unit test; review fixtures and expected results before saving.':'No handler declaration found for this request'} className="rounded border border-border-2 px-2 py-0.5 text-text-2 hover:text-accent disabled:opacity-40"><FlaskConical size={11}/></button>{open && route && <Suspense fallback={null}><UnitTestModal run={run} route={route} onClose={()=>setOpen(false)}/></Suspense>}</>
}

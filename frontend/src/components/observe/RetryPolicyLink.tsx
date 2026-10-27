import { useState } from 'react'
import type { OtlpSpan } from '@/lib/otlp-api'
import { spanSource } from './traceStudioModel'
import { openEntity } from '@/lib/entities/router'
import { serviceNameFor } from '@/lib/devsession-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { relativeToRoots } from '@/lib/sourcePaths'
import { projectArtifactText } from '@/lib/code-studio/projectArtifacts'
import { FindRetryPolicies } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/goide'
import { CodeStudioModal, CodeStudioButton } from '@/components/code-studio/CodeStudioModal'

export function retryPolicySource(span:OtlpSpan,spans:readonly OtlpSpan[]) {
 const seen=new Set<string>();let current:OtlpSpan|undefined=span
 while(current && !seen.has(current.spanId)) {
  seen.add(current.spanId);const attrs=current.attributes ?? {}
  const file=attrs['adomnia.retry.policy.file'] ?? attrs['retry.policy.file']
  const line=Number(attrs['adomnia.retry.policy.line'] ?? attrs['retry.policy.line'])
  if(file && Number.isInteger(line) && line>0) return {file,line,service:attrs['adomnia.retry.policy.service'] ?? attrs['retry.policy.service'] ?? current.service}
  current=spans.find(item=>item.spanId===current?.parentSpanId)
 }
 return null
}

export function RetryPolicyLink({span,spans}: {span:OtlpSpan;spans:OtlpSpan[]}) {
 const [busy,setBusy]=useState(false);const [error,setError]=useState('')
 const [candidates,setCandidates]=useState<{sessionId:string;file:string;items:{line:number;name:string}[]}|null>(null)
 const open=async()=> {
  setBusy(true);setError('')
  try {
   if(!useCodeStudioStore.getState().initialized) await useCodeStudioStore.getState().initialize()
   const policy=retryPolicySource(span,spans)
   const source=policy ?? (spanSource(span) ? {...spanSource(span)!,service:span.service}:null)
   if(!source) throw new Error('No policy source or span source was captured')
   const matches=(await Promise.all(useCodeStudioStore.getState().sessions.map(async session=>({session,name:await serviceNameFor(session.id)})))).filter(item=>item.name===source.service)
   if(matches.length!==1) throw new Error(`Open exactly one Go project for ${source.service}`)
   const session=matches[0].session
   const mapped=relativeToRoots(source.file,[{id:session.id,root:session.project.realPath},{id:session.id,root:session.project.rootPath}])
   const file=mapped?.relativePath ?? source.file
   const text=await projectArtifactText(session.id,file)
   if(policy) await openEntity({kind:'symbol',id:`policy:${session.id}:${file}:${policy.line}`,label:'Retry policy',sessionId:session.id,attrs:{},source:{file,line:policy.line}},'open')
   else {
    const items=await FindRetryPolicies(session.id,file,text,source.line)
    if(!items.length) throw new Error('No static retry candidates in this function. Export adomnia.retry.policy.file and adomnia.retry.policy.line for an exact link.')
    setCandidates({sessionId:session.id,file,items})
   }
  }catch(failure){setError(String(failure))}finally{setBusy(false)}
 }
 return <div><button type="button" disabled={busy} onClick={()=>void open()} className="rounded border border-warning/50 px-2 py-1 text-warning">{busy?'Locating retry policy…':'Retry → policy'}</button>{error && <p role="alert" className="mt-1 text-error">{error}</p>}
  <CodeStudioModal open={!!candidates} onClose={()=>setCandidates(null)} title="Retry candidates" subtitle="Static calls in the span function. Select a declaration; runtime ownership is not established." size="md">
   {candidates?.items.map(item=><CodeStudioButton key={`${item.line}:${item.name}`} onClick={()=> {void openEntity({kind:'symbol',id:`retry:${candidates.sessionId}:${item.line}`,sessionId:candidates.sessionId,label:item.name,attrs:{},source:{file:candidates.file,line:item.line}},'open');setCandidates(null)}}>{item.name} · {candidates.file}:{item.line}</CodeStudioButton>)}
  </CodeStudioModal>
 </div>
}

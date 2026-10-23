import { useState } from 'react'
import { CodeStudioModal, CodeStudioButton, CodeStudioField, CodeStudioAlert } from '@/components/code-studio/CodeStudioModal'
import { GenerateHandlerTest } from '../../../bindings/adomnia/goide'
import type { HandlerTestPreview } from '../../../bindings/adomnia/internal/languages/golang/models'
import type { RequestRun } from '@/lib/devsession-api'
import type { RouteMatch } from '@/lib/devsession/routeMatch'
import { pathParams,requestPath } from '@/lib/devsession/routeMatch'
import { projectArtifactText } from '@/lib/code-studio/projectArtifacts'
import { createGoIDEFiles } from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useTabsStore } from '@/stores/tabs'
import { stripBody,stripHeaders } from '@/lib/devsession/reproduction'
import { openFrameInCodeStudio } from '@/lib/devsession/navigation'
import { useDevSessionStore } from '@/stores/devSession'

export default function UnitTestModal({run,route,onClose}: {run:RequestRun;route:RouteMatch;onClose:()=>void}) {
 const [fixture,setFixture]=useState(()=> {
  const request=useTabsStore.getState().tabs.find(tab=>tab.id===run.tabId)?.request
  const body=request?.bodies[request.activeBodyIdx]
  const raw=body?.type==='urlencoded'?body.form.filter(row=>row.enabled).map(row=>`${encodeURIComponent(row.key)}=${encodeURIComponent(row.value)}`).join('&'):body?.type==='none'?'':body?.raw ?? ''
  const url=new URL(run.url);for(const key of [...url.searchParams.keys()]) if(/pass|secret|token|key|credential/i.test(key)) url.searchParams.set(key,'<redacted>')
  return JSON.stringify({method:run.method,path:url.pathname+url.search,body:stripBody(raw),headers:Object.fromEntries(stripHeaders(request?.headers ?? []).filter(header=>!header.secret).map(header=>[header.key,header.value])),pathParams:pathParams(route.route.attrs.path ?? '',requestPath(run.url) ?? '')},null,2)
 })
 const [expectedStatus,setExpectedStatus]=useState('200');const [expectedBody,setExpectedBody]=useState('');const [assertBody,setAssertBody]=useState(false)
 const [expression,setExpression]=useState('');const [setup,setSetup]=useState('')
 const [preview,setPreview]=useState<HandlerTestPreview|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('')
 const invalidate=()=>setPreview(null)
 const generate=async()=> {
  setBusy(true);setError('');setPreview(null)
  try {
   const input=JSON.parse(fixture) as {method:string;path:string;body:string;headers:Record<string,string>;pathParams:Record<string,string>}
   const source=await projectArtifactText(route.goSessionId,route.file)
   setPreview(await GenerateHandlerTest(route.goSessionId,route.file,source,{...input,line:route.line,routePattern:route.route.attrs.path ?? '',expectedStatus:Number(expectedStatus),expectedBody:assertBody?expectedBody:null,handlerExpression:expression,setup}))
  }catch(failure){setError(String(failure))}finally{setBusy(false)}
 }
 const save=async()=> {
  if(!preview)return
  setBusy(true);setError('')
  try {
   await createGoIDEFiles(route.goSessionId,[{relativePath:preview.relativePath,content:preview.content}])
   const state=useCodeStudioStore.getState();if(state.activeSessionId!==route.goSessionId)await state.selectSession(route.goSessionId)
   const live=useDevSessionStore.getState().sessions[run.sessionId]
   if(live)await openFrameInCodeStudio(live,{relativePath:preview.relativePath,function:preview.handler,line:1})
   else await useCodeStudioStore.getState().openLocation(preview.relativePath,1,1)
   onClose()
  }catch(failure){setError(String(failure))}finally{setBusy(false)}
 }
 return <CodeStudioModal open onClose={onClose} title="Generate unit test" subtitle={`${route.file}:${route.line} · ${route.name}`} size="xl" footer={<><CodeStudioButton disabled={busy} onClick={()=>void generate()}>Preview test</CodeStudioButton><CodeStudioButton disabled={busy||!preview} onClick={()=>void save()}>Save and open test</CodeStudioButton></>}>
  <p className="mb-3 text-xs text-text-3">Invokes the handler in process with httptest. Choose the expected result, replace redacted values with safe fixtures, and arrange dependencies. The test is saved without running it.</p>
  {error && <CodeStudioAlert>{error}</CodeStudioAlert>}
  <div className="grid grid-cols-2 gap-3"><CodeStudioField label="Expected status"><input className="gs-input" value={expectedStatus} onChange={event=>{invalidate();setExpectedStatus(event.target.value)}}/></CodeStudioField><CodeStudioField label="Handler expression (receiver methods)"><input className="gs-input gs-mono" value={expression} onChange={event=>{invalidate();setExpression(event.target.value)}} placeholder="NewServer().ServeHTTP"/></CodeStudioField></div>
  <label className="my-2 flex gap-2 text-xs"><input type="checkbox" checked={assertBody} onChange={event=>{invalidate();setAssertBody(event.target.checked)}}/>Assert exact response body</label>
  {assertBody && <textarea aria-label="Expected body" className="gs-input gs-mono mb-2 w-full" value={expectedBody} onChange={event=>{invalidate();setExpectedBody(event.target.value)}}/>}
  <CodeStudioField label="Request fixture"><textarea className="gs-input gs-mono h-36 w-full" value={fixture} onChange={event=>{invalidate();setFixture(event.target.value)}}/></CodeStudioField>
  <CodeStudioField label="Test setup (Go statements)"><textarea className="gs-input gs-mono h-20 w-full" value={setup} onChange={event=>{invalidate();setSetup(event.target.value)}}/></CodeStudioField>
  {preview && <div className="mt-3"><p className="text-xs text-text-3">{preview.relativePath} · {preview.framework} · existing files will not be overwritten</p><pre className="mt-2 max-h-64 overflow-auto rounded bg-surface-0 p-3 text-xs text-text-2">{preview.content}</pre></div>}
 </CodeStudioModal>
}

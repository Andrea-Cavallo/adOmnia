import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { MonacoBinding } from 'y-monaco'
import { collabApi, subscribeCollabEvents } from '@/lib/collab-api'
import { CollabYjsProvider, type DocumentMessage } from '@/lib/collab/yjsProvider'
import { useCollabStore } from '@/stores/collab'
import { useGoIDEStore } from '@/stores/goide'
import { useSettingsStore } from '@/stores/settings'
import { configureMonacoLoader, applyGoStudioMonacoThemes, GO_STUDIO_THEMES } from '@/lib/monacoSetup'
import type { ProjectEntry } from '../../../bindings/adomnia/internal/collab/models'
import '../goide/goStudioCollab.css'

configureMonacoLoader()

export default function CollabProject() {
  const status = useCollabStore(state => state.status)
  const sessions = useGoIDEStore(state => state.sessions)
  const [session, setSession] = useState('')
  const [entries, setEntries] = useState<ProjectEntry[]>([])
  const [file, setFile] = useState<{path:string;content:string} | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  useEffect(() => {
    if (status?.mode === 'host') void useGoIDEStore.getState().initialize().catch(err => setError(String(err)))
  }, [status?.mode])
  useEffect(() => {
    request.current++
    setFile(null);setEntries([])
    if (status?.project) void collabApi.projectTree().then(items => setEntries(items ?? [])).catch(err => setError(String(err)))
  }, [status?.sessionId, status?.project?.id])
  const share = async () => {
    if (!session) return
    setBusy(true);setError('')
    try { await collabApi.shareProject(session);await useCollabStore.getState().refresh() }
    catch(err) {setError(String(err))}
    finally {setBusy(false)}
  }
  const open = async (path:string) => {
    const seq=++request.current
    setBusy(true);setError('')
    try {const received=await collabApi.readProjectFile(path);if(seq===request.current)setFile(received)}
    catch(err) {if(seq===request.current)setError(String(err))}
    finally {if(seq===request.current)setBusy(false)}
  }
  const id=file && status?.project ? `${status.project.id}:${file.path}` : ''
  return <section className="mt-4 space-y-2 border-t border-border-1 pt-4">
    <h3 className="text-sm font-semibold">Progetto condiviso</h3>
    {!status?.project && status?.mode==='host' && <div className="space-y-2">
      <select aria-label="Progetto da condividere" value={session} onChange={e=>setSession(e.target.value)} className="h-8 w-full rounded border border-border-2 bg-surface-1 px-2 text-sm">
        <option value="">Scegli un progetto aperto in Go Studio</option>
        {sessions.map(s=><option key={s.id} value={s.id}>{s.project.name}</option>)}
      </select>
      <p className="text-xs text-text-3">Condivide l’albero e i file di testo consentiti. La modifica live si abilita per singolo file in Go Studio. Segreti e file privati vengono esclusi.</p>
      <button type="button" disabled={busy || !session} onClick={()=>void share()} className="rounded border border-border-2 px-3 py-1.5 text-xs text-accent disabled:opacity-50">Condividi progetto</button>
    </div>}
    {!status?.project && status?.mode==='guest' && <p className="text-xs text-text-3">L’host non ha ancora condiviso un progetto.</p>}
    {status?.project && <>
      <p className="text-xs text-text-3">{status.project.name} · {entries.filter(e=>!e.directory).length} file visibili</p>
      <div className="max-h-44 overflow-auto rounded border border-border-1">
        {entries.filter(e=>!e.directory).map(e=><button key={e.path} type="button" onClick={()=>void open(e.path)} className="block w-full truncate px-2 py-1 text-left font-mono text-xs hover:bg-surface-2" title={e.path}>{e.path}{status.documents?.includes(`${status.project!.id}:${e.path}`) && <span className="ml-2 text-accent">live</span>}</button>)}
      </div>
    </>}
    {busy && <p className="text-xs text-text-3">Lettura in corso…</p>}
    {error && <p role="alert" className="text-xs text-status-err">{error}</p>}
    {file && <>
      <p className="font-mono text-xs text-text-2">{file.path}</p>
      {status?.mode==='guest' ? <RemoteCode key={id} id={id} path={file.path} content={file.content} live={!!status.documents?.includes(id)} /> : <pre className="max-h-60 overflow-auto rounded border border-border-1 bg-surface-1 p-2 font-mono text-xs">{file.content}</pre>}
    </>}
  </section>
}

function RemoteCode({id,path,content,live}:{id:string;path:string;content:string;live:boolean}) {
  const status=useCollabStore(state=>state.status)
  const theme=useSettingsStore(state=>state.settings.appearance.theme)
  const [error,setError]=useState('')
  const [mount,setMount]=useState(0)
  const editorRef=useRef<Parameters<OnMount>[0] | null>(null)
  const role=status?.participants.find(p=>p.id===status.self)?.role
  const editable=live && role!==undefined && role!=='viewer' && status?.mode==='guest' && !status.disconnected
  useEffect(()=>{
    const editor=editorRef.current,model=editor?.getModel()
    if(!live || !editor || !model)return
    const provider=new CollabYjsProvider(id,{
      send:message=>collabApi.document(message),
      subscribe:handler=>subscribeCollabEvents(event=>{
        if(event.type==='document')handler(event.payload as DocumentMessage,event.from)
        if(event.type==='closed' || event.type==='disconnected' || (event.type==='error' && /document|update/i.test(String(event.payload)))) provider.suspend(`${String(event.payload)}. Testo locale conservato.`)
        if(event.type==='resumed') {
          const snapshot=event.payload as NonNullable<typeof status>
          void provider.resume(snapshot.participants.find(p=>p.id===snapshot.self)?.role!=='viewer')
        }
        if(event.type==='participants') {
          const active=new Set((event.payload as {id:string}[]).map(p=>p.id))
          for(const p of status?.participants ?? [])if(!active.has(p.id))provider.removeParticipant(p.id)
        }
      }),
    },setError)
    // Bind an empty Y.Text, then request host history. Never seed guest disk text.
    const binding=new MonacoBinding(provider.text,model,new Set([editor]),provider.awareness)
    provider.awareness.setLocalStateField('user',{name:status?.participants.find(p=>p.id===status.self)?.name ?? 'Guest',file:path})
    void provider.sync().catch(err=>setError(String(err)))
    return ()=>{binding.destroy();provider.destroy()}
  },[id,live,mount])
  const extension=path.split('.').pop() ?? ''
  const language:Record<string,string>={go:'go',ts:'typescript',tsx:'typescript',js:'javascript',json:'json',md:'markdown',py:'python',rs:'rust',sql:'sql',yaml:'yaml',yml:'yaml'}
  return <div className="space-y-1">
    <p className="text-xs text-text-3">{live ? editable ? 'Modifica live · il salvataggio su disco spetta all’host.' : 'Live · sola lettura' : 'Snapshot · sola lettura'}</p>
    {error && <p role="alert" className="text-xs text-status-err">{error}</p>}
    <div className="h-80 overflow-hidden rounded border border-border-1">
      <Editor path={`collab://${id}`} defaultValue={live?'':content} language={language[extension] ?? 'plaintext'} theme={theme==='light'?GO_STUDIO_THEMES.light:GO_STUDIO_THEMES.dark} beforeMount={applyGoStudioMonacoThemes} onMount={editor=>{editorRef.current=editor;setMount(n=>n+1)}} options={{automaticLayout:true,readOnly:!editable || !!error,fontFamily:'var(--font-mono)',fontSize:13,minimap:{enabled:false},scrollBeyondLastLine:false}} />
    </div>
  </div>
}

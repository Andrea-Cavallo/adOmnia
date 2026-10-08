import { useEffect, useState } from 'react'
import { Puzzle } from 'lucide-react'
import { StartExtensionLanguageServer, StopExtensionLanguageServer } from '../../../bindings/adomnia/goide'
import { useIDEExtensionsStore, extensionLanguageForPath } from '@/stores/ideExtensions'
import { useGoIDEStore } from '@/stores/goide'
import { GoStudioModal, GoStudioButton, GoStudioAlert } from './GoStudioModal'
import { runIDEContribution } from './goStudioExtensions'
import { resyncGoStudioDocument } from './goStudioLspSync'

export function GoStudioExtensionsDialog({ open,sessionId,onClose }: {open:boolean;sessionId:string;onClose:()=>void}) {
 const items = useIDEExtensionsStore(state => state.items), load = useIDEExtensionsStore(state => state.load), error = useIDEExtensionsStore(state => state.error)
 const [status,setStatus] = useState(''), [busy,setBusy] = useState(false)
 const session = useGoIDEStore(state => state.sessions.find(session => session.id === sessionId))
 useEffect(() => { if (open) { setStatus(''); void load() } },[open,load])
 const server = async (id:string,stop=false) => {
  setBusy(true)
  try {
   if (stop) { await StopExtensionLanguageServer(sessionId,id); setStatus(`${id}: stopped`) }
   else {
    const result = await StartExtensionLanguageServer(sessionId,id)
    for (const doc of useGoIDEStore.getState().documents.filter(doc => doc.document.sessionId === sessionId && extensionLanguageForPath(doc.document.relativePath)?.id === id)) await resyncGoStudioDocument(doc.document.id)
    setStatus(`${id}: ${result.state}${result.error ? ' — '+result.error : ''}`)
   }
  } catch (error) { setStatus(String(error)) } finally { setBusy(false) }
 }
 return <GoStudioModal open={open} onClose={onClose} icon={Puzzle} title="IDE extensions" subtitle="Enabled plugin contributions. Actions use the existing sandbox; source changes require review." footer={<GoStudioButton onClick={() => void load()}>Refresh</GoStudioButton>}>
  {error && <GoStudioAlert>{error}</GoStudioAlert>}
  {status && <p role="status" className="gs-hint">{status}</p>}
  {session?.project.authorization !== 'tooling-permitted' && <GoStudioAlert>Trust the project to run actions or language servers.</GoStudioAlert>}
  {!items.length && <p className="gs-hint">No enabled IDE extensions. Install a plugin with contributes in Settings → Plugins.</p>}
  <div className="gs-list max-h-96 overflow-auto">{items.map(item => <div key={`${item.pluginId}:${item.kind}:${item.id}`} className="gs-list-row flex flex-wrap items-center gap-2">
   <div className="min-w-0 flex-1"><span className="gs-badge mr-2">{item.kind === 'adapter' ? item.adapterKind : item.kind}</span><span>{item.title}</span><p className="gs-hint">{item.pluginName}{item.kind === 'adapter' ? ` · direct dependencies: ${item.modules?.join(', ')}` : item.kind === 'template' ? ' · available in New Project' : item.kind === 'language' ? ` · ${item.extensions?.join(', ')}` : ''}</p></div>
   {['command','codeAction','analyzer'].includes(item.kind) && <GoStudioButton disabled={busy || session?.project.authorization !== 'tooling-permitted'} onClick={() => void runIDEContribution(item,undefined,item.kind === 'analyzer')}>Run</GoStudioButton>}
   {item.kind === 'language' && item.server && <><code className="gs-mono break-all text-text-3">{[item.server.command,...item.server.args ?? []].join(' ')}</code><GoStudioButton disabled={busy || session?.project.authorization !== 'tooling-permitted'} onClick={() => void server(item.id)}>Start LSP</GoStudioButton><GoStudioButton disabled={busy} onClick={() => void server(item.id,true)}>Stop</GoStudioButton></>}
  </div>)}</div>
 </GoStudioModal>
}

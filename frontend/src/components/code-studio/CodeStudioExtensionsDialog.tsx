import { useEffect, useState } from 'react'
import { Puzzle } from 'lucide-react'
import { StartExtensionLanguageServer, StopExtensionLanguageServer } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/goide'
import { useIDEExtensionsStore, extensionLanguageForPath } from '@/stores/ideExtensions'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { CodeStudioModal, CodeStudioButton, CodeStudioAlert } from './CodeStudioModal'
import { runIDEContribution } from './codeStudioExtensions'
import { resyncCodeStudioDocument } from './codeStudioLspSync'

export function CodeStudioExtensionsDialog({ open,sessionId,onClose }: {open:boolean;sessionId:string;onClose:()=>void}) {
 const items = useIDEExtensionsStore(state => state.items), load = useIDEExtensionsStore(state => state.load), error = useIDEExtensionsStore(state => state.error)
 const [status,setStatus] = useState(''), [busy,setBusy] = useState(false)
 const session = useCodeStudioStore(state => state.sessions.find(candidate => candidate.id === sessionId))
 const [wasOpen,setWasOpen] = useState(open)
 if (wasOpen !== open) { setWasOpen(open); if (open) setStatus('') }
 useEffect(() => { if (open) void load() },[open,load])
 const server = async (id:string,stop=false) => {
  setBusy(true)
  try {
   if (stop) { await StopExtensionLanguageServer(sessionId,id); setStatus(`${id}: stopped`) }
   else {
    const result = await StartExtensionLanguageServer(sessionId,id)
    const matching = useCodeStudioStore.getState().documents.filter(entry => entry.document.sessionId === sessionId && extensionLanguageForPath(entry.document.relativePath)?.id === id)
    await Promise.all(matching.map(entry => resyncCodeStudioDocument(entry.document.id)))
    setStatus(`${id}: ${result.state}${result.error ? ' — '+result.error : ''}`)
   }
  } catch (problem) { setStatus(String(problem)) } finally { setBusy(false) }
 }
 return <CodeStudioModal open={open} onClose={onClose} icon={Puzzle} title="IDE extensions" subtitle="Enabled plugin contributions. Actions use the existing sandbox; source changes require review." footer={<CodeStudioButton onClick={() => void load()}>Refresh</CodeStudioButton>}>
  {error && <CodeStudioAlert>{error}</CodeStudioAlert>}
  {status && <p role="status" className="gs-hint">{status}</p>}
  {session?.project.authorization !== 'tooling-permitted' && <CodeStudioAlert>Trust the project to run actions or language servers.</CodeStudioAlert>}
  {!items.length && <p className="gs-hint">No enabled IDE extensions. Install a plugin with contributes in Settings → Plugins.</p>}
  <div className="gs-list max-h-96 overflow-auto">{items.map(item => <div key={`${item.pluginId}:${item.kind}:${item.id}`} className="gs-list-row flex flex-wrap items-center gap-2">
   <div className="min-w-0 flex-1"><span className="gs-badge mr-2">{item.kind === 'adapter' ? item.adapterKind : item.kind}</span><span>{item.title}</span><p className="gs-hint">{item.pluginName}{item.kind === 'adapter' ? ` · direct dependencies: ${item.modules?.join(', ')}` : item.kind === 'template' ? ' · available in New Project' : item.kind === 'language' ? ` · ${item.extensions?.join(', ')}` : ''}</p></div>
   {['command','codeAction','analyzer'].includes(item.kind) && <CodeStudioButton disabled={busy || session?.project.authorization !== 'tooling-permitted'} onClick={() => void runIDEContribution(item,undefined,item.kind === 'analyzer')}>Run</CodeStudioButton>}
   {item.kind === 'language' && item.server && <><code className="gs-mono break-all text-text-3">{[item.server.command,...item.server.args ?? []].join(' ')}</code><CodeStudioButton disabled={busy || session?.project.authorization !== 'tooling-permitted'} onClick={() => void server(item.id)}>Start LSP</CodeStudioButton><CodeStudioButton disabled={busy} onClick={() => void server(item.id,true)}>Stop</CodeStudioButton></>}
  </div>)}</div>
 </CodeStudioModal>
}

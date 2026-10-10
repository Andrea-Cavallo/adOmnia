import { useState } from 'react'
import { ArrowDownToLine, ShieldCheck, X } from 'lucide-react'
import { DialogOverlay } from '@/components/ui/dialog'
import { useUpdaterStore } from '@/stores/updater'
import { restartForUpdate } from '@/lib/updateRestart'
import './updateNotice.css'
export default function UpdateNotice() {
 const {status,error,schedule,download,cancel,check} = useUpdaterStore()
 const [dismissed,setDismissed] = useState('')
 const [restarting,setRestarting] = useState(false)
 const [restartError,setRestartError] = useState('')
 const key = `${status.version}:${status.phase}`
 const ready = status.phase === 'ready'
 const busy = ['downloading','verifying'].includes(status.phase)
 const close = () => { if(!restarting)setDismissed(key) }
 const progress = status.total > 0 ? Math.min(100,Math.floor(status.received/status.total*100)) : 0
 const problem = restartError || error || status.error
 const restart = async () => {
  setRestarting(true);setRestartError('')
  try { await restartForUpdate();setDismissed(key) }
  catch(e) { setRestartError(e instanceof Error ? e.message : String(e)) }
  finally { setRestarting(false) }
 }
 return <DialogOverlay open={['available','downloading','verifying','ready','error'].includes(status.phase) && dismissed!==key} onClose={close}>
  <section role="dialog" aria-modal="true" aria-labelledby="update-title" aria-describedby="update-description" className="update-nothing">
   <header><span>SYSTEM / UPDATE</span><button aria-label="Close update notification" disabled={restarting} onClick={close}><X size={18}/></button></header>
   <div className="update-nothing-content">
    <div className="update-nothing-glyph" aria-hidden="true">{ready?<ShieldCheck size={42} strokeWidth={1}/>:<ArrowDownToLine size={42} strokeWidth={1}/>}</div>
    <p className="update-nothing-version">ADOMNIA / {status.version || 'UPDATE'}</p>
    <h2 id="update-title">{ready?'READY TO EVOLVE.':busy?'GETTING READY.':status.phase==='error'?'LET’S TRY AGAIN.':'NEXT VERSION.'}</h2>
    <p id="update-description">{ready?'Your update is verified. Save and restart to replace the application. Your workspaces, collections and settings stay on this computer.':busy?'Downloading and verifying your update. You can keep working while it finishes.':'A new version is available. Download it securely, then choose when to restart.'}</p>
    {busy && <div className="update-nothing-progress" role="status"><div className="flex justify-between"><span>{status.phase==='verifying'?'VERIFYING SIGNATURE':'DOWNLOADING'}</span><span>{progress}%</span></div><progress aria-label="Update download" max={100} value={progress}/><p>{(status.received/1048576).toFixed(1)} / {(status.total/1048576).toFixed(1)} MB</p></div>}
    {ready && <p className="update-nothing-trust"><ShieldCheck size={14}/> SIGNATURE VERIFIED · RECOVERY ENABLED</p>}
    {problem && <p role="alert" className="update-nothing-error">{problem}</p>}
   </div>
   <footer><button disabled={restarting} onClick={close}>Later</button>
    {status.phase==='downloading' && <button onClick={()=>void cancel()}>Cancel download</button>}
    {status.phase==='available' && status.trusted && <button className="update-nothing-primary" onClick={()=>void download()}>Download update ↗</button>}
    {status.phase==='error' && <button className="update-nothing-primary" onClick={()=>void check(true)}>Try again ↗</button>}
    {ready && <button className="update-nothing-primary" disabled={restarting} onClick={()=>void restart()}>{restarting?'Saving your work…':'Save & restart ↗'}</button>}
   </footer>
   {ready && <button className="update-nothing-postpone" disabled={restarting} onClick={()=>void schedule(!status.scheduled)}>{status.scheduled?'Install on exit is enabled · click to postpone':'Install the next time I close adOmnia'}</button>}
  </section>
 </DialogOverlay>
}

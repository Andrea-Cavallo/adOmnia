import { useState } from 'react'
import { FileText, X } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings'
import { useUpdaterStore } from '@/stores/updater'
import { restartForUpdate } from '@/lib/updateRestart'
import { BrowserOpenURL } from '@/wailsjs/runtime/runtime'
import './updateNotice.css'
export default function UpdateNotice() {
 const {status,error,schedule,download,cancel,check,openApplyLog} = useUpdaterStore()
 const [dismissed,setDismissed] = useState('')
 const [restarting,setRestarting] = useState(false)
 const [restartError,setRestartError] = useState('')
 const key = `${status.version}:${status.phase === 'rollback' ? 'rollback' : 'update'}`
 const ready = status.phase === 'ready'
 const busy = ['downloading','verifying'].includes(status.phase)
 const rollback = status.phase === 'rollback'
 const close = () => { if(!restarting)setDismissed(key) }
 const progress = status.total > 0 ? Math.min(100,Math.floor(status.received/status.total*100)) : 0
 const problem = restartError || error || status.error
 const restart = async () => {
  setRestarting(true);setRestartError('')
  try { await restartForUpdate() }
  catch(e) { setRestartError(e instanceof Error ? e.message : String(e)) }
  finally { setRestarting(false) }
 }
 if (!['available','downloading','verifying','ready','error','rollback'].includes(status.phase) || dismissed===key) return null
 return <aside className="update-nothing" aria-label="Application update">
   <header><span>Application update</span><button aria-label="Close update notification" disabled={restarting} onClick={close}><X size={18}/></button></header>
   <div className="update-nothing-content">
    <p className="update-nothing-version">ADOMNIA / {status.version || 'UPDATE'}</p>
    <h2 id="update-title" role="status" aria-live="polite">{rollback?'Previous version restored':ready?'Ready to install':busy?'Downloading update':status.phase==='error'?'Update could not complete':'Update available'}</h2>
    <p id="update-description">{rollback?`Update failed; restored ${status.restoredVersion || 'the previous version'}${status.failedVersion ? ` after ${status.failedVersion} could not start` : ''}. Your local data was preserved.`:ready?status.scheduled?'The verified update will install and reopen adOmnia after you close it. Your normal save and running-task checks still apply.':'Your update is verified. Save and restart when you are ready. Your workspaces and settings are preserved.':busy?'Downloading and verifying your update. You can keep working while it finishes.':'A new version is available. Download it securely, then choose when to restart.'}</p>
    {busy && <div className="update-nothing-progress" role="status"><div className="flex justify-between"><span>{status.phase==='verifying'?'Verifying package':'Downloading'}</span><span>{status.total > 0 ? `${progress}%` : ''}</span></div><progress aria-label="Update download" max={100} value={status.total > 0 ? progress : undefined}/><p>{(status.received/1048576).toFixed(1)} MB{status.total > 0 ? ` / ${(status.total/1048576).toFixed(1)} MB` : ''}</p></div>}
    {ready && <p className="update-nothing-trust">Signature verified · startup recovery enabled</p>}
    {(problem || status.failureReason) && <p role="alert" className="update-nothing-error">{status.failureReason || problem}</p>}
   </div>
   <footer><button disabled={restarting} onClick={close}>Dismiss</button>
    {status.phase==='downloading' && <button onClick={()=>void cancel()}>Cancel download</button>}
    {status.phase==='available' && status.trusted && <button className="update-nothing-primary" onClick={()=>void download()}>Download update</button>}
    {status.phase==='error' && <button className="update-nothing-primary" onClick={()=>void check(true)}>Try again</button>}
    {rollback && status.applyLogAvailable && <button className="update-nothing-primary" onClick={()=>void openApplyLog()}><FileText size={14}/>Open apply.log</button>}
    {ready && <button className="update-nothing-primary" disabled={restarting} onClick={()=>void restart()}>{restarting?'Saving your work…':'Save & restart'}</button>}
    {status.releaseUrl && <button onClick={()=>BrowserOpenURL(status.releaseUrl)}>Release notes</button>}
   </footer>
   {ready && <button className="update-nothing-postpone" disabled={restarting} onClick={()=>{if(status.scheduled)useSettingsStore.getState().updateGeneral({installUpdatesOnExit:false});void schedule(!status.scheduled)}}>{status.scheduled?'Install on exit is enabled · click to postpone':'Install the next time I close adOmnia'}</button>}
 </aside>
}

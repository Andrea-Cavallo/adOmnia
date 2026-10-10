import { RefreshCw, Download, X } from 'lucide-react'
import { useUpdaterStore } from '@/stores/updater'
import { useSettingsStore } from '@/stores/settings'
import { BrowserOpenURL } from '@/wailsjs/runtime/runtime'

export function UpdateCheckRow() {
 const {status,error,check,download,cancel,schedule} = useUpdaterStore()
 const general = useSettingsStore(s=>s.settings.general)
 const updateGeneral = useSettingsStore(s=>s.updateGeneral)
 const busy = ['checking','downloading','verifying'].includes(status.phase)
 const progress = status.total > 0 ? Math.min(100,Math.floor(status.received/status.total*100)) : 0
 return <div className="space-y-3 py-3 px-1">
  <div className="flex items-center justify-between gap-3">
   <span className="text-xs text-text-1">Automatic updates</span>
   <label className="flex gap-2 text-xs text-text-2"><input type="checkbox" checked={general.autoCheckUpdates !== false} onChange={e=>updateGeneral({autoCheckUpdates:e.target.checked})}/>Check automatically</label>
  </div>
  <div className="flex items-center justify-between gap-3">
   <label className="text-xs text-text-2" htmlFor="update-channel">Release channel</label>
   <select id="update-channel" className="rounded border border-border-2 bg-surface-2 px-2 py-1 text-xs text-text-1" value={general.updateChannel ?? 'auto'} disabled={busy || status.scheduled} onChange={e=>{updateGeneral({updateChannel:e.target.value as 'auto'|'stable'|'beta'});void check(true)}}>
    <option value="auto">Follow installed version</option><option value="stable">Stable</option><option value="beta">Beta + stable</option>
   </select>
  </div>
  <label className="flex items-start gap-2 text-xs text-text-2"><input type="checkbox" checked={general.autoDownloadUpdates !== false} onChange={e=>{updateGeneral({autoDownloadUpdates:e.target.checked});if(!e.target.checked&&status.scheduled)void schedule(false)}}/>Download verified updates and install after closing adOmnia</label>
  <div role="status" aria-live="polite" className="text-xs text-text-3">
   {error || status.error || (status.scheduled ? `${status.version} ready — will update and restart after you close adOmnia` : ({idle:'Checks at startup and every six hours while open',dev:'Development build — updates skipped',checking:'Checking…',current:'No newer signed release for this channel',available:`${status.version} available`,downloading:`Downloading ${status.version}: ${progress}%`,verifying:'Verifying update package…',ready:`${status.version} ready to install`} as Record<string,string>)[status.phase])}
  </div>
  {status.phase === 'downloading' && <progress aria-label="Update download" className="w-full accent-accent" max={100} value={progress}/>}
  <div className="flex flex-wrap gap-2">
   <button className="flex items-center gap-1.5 rounded border border-border-2 px-2 py-1 text-xs text-text-1 disabled:opacity-50" disabled={busy || status.scheduled} onClick={()=>void check(true)}><RefreshCw size={12}/>Check now</button>
   {status.phase==='available' && status.trusted && <button className="flex items-center gap-1.5 text-xs text-accent" onClick={()=>void download()}><Download size={12}/>Download update</button>}
   {status.phase==='downloading' && <button className="flex items-center gap-1.5 text-xs text-text-2" onClick={()=>void cancel()}><X size={12}/>Cancel download</button>}
   {status.phase==='ready' && <button className="text-xs text-accent" onClick={()=>void schedule(!status.scheduled)}>{status.scheduled?'Postpone update':'Install on exit'}</button>}
   {status.releaseUrl && <button className="text-xs text-accent" onClick={()=>BrowserOpenURL(status.releaseUrl)}>Release notes</button>}
  </div>
 </div>
}

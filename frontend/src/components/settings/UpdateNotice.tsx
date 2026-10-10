import { useUpdaterStore } from '@/stores/updater'
export default function UpdateNotice() {
 const {status,schedule} = useUpdaterStore()
 if(status.phase!=='ready')return null
 return <div role="status" aria-live="polite" className="fixed bottom-10 right-4 z-50 max-w-sm rounded-lg border border-border-2 bg-surface-1 p-4 text-xs text-text-2 shadow-lg">
  <p className="font-semibold text-accent">adOmnia {status.version} ready</p>
  <p className="mt-1 leading-relaxed">{status.scheduled?'The update will install and restart adOmnia after you close it. Save your work before closing.':'Your verified update is downloaded. Choose when to install.'}</p>
  <button className="mt-2 text-accent" onClick={()=>void schedule(!status.scheduled)}>{status.scheduled?'Postpone':'Install on exit'}</button>
 </div>
}

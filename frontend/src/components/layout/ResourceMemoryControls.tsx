import { useState } from 'react'
import type { Snapshot } from '../../../bindings/adomnia/internal/resources/models'
import { useUiTranslation } from '@/lib/uiI18n'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useCodeStudioStore } from '@/stores/codeStudio'

/**
 * Preset del budget gopls. 0 ripristina il default di avvio (768 MiB); 512 è la
 * scelta per macchine con poca RAM, con il costo misurato in docs/performance/typing-2026-10-24.md.
 */
export const GOPLS_MEMORY_PRESETS = [
  { mib: 0, label: 'Default (768 MiB)', help: 'Restores the startup default (768 MiB)' },
  { mib: 512, label: 'RAM saving (512 MiB)', help: 'Saves RAM on a large Go workspace at a measured cost in completion latency and CPU' },
] as const

export function ResourceMemoryControls({ sample }: { sample: Snapshot }) {
  const tr=useUiTranslation()
  const [backend,setBackend]=useState(String(sample.runtime?.memoryLimit > 1e15 ? 0 : Math.round((sample.runtime?.memoryLimit ?? 0)/1048576)))
  const storedGoplsLimit=useCodeStudioLspStore(s=>s.settings.memoryLimitMiB ?? 0)
  const [gopls,setGopls]=useState(String(storedGoplsLimit))
  const [busy,setBusy]=useState(false), [message,setMessage]=useState(''), [error,setError]=useState('')
  const sessionId=useCodeStudioStore(s=>s.activeSessionId)
  const servers=sample.processes.filter(p=>p.role==='language-server' && p.name==='gopls' && p.sessionId)
  const [chosenSession,setChosenSession]=useState(sessionId && servers.some(p=>p.sessionId===sessionId) ? sessionId : servers[0]?.sessionId ?? '')
  const input='w-24 rounded border border-border-2 bg-surface-0 px-2 py-1 font-mono text-text-1'
  const button='rounded border border-border-2 px-2 py-1 text-text-2 hover:bg-surface-3 disabled:opacity-40'
  const apply=async(kind:'backend'|'gopls')=>{
    const value=Number(kind==='backend'?backend:gopls)
    const min=kind==='backend'?64:128
    if(!Number.isInteger(value)||(value!==0&&(value<min||value>65536))){setError(`${tr('Memory limit range')}: ${min}–65536 MiB; 0 = ${tr('Default')}`);return}
    setBusy(true);setError('');setMessage('')
    try{
      if(kind==='backend') { const {SetBackendMemoryLimit}=await import('../../../bindings/adomnia/goide'); await SetBackendMemoryLimit(value); setMessage(tr('Backend limit applied live. No app restart needed.')) }
      else {
        const store=useCodeStudioLspStore.getState()
        await store.updateSettings(null,{memoryLimitMiB:value})
        const target=servers.find(p=>p.sessionId===chosenSession)
        if(target){ await store.restart(chosenSession,false); const updated=useCodeStudioLspStore.getState(); if(updated.message || updated.status[chosenSession]?.state!=='ready') throw new Error(updated.message || tr('Language server restart failed')) }
        setMessage(tr(target ? 'gopls limit saved. Applied to the selected project; other projects use it on restart.' : 'gopls limit saved for the next start.'))
      }
    }catch(e){const detail=e instanceof Error?e.message:String(e);setError(detail && detail!=='Error'?detail:tr('Unable to apply memory limit. Check the desktop connection and retry.'))}finally{setBusy(false)}
  }
  return <section className="my-3 space-y-2 rounded border border-border-1 p-2">
    <p className="font-medium">GOMEMLIMIT <span className="text-text-4">· {tr('Soft GC limit, not a RAM or CPU cap')}</span></p>
    <div className="flex flex-wrap items-center justify-between gap-2"><label>{tr('Backend')} <input aria-label={tr('Backend memory limit in MiB')} type="number" min="0" step="1" max="65536" value={backend} onChange={e=>setBackend(e.target.value)} className={input}/> MiB</label><button type="button" disabled={busy} onClick={()=>void apply('backend')} className={button}>{tr('Apply live')}</button></div>
    <div className="flex flex-wrap items-center justify-between gap-2"><label>gopls <input aria-label={tr('gopls memory limit in MiB')} type="number" min="0" step="1" max="65536" value={gopls} onChange={e=>setGopls(e.target.value)} className={input}/> MiB</label><button type="button" disabled={busy} onClick={()=>void apply('gopls')} className={button}>{tr('Save and restart gopls')}</button></div>
    <div className="flex flex-wrap items-center gap-2"><span className="text-text-4">{tr('Presets')}</span>{GOPLS_MEMORY_PRESETS.map(preset=><button key={preset.mib} type="button" disabled={busy} onClick={()=>setGopls(String(preset.mib))} title={tr(preset.help)} className={button}>{tr(preset.label)}</button>)}</div>
    {servers.length>0&&<select aria-label={tr('Go project')} value={chosenSession} onChange={e=>setChosenSession(e.target.value)} className="w-full rounded border border-border-1 bg-surface-0 px-2 py-1">{servers.map(p=><option key={p.pid} value={p.sessionId}>{p.workspace} · PID {p.pid}</option>)}</select>}
    <p className="text-text-4">{tr('Zero restores the startup default. Lower limits can increase GC and CPU. WebView and Java memory are separate.')}</p>
    <p className="text-text-4">{tr('Measured on a large Go workspace (5 runs per limit): 512 MiB saves about 220 MiB of RAM, but completion goes from about 114 ms to 444 ms and gopls uses about 7 times the CPU.')}</p>
    {busy&&<p role="status">{tr('Applying memory limit…')}</p>}
    {message&&<p role="status" className="text-success">{message}</p>}
    {error&&<p role="alert" className="text-error">{error}</p>}
  </section>
}

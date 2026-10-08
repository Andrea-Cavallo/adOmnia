import { remoteLogLocations } from '@/lib/goide/remoteLogSource'
import { openEntity } from '@/lib/entities/router'

export function PodLogLine({ text, sessionId, paths }: { text: string; sessionId: string; paths: readonly string[] }) {
 const locations = remoteLogLocations(text,paths)
 let offset = 0
 const parts = locations.map(location => {
  const before = text.slice(offset,location.start); offset = location.end
  return <span key={location.start}>{before}<button type="button" className="text-accent underline decoration-accent/40 hover:decoration-accent" title={`Open ${location.file}:${location.line} in the selected project`} onClick={() => void openEntity({kind:'symbol',id:location.file,label:location.file,attrs:{},sessionId,source:{file:location.file,line:location.line}},'open')}>{text.slice(location.start,location.end)}</button></span>
 })
 return <div className="whitespace-pre-wrap break-all">{parts}{text.slice(offset)}</div>
}

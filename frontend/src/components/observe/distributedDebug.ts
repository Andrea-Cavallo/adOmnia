import type { OtlpSpan } from '@/lib/otlp-api'
import { spanSource } from './traceStudioModel'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDEDebugStore } from '@/stores/goideDebug'
import { useDevSessionStore } from '@/stores/devSession'
import { useDistributedDebugStore } from '@/stores/distributedDebug'
import { ensureDebugSession } from '@/lib/devsession/debugRequest'
import { serviceNameFor, waitLiveReady } from '@/lib/devsession-api'
import { relativeToRoots } from '@/lib/sourcePaths'

/** Arm the actual projects of this trace, before the next request. No service is silently guessed. */
export async function armDistributedDebug(spans: readonly OtlpSpan[]): Promise<string> {
 const store = useGoIDEStore.getState()
 if (!store.initialized) await store.initialize()
 if (!useDevSessionStore.getState().ready) await useDevSessionStore.getState().load()
 const sessions = useGoIDEStore.getState().sessions
 const named = await Promise.all(sessions.map(async session => ({session, name: await serviceNameFor(session.id)})))
 const services = [...new Set(spans.map(span => span.service))]
 if (services.length < 2 || services.length > 16) throw new Error('Select a trace with 2 to 16 services')
 // Resolve every service first: don't partially arm a trace with missing or ambiguous projects.
 const plan = services.map(service => {
   const matches = named.filter(item => item.name === service)
   if (matches.length !== 1) throw new Error(`Open one project named ${service} in Code Studio before distributed debug`)
   const session = matches[0].session
   const points = spans.filter(span => span.service === service).flatMap(span => {
     const source = spanSource(span); if (!source) return []
     const match = relativeToRoots(source.file, [{id: session.id, root: session.project.rootPath}])
     if (!match && /^([a-z]:)?[\\/]/i.test(source.file)) return []
     return [{file: match?.relativePath ?? source.file.replace(/\\/g, '/'), line: source.line}]
   })
   if (!points.length) throw new Error(`No mapped source location in the trace for ${service}`)
   return {service, session, points}
 })
 useDistributedDebugStore.getState().clear()
 const members: string[] = []
 for (const {service, session, points} of plan) {
   const debug = useGoIDEDebugStore.getState()
   for (const point of points) {
     if (!(debug.breakpoints[session.id]?.[point.file] ?? []).some(item => item.line === point.line)) await debug.toggleBreakpoint(session.id, point.file, point.line)
   }
   const live = Object.values(useDevSessionStore.getState().sessions).find(item => item.goSessionId === session.id && !item.endedAt) ?? null
   const ready = await ensureDebugSession(live, service)
   if (ready.state === 'paused') throw new Error(`Continue ${service} before arming the next request`)
   await waitLiveReady(ready.id, '', 30000)
   members.push(ready.id)
 }
 useDistributedDebugStore.getState().set(members, spans[0].traceId)
 return `Distributed debug armed for ${members.length} services. Send the next request; breakpoint hits retain service and goroutine. Time correlation is labelled as probable.`
}

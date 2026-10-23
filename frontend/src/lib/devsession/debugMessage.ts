// Debug a Kafka consumer or producer from a message: find the Go function that handles the
// topic, put a breakpoint where the message is in hand, and run the project under Delve.
import type { GoIDEArchEntry } from '@/lib/code-studio-api'
import type { LiveSession } from '@/lib/devsession-api'
import { architectureFor } from '@/lib/code-studio/architectureCache'
import { useDevSessionStore } from '@/stores/devSession'
import { liveSessions } from '@/stores/devSessionModel'
import { DebugRequestError, startGoDebug, waitForDebugSession } from './debugRequest'

export type KafkaRole = 'kafka-consumer' | 'kafka-producer'

export interface KafkaDebugTarget {
  goSessionId: string
  projectName: string
  entry: GoIDEArchEntry
  relativePath: string
  line: number
}

/** Where to stop: a consumer after it has read the message, a producer on the send. */
export function kafkaBreakSite(entry: GoIDEArchEntry): { relativePath: string; line: number } {
  const site = entry.kind === 'kafka-consumer' && entry.breakSite ? entry.breakSite : entry.site
  return { relativePath: site.relativePath, line: site.line }
}

/** The first trusted open Go project (active one first) whose code consumes or produces the topic. */
export async function findKafkaFunction(topic: string, role: KafkaRole): Promise<KafkaDebugTarget | null> {
  const { useCodeStudioStore } = await import('@/stores/codeStudio')
  const codeStudio = useCodeStudioStore.getState()
  if (!codeStudio.initialized) await codeStudio.initialize()
  const { sessions, activeSessionId } = useCodeStudioStore.getState()
  const ordered = [...sessions].sort((a, b) => Number(b.id === activeSessionId) - Number(a.id === activeSessionId))
  for (const session of ordered) {
    if (session.project.authorization !== 'tooling-permitted') continue
    // oxlint-disable-next-line eslint/no-await-in-loop -- projects are tried in priority order (active first) and the search stops at the first match
    const result = await architectureFor(session.id).catch(() => null)
    const entry = result?.report.entries.find((item) => item.kind === role && (item.topics ?? []).includes(topic))
    if (entry) return { goSessionId: session.id, projectName: session.project.name, entry, ...kafkaBreakSite(entry) }
  }
  return null
}

/** Sets a line breakpoint and makes sure the project runs under Delve; resolves with the live debug session. */
export async function debugGoAt(target: { goSessionId: string; relativePath: string; line: number }): Promise<LiveSession> {
  const { useCodeStudioDebugStore } = await import('@/stores/codeStudioDebug')
  await useCodeStudioDebugStore.getState().putBreakpoint(target.goSessionId, target.relativePath, { line: target.line })
  const running = liveSessions(useDevSessionStore.getState()).find((s) => s.goSessionId === target.goSessionId && s.kind === 'debug')
  if (running) return running
  const since = new Date(Date.now() - 1000).toISOString()
  await startGoDebug(target.goSessionId)
  return waitForDebugSession(target.goSessionId, since)
}

export { DebugRequestError }

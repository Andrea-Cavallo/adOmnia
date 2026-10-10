import type { OtlpLensStat } from '@/lib/otlp-api'
import type { LiveLogEntry } from '@/lib/devsession-api'
import type { RuntimeProfileCost } from './runtimeProfileCost'
import { runtimeByNode, runtimeText } from './runtimeLens'

const MAX_LOG_LINES = 15
const MAX_ROWS = 8

interface RuntimeChatInput {
  root: string
  file: string
  lens: readonly OtlpLensStat[]
  costs: readonly RuntimeProfileCost[]
  logs: readonly LiveLogEntry[]
}

const ERROR_LINE = /\b(error|panic|fatal|fail(ed|ure)?|timeout|deadline|refused)\b/i

function formatCost(cost: RuntimeProfileCost): string {
  if (cost.unit === 'nanoseconds') return `${(cost.value / 1e6).toFixed(1)} ms CPU`
  if (cost.unit === 'bytes') return `${(cost.value / 1024).toFixed(1)} KiB allocated`
  return `${cost.value} ${cost.unit} (${cost.metric})`
}

/**
 * What the running program did, for the AI chats: OpenTelemetry spans started in the active
 * file, the last profile's CPU/allocation hot lines in it, and the live service's recent logs
 * (errors first). Empty when adOmnia observed nothing.
 */
export function runtimeChatContext({ root, file, lens, costs, logs }: RuntimeChatInput): string {
  const parts: string[] = []
  const spans = runtimeByNode(lens, root, lens.map((stat, index) => ({ id: String(index), kind: 'function', label: stat.name, file, line: stat.line })))
  const traced = lens
    .map((stat, index) => ({ stat, runtime: spans.get(String(index)) }))
    .filter((item) => item.runtime)
    .sort((left, right) => right.stat.count - left.stat.count)
    .slice(0, MAX_ROWS)
  if (traced.length) parts.push(`Runtime traces (OpenTelemetry spans received by adOmnia) started in ${file}:\n${traced.map(({ stat }) => `- line ${stat.line} ${stat.name}: ${runtimeText({ count: stat.count, errors: stat.errors, p95Ms: stat.p95Ms })}, p50 ${stat.p50Ms.toFixed(1)} ms`).join('\n')}`)
  const hot = costs.filter((cost) => cost.file === file).sort((left, right) => right.value - left.value).slice(0, MAX_ROWS)
  if (hot.length) parts.push(`Profiler (${hot[0].profile}, sampled totals, not per call) hot lines in ${file}:\n${hot.map((cost) => `- line ${cost.line}${cost.function ? ` ${cost.function}` : ''}: ${formatCost(cost)}`).join('\n')}`)
  const recent = logs.slice(-200)
  const errors = recent.filter((entry) => entry.level === 'error' || entry.stream === 'stderr' && ERROR_LINE.test(entry.text) || ERROR_LINE.test(entry.text))
  const chosen = [...errors.slice(-MAX_LOG_LINES), ...recent.filter((entry) => !errors.includes(entry)).slice(-Math.max(0, MAX_LOG_LINES - errors.length))]
    .sort((left, right) => left.seq - right.seq)
  if (chosen.length) parts.push(`Recent logs of the running service (errors kept first):\n${chosen.map((entry) => `- ${entry.text.slice(0, 300)}`).join('\n')}`)
  return parts.join('\n\n')
}

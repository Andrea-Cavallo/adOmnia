/** Pure helpers that turn WebSocket frames into what the stream and the inspector show. */
import type { WsFrame } from '@/stores/websocketConnections'

export function fmtTime(ts: number) {
  const date = new Date(ts)
  const ms = String(date.getMilliseconds()).padStart(3, '0').slice(0, 2)
  return `${date.toLocaleTimeString('en-GB', { hour12: false })}.${ms}`
}

export const fmtDate = (ts: number) => new Date(ts).toISOString().slice(0, 10)

export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function compactPayload(text: string) {
  const parsed = tryParseJson(text)
  if (parsed === null) return text.replace(/\s+/g, ' ').trim()
  return JSON.stringify(parsed)
}

/** The event name a JSON frame carries (`type`, `event` or `topic`), else the frame type. */
export function topicOf(frame: Pick<WsFrame, 'content' | 'type' | 'direction'>) {
  const parsed = tryParseJson(frame.content)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const data = parsed as Record<string, unknown>
    const name = data.type ?? data.event ?? data.topic
    if (typeof name === 'string' || typeof name === 'number') return String(name)
  }
  return frame.direction === 'system' && frame.type === 'message' ? 'system' : frame.type
}

export const byteSize = (text: string) => new Blob([text]).size

export type StreamFilter = 'all' | 'inbound' | 'outbound' | 'system' | 'error'
export const STREAM_FILTERS: ReadonlyArray<{ id: StreamFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'inbound', label: 'In' },
  { id: 'outbound', label: 'Out' },
  { id: 'system', label: 'Sys' },
  { id: 'error', label: 'Error' },
]

export function frameMatches(frame: WsFrame, filter: StreamFilter, query: string) {
  if (filter === 'error' && frame.type !== 'error') return false
  if (filter !== 'all' && filter !== 'error' && frame.direction !== filter) return false
  const needle = query.trim().toLowerCase()
  return !needle || frame.content.toLowerCase().includes(needle) || topicOf(frame).toLowerCase().includes(needle)
}

/** One JSON object per line, the format the old panel exported. */
export const framesToJsonl = (frames: WsFrame[]) => frames
  .map((frame) => JSON.stringify({ type: frame.type, direction: frame.direction, content: frame.content, timestamp: frame.timestamp, binary: frame.binary, client: frame.client }))
  .join('\n')

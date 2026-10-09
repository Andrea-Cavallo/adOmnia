import { CORRELATION_HEADER, liveTools, type LiveMessage } from '@/lib/devsession-api'
import { getServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'

/** Why a captured message cannot be replayed as is, or null: the capture keeps only a 500-char text preview. */
export function replayBlocker(message: Pick<LiveMessage, 'preview'>): string | null {
  if (/^\(\d+ bytes, binary\)$/.test(message.preview ?? '')) return 'Binary payload: open it in Broker Studio to replay the original bytes.'
  if ((message.preview ?? '').endsWith('…')) return 'Payload truncated in the capture: open it in Broker Studio to replay the full message.'
  return null
}

/** Headers to resend: everything but the ids of the original request, so the replay is not attributed to it. */
export function replayHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const skip = new Set([CORRELATION_HEADER.toLowerCase(), 'traceparent', 'tracestate'])
  return Object.fromEntries(Object.entries(headers ?? {}).filter(([key]) => !skip.has(key.toLowerCase())))
}

/** Produces the same key, value and headers to the same topic, on the brokers the session watches. */
export async function replayMessage(message: LiveMessage): Promise<string> {
  const blocker = replayBlocker(message)
  if (blocker) throw new Error(blocker)
  const brokers = (await liveTools(message.sessionId)).kafka?.brokers ?? []
  if (!brokers.length) throw new Error('The service is not watching Kafka any more: watch its topics again to replay.')
  const url = serverUrl(await getServerPort(), '/kafka/produce')
  if (!url) throw new Error('adOmnia backend not ready.')
  const response = await sidecarFetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: { brokers, topic: message.topic }, key: message.key ?? '', value: message.preview ?? '', headers: replayHeaders(message.headers) }),
  })
  const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; partition?: number; offset?: number }
  if (!response.ok || !data.ok) throw new Error(data.error || `Replay failed (${response.status})`)
  return `Replayed to ${message.topic} · partition ${data.partition ?? '-'} · offset ${data.offset ?? '-'}`
}

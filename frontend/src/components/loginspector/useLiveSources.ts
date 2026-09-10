import { useCallback, useEffect, useRef, useState } from 'react'
import {
  closeLiveSource,
  liveTools,
  pollLiveSource,
  resumeLiveSource,
  startLiveSource,
  stopLiveSource,
  type LiveSourceConfig,
} from '@/lib/logstream-api'
import { useServerPort } from '@/lib/useServerPort'

/** Batches arrive on this cadence; the backend buffers between polls. */
const POLL_INTERVAL_MS = 1500

export interface LiveSource {
  id: string
  label: string
  config: LiveSourceConfig
  running: boolean
  received: number
  /** Lines the backend evicted before this session read them. */
  dropped: number
  error: string
}

export interface LiveSourcesApi {
  sources: LiveSource[]
  tools: Record<string, boolean>
  start: (config: LiveSourceConfig) => Promise<string>
  stop: (id: string) => Promise<void>
  resume: (id: string) => Promise<void>
  close: (id: string) => Promise<void>
}

/**
 * Owns the live sources of one Log Inspector session: starts them in the
 * backend, polls each for new lines and hands them to the session, and makes
 * sure closing the panel stops the processes behind them.
 */
export function useLiveSources(onLines: (sourceId: string, label: string, lines: string[]) => void): LiveSourcesApi {
  const port = useServerPort()
  const [sources, setSources] = useState<LiveSource[]>([])
  const [tools, setTools] = useState<Record<string, boolean>>({})
  const cursors = useRef<Record<string, number>>({})
  const onLinesRef = useRef(onLines)
  onLinesRef.current = onLines
  const sourcesRef = useRef<LiveSource[]>([])
  sourcesRef.current = sources

  useEffect(() => {
    if (!port) return
    void liveTools(port).then(setTools)
  }, [port])

  useEffect(() => {
    if (!port || sources.length === 0) return
    let cancelled = false
    const tick = async () => {
      for (const source of sourcesRef.current) {
        const cursor = cursors.current[source.id] ?? -1
        const poll = await pollLiveSource(port, source.id, cursor)
        if (cancelled) return
        cursors.current[source.id] = poll.cursor
        if (poll.lines.length) onLinesRef.current(source.id, source.label, poll.lines)
        setSources((current) => current.map((item) => item.id === source.id ? {
          ...item,
          running: poll.running,
          error: poll.error,
          dropped: poll.dropped,
          received: item.received + poll.lines.length,
        } : item))
      }
    }
    const timer = window.setInterval(() => { void tick() }, POLL_INTERVAL_MS)
    void tick()
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [port, sources.length])

  // Closing the panel must not leave a kubectl or docker follow running.
  useEffect(() => () => {
    for (const source of sourcesRef.current) void closeLiveSource(port, source.id)
  }, [port])

  const start = useCallback(async (config: LiveSourceConfig): Promise<string> => {
    const result = await startLiveSource(port, config)
    if (result.error || !result.id) return result.error || 'Could not start this live source.'
    cursors.current[result.id] = -1
    setSources((current) => [...current, {
      id: result.id, label: result.label || config.path || config.pod || config.container || 'live',
      config, running: true, received: 0, dropped: 0, error: '',
    }])
    return ''
  }, [port])

  const stop = useCallback(async (id: string) => {
    await stopLiveSource(port, id)
    setSources((current) => current.map((item) => item.id === id ? { ...item, running: false } : item))
  }, [port])

  const resume = useCallback(async (id: string) => {
    const error = await resumeLiveSource(port, id)
    setSources((current) => current.map((item) => item.id === id ? { ...item, running: !error, error } : item))
  }, [port])

  const close = useCallback(async (id: string) => {
    await closeLiveSource(port, id)
    delete cursors.current[id]
    setSources((current) => current.filter((item) => item.id !== id))
  }, [port])

  return { sources, tools, start, stop, resume, close }
}

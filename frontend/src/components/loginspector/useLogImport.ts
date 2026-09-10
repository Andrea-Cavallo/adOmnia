import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMPTY_DISCOVERY,
  OperationGate,
  discoverFields,
  fromText,
  loadFromFile,
  parseLogSourcesInBackground,
  rememberSchema,
  type FieldDiscovery,
  type ImportOperation,
  type LogEvent,
  type LogSourceResult,
  type LogFormat,
  type ParsedSourceSummary,
  type ParseSummary,
  type StoredSchema,
} from '@/lib/loginspector'

export interface ImportProgress {
  done: number
  total: number
}

export interface LogSessionSource {
  id: string
  name: string
  displayName: string
  kind: LogSourceResult['kind']
  bytes: number
  text: string
  enabled: boolean
  eventCount: number
  errorCount: number
  warningCount: number
  format: LogFormat
  firstTs: number | null
  lastTs: number | null
}

export interface LogImport {
  source: LogSourceResult | null
  sources: LogSessionSource[]
  events: LogEvent[]
  summary: ParseSummary | null
  discovery: FieldDiscovery
  schema: StoredSchema | null
  progress: ImportProgress | null
  error: string
  setError: (message: string) => void
  ingest: (result: LogSourceResult, operation?: ImportOperation) => Promise<void>
  openFiles: (files: File[]) => Promise<void>
  renameSource: (id: string, name: string) => void
  toggleSource: (id: string) => void
  removeSource: (id: string) => void
  replaceSource: (id: string, file: File) => Promise<void>
  restoreSources: (sources: LogSessionSource[]) => Promise<void>
  pasteAndAnalyze: () => Promise<void>
  appendLiveLines: (sourceId: string, displayName: string, lines: string[]) => void
  clearImport: () => void
  requestAbort: () => void
}

/**
 * A live source keeps only its most recent lines in the renderer: tailing is a
 * window on a running system, and the whole session is re-parsed on every
 * batch.
 * ponytail: full re-parse per batch, incremental append if a live session ever
 * needs to stay open on hundreds of thousands of lines.
 */
const LIVE_SOURCE_MAX_LINES = 20_000

interface Options {
  maxEvents: number
  /** When false the list is not updated while parsing, only at the end. */
  streamPreview: boolean
  /** Called whenever a new import starts, to drop selection-derived state. */
  onReset: () => void
}

/**
 * Owns everything about getting a log into memory: the sources, the background
 * parse, progress and cancellation, the discovered field schema, and the error
 * that came out of it. The panel keeps only what it renders.
 */
export function useLogImport({ maxEvents, streamPreview, onReset }: Options): LogImport {
  const [source, setSource] = useState<LogSourceResult | null>(null)
  const [sources, setSources] = useState<LogSessionSource[]>([])
  const [events, setEvents] = useState<LogEvent[]>([])
  const [summary, setSummary] = useState<ParseSummary | null>(null)
  const [discovery, setDiscovery] = useState<FieldDiscovery>(EMPTY_DISCOVERY)
  const [schema, setSchema] = useState<StoredSchema | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState('')

  const gateRef = useRef(new OperationGate())
  const sourcesRef = useRef<LogSessionSource[]>([])
  const sequenceRef = useRef(0)
  const streamRef = useRef(streamPreview)
  const resetRef = useRef(onReset)
  streamRef.current = streamPreview
  resetRef.current = onReset

  const commitSources = useCallback((next: LogSessionSource[]) => {
    sourcesRef.current = next
    setSources(next)
    if (!next.length) {
      setSource(null)
      return
    }
    const enabled = next.filter((item) => item.enabled)
    setSource({
      text: enabled.length ? 'managed log session' : 'all sources disabled',
      name: `${enabled.length}/${next.length} sources · ${next.map((item) => item.displayName).join(', ')}`,
      kind: next.every((item) => item.kind === 'file') ? 'file' : next[0].kind,
      bytes: enabled.reduce((sum, item) => sum + item.bytes, 0),
    })
  }, [])

  useEffect(() => () => gateRef.current.cancel(), [])

  const parseSources = useCallback(async (
    sessionSources: LogSessionSource[],
    existingOperation?: ImportOperation,
    resetSelection = true,
  ) => {
    const gate = gateRef.current
    const operation = existingOperation ?? gate.start()
    if (!gate.isActive(operation)) return

    const activeSources: LogSourceResult[] = sessionSources
      .filter((item) => item.enabled && item.text.trim())
      .map((item) => ({
        text: item.text,
        name: item.name,
        displayName: item.displayName,
        kind: item.kind,
        bytes: item.bytes,
        sourceId: item.id,
      }))

    setError('')
    setEvents([])
    setSummary(null)
    setDiscovery(EMPTY_DISCOVERY)
    setSchema(null)
    setProgress({ done: 0, total: 0 })
    if (resetSelection) resetRef.current()

    if (!activeSources.length) {
      setSummary(null)
      setProgress(null)
      gate.finish(operation)
      return
    }

    try {
      const parsed = await parseLogSourcesInBackground(
        activeSources,
        { maxEvents },
        {
          onProgress: (done, total, partial) => {
            if (!gate.isActive(operation)) return
            setProgress({ done, total })
            const now = performance.now()
            if (streamRef.current && (done === total || now - operation.lastPreviewAt >= 100)) {
              operation.lastPreviewAt = now
              setEvents(partial.slice())
            }
          },
          shouldAbort: () => gate.shouldAbort(operation),
        },
      )
      if (!gate.isCurrent(operation)) return
      setEvents(parsed.events.slice())
      setSummary(parsed.summary)
      const metadata = new Map(parsed.sources.map((item: ParsedSourceSummary) => [item.sourceId, item]))
      const withMetadata = sourcesRef.current.map((item) => {
        const found = metadata.get(item.id)
        return found ? {
          ...item,
          eventCount: found.eventCount,
          errorCount: found.errorCount,
          warningCount: found.warningCount,
          format: found.format,
          firstTs: found.firstTs,
          lastTs: found.lastTs,
        } : item
      })
      commitSources(withMetadata)
      // Learn the shape of this log so its own keys become searchable.
      const found = discoverFields(parsed.events)
      setDiscovery(found)
      setSchema(rememberSchema(found, withMetadata.map((item) => item.displayName).join(', ')))
      if (parsed.aborted) setError('Import cancelled — showing the events parsed so far.')
    } catch (cause) {
      if (!gate.isCurrent(operation)) return
      // A multi-hundred-MB paste can exhaust the renderer heap; say so instead
      // of leaving a blank screen.
      const message = cause instanceof RangeError || (cause instanceof Error && /memory|allocation/i.test(cause.message))
        ? 'Out of memory while parsing. Lower the event limit or split the file.'
        : cause instanceof Error ? cause.message : 'Import failed'
      setError(message)
      setEvents([])
    } finally {
      if (gate.isCurrent(operation)) {
        setProgress(null)
        gate.finish(operation)
      }
    }
  }, [commitSources, maxEvents])

  const managedSource = useCallback((result: LogSourceResult): LogSessionSource => ({
    id: result.sourceId || `source-${Date.now().toString(36)}-${sequenceRef.current++}`,
    name: result.name,
    displayName: result.displayName?.trim() || result.name,
    kind: result.kind,
    bytes: result.bytes,
    text: result.text,
    enabled: true,
    eventCount: 0,
    errorCount: 0,
    warningCount: 0,
    format: 'empty',
    firstTs: null,
    lastTs: null,
  }), [])

  const ingest = useCallback(
    (result: LogSourceResult, existingOperation?: ImportOperation) => {
      const next = [managedSource(result)]
      commitSources(next)
      return parseSources(next, existingOperation, true)
    },
    [commitSources, managedSource, parseSources],
  )

  const pasteAndAnalyze = useCallback(async () => {
    const gate = gateRef.current
    const operation = gate.start()
    try {
      const text = await navigator.clipboard.readText()
      if (!gate.isActive(operation)) return
      if (!text.trim()) {
        setError('The clipboard is empty.')
        gate.finish(operation)
        return
      }
      await ingest(fromText(text, 'Clipboard', 'paste'), operation)
    } catch {
      if (gate.isActive(operation)) {
        setError('Clipboard access was denied. Paste into the editor box instead.')
        gate.finish(operation)
      }
    }
  }, [ingest])

  const openFiles = useCallback(async (files: File[]) => {
    const gate = gateRef.current
    const operation = gate.start()
    try {
      const results: LogSourceResult[] = []
      for (const file of files) {
        if (!gate.isActive(operation)) return
        results.push(await loadFromFile(file))
      }
      if (gate.isActive(operation)) {
        const appended = results.map(managedSource)
        const next = [...sourcesRef.current, ...appended]
        commitSources(next)
        await parseSources(next, operation, sourcesRef.current.length === appended.length)
      }
    } catch (cause) {
      if (gate.isActive(operation)) {
        setError(cause instanceof Error ? cause.message : 'Could not read that file')
        gate.finish(operation)
      }
    }
  }, [commitSources, managedSource, parseSources])

  const updateAndParse = useCallback((update: (current: LogSessionSource[]) => LogSessionSource[], resetSelection: boolean) => {
    const operation = gateRef.current.start()
    const next = update(sourcesRef.current)
    commitSources(next)
    void parseSources(next, operation, resetSelection)
  }, [commitSources, parseSources])

  const renameSource = useCallback((id: string, name: string) => {
    const displayName = name.trim()
    if (!displayName) return
    updateAndParse((current) => current.map((item) => item.id === id ? { ...item, displayName } : item), false)
  }, [updateAndParse])

  const toggleSource = useCallback((id: string) => {
    updateAndParse((current) => current.map((item) => item.id === id ? { ...item, enabled: !item.enabled } : item), true)
  }, [updateAndParse])

  const removeSource = useCallback((id: string) => {
    updateAndParse((current) => current.filter((item) => item.id !== id), true)
  }, [updateAndParse])

  const replaceSource = useCallback(async (id: string, file: File) => {
    const gate = gateRef.current
    const operation = gate.start()
    try {
      const loaded = await loadFromFile(file)
      if (!gate.isActive(operation)) return
      const previous = sourcesRef.current.find((item) => item.id === id)
      const next = sourcesRef.current.map((item) => item.id === id ? {
        ...item,
        name: loaded.name,
        displayName: previous?.displayName === previous?.name ? loaded.name : item.displayName,
        kind: loaded.kind,
        bytes: loaded.bytes,
        text: loaded.text,
        eventCount: 0,
        errorCount: 0,
        warningCount: 0,
        format: 'empty' as const,
        firstTs: null,
        lastTs: null,
      } : item)
      commitSources(next)
      await parseSources(next, operation, true)
    } catch (cause) {
      if (gate.isActive(operation)) {
        setError(cause instanceof Error ? cause.message : 'Could not reload that file')
        gate.finish(operation)
      }
    }
  }, [commitSources, parseSources])

  const appendLiveLines = useCallback((sourceId: string, displayName: string, lines: string[]) => {
    if (!lines.length) return
    const chunk = lines.join('\n')
    const existing = sourcesRef.current.find((item) => item.id === sourceId)
    const next = existing
      ? sourcesRef.current.map((item) => {
          if (item.id !== sourceId) return item
          const combined = item.text ? `${item.text}\n${chunk}` : chunk
          const kept = combined.split('\n')
          const text = kept.length > LIVE_SOURCE_MAX_LINES ? kept.slice(kept.length - LIVE_SOURCE_MAX_LINES).join('\n') : combined
          return { ...item, text, bytes: text.length }
        })
      : [...sourcesRef.current, managedSource({
          text: chunk, name: displayName, displayName, kind: 'live', bytes: chunk.length, sourceId,
        })]
    commitSources(next)
    void parseSources(next, undefined, false)
  }, [commitSources, managedSource, parseSources])

  const restoreSources = useCallback(async (restored: LogSessionSource[]) => {
    const operation = gateRef.current.start()
    const usable = restored.filter((item) => item.text.trim())
    commitSources(usable)
    await parseSources(usable, operation, false)
  }, [commitSources, parseSources])

  const clearImport = useCallback(() => {
    gateRef.current.cancel()
    setSource(null)
    commitSources([])
    setEvents([])
    setSummary(null)
    setDiscovery(EMPTY_DISCOVERY)
    setSchema(null)
    setError('')
    setProgress(null)
    resetRef.current()
  }, [commitSources])

  const requestAbort = useCallback(() => gateRef.current.requestAbort(), [])

  return {
    source, sources, events, summary, discovery, schema, progress, error,
    setError, ingest, openFiles, renameSource, toggleSource, removeSource, replaceSource, restoreSources,
    pasteAndAnalyze, appendLiveLines, clearImport, requestAbort,
  }
}

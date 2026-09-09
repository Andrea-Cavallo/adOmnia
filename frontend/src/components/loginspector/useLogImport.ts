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
  type ParseSummary,
  type StoredSchema,
} from '@/lib/loginspector'

export interface ImportProgress {
  done: number
  total: number
}

export interface LogImport {
  source: LogSourceResult | null
  events: LogEvent[]
  summary: ParseSummary | null
  discovery: FieldDiscovery
  schema: StoredSchema | null
  progress: ImportProgress | null
  error: string
  setError: (message: string) => void
  ingest: (result: LogSourceResult, operation?: ImportOperation) => Promise<void>
  openFiles: (files: File[]) => Promise<void>
  pasteAndAnalyze: () => Promise<void>
  clearImport: () => void
  requestAbort: () => void
}

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
  const [events, setEvents] = useState<LogEvent[]>([])
  const [summary, setSummary] = useState<ParseSummary | null>(null)
  const [discovery, setDiscovery] = useState<FieldDiscovery>(EMPTY_DISCOVERY)
  const [schema, setSchema] = useState<StoredSchema | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState('')

  const gateRef = useRef(new OperationGate())
  const streamRef = useRef(streamPreview)
  const resetRef = useRef(onReset)
  streamRef.current = streamPreview
  resetRef.current = onReset

  useEffect(() => () => gateRef.current.cancel(), [])

  const ingestSources = useCallback(async (inputSources: LogSourceResult[], existingOperation?: ImportOperation) => {
    const gate = gateRef.current
    const operation = existingOperation ?? gate.start()
    if (!gate.isActive(operation)) return

    const sources = inputSources.filter((item) => item.text.trim())
    if (!sources.length) {
      setError('That input is empty.')
      gate.finish(operation)
      return
    }

    const sourceResult: LogSourceResult = sources.length === 1 ? sources[0] : {
      text: 'multiple log files',
      name: `${sources.length} files · ${sources.map((item) => item.name).join(', ')}`,
      kind: 'file',
      bytes: sources.reduce((sum, item) => sum + item.bytes, 0),
    }

    setError('')
    setSource(sourceResult)
    setEvents([])
    setSummary(null)
    setDiscovery(EMPTY_DISCOVERY)
    setSchema(null)
    setProgress({ done: 0, total: 0 })
    resetRef.current()

    try {
      const parsed = await parseLogSourcesInBackground(
        sources,
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
      // Learn the shape of this log so its own keys become searchable.
      const found = discoverFields(parsed.events)
      setDiscovery(found)
      setSchema(rememberSchema(found, sourceResult.name))
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
  }, [maxEvents])

  const ingest = useCallback(
    (result: LogSourceResult, existingOperation?: ImportOperation) => ingestSources([result], existingOperation),
    [ingestSources],
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
      if (gate.isActive(operation)) await ingestSources(results, operation)
    } catch (cause) {
      if (gate.isActive(operation)) {
        setError(cause instanceof Error ? cause.message : 'Could not read that file')
        gate.finish(operation)
      }
    }
  }, [ingestSources])

  const clearImport = useCallback(() => {
    gateRef.current.cancel()
    setSource(null)
    setEvents([])
    setSummary(null)
    setDiscovery(EMPTY_DISCOVERY)
    setSchema(null)
    setError('')
    setProgress(null)
    resetRef.current()
  }, [])

  const requestAbort = useCallback(() => gateRef.current.requestAbort(), [])

  return {
    source, events, summary, discovery, schema, progress, error,
    setError, ingest, openFiles, pasteAndAnalyze, clearImport, requestAbort,
  }
}

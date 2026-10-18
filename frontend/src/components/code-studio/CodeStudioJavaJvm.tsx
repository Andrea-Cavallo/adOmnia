import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Circle, Loader2, RefreshCw, Square } from 'lucide-react'
import { CodeStudioModal } from './CodeStudioModal'
import { getJavaJvmSample, getJavaJvms, startJavaJfr, stopJavaJfr } from '@/lib/code-studio-api'
import { formatKb, gcOverheadPercent, pushSample, sparkline } from '@/lib/code-studio/jvmMonitor'
import type { JVMHeapSample, JVMProcess } from '../../../bindings/adomnia/internal/languages/java/models'
import type { JavaJFRRecording } from '../../../bindings/adomnia/internal/codestudio/models'

const POLL_MILLIS = 2000
const CHART = { width: 520, height: 90 }

let openRequest: ((sessionId: string) => void) | null = null

/** Apre il monitor delle JVM locali (heap, GC, registrazione JFR). */
export function openJavaJvmMonitor(sessionId: string): void {
  openRequest?.(sessionId)
}

function shortClass(jvm: JVMProcess): string {
  const name = jvm.mainClass.replace(/\\/g, '/')
  return name.endsWith('.jar') ? name.slice(name.lastIndexOf('/') + 1) : name.slice(name.lastIndexOf('.') + 1)
}

function reasonOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * Heap e GC di una JVM in esecuzione, letti con jstat ogni due secondi solo mentre il dialog è aperto, più la
 * registrazione JFR su richiesta: nessun agente, nessun processo a riposo.
 */
export function CodeStudioJavaJvm() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [jvms, setJvms] = useState<JVMProcess[] | null>(null)
  const [selected, setSelected] = useState<JVMProcess | null>(null)
  const [history, setHistory] = useState<JVMHeapSample[]>([])
  const [recording, setRecording] = useState<{ recording: JavaJFRRecording; active: boolean } | null>(null)
  const [error, setError] = useState('')
  const pollRef = useRef<number | null>(null)

  const refresh = useCallback((id: string) => {
    setError('')
    getJavaJvms(id).then(setJvms).catch((reason: unknown) => setError(reasonOf(reason)))
  }, [])

  useEffect(() => {
    openRequest = (id) => {
      setSessionId(id)
      setJvms(null)
      setSelected(null)
      setHistory([])
      setRecording(null)
      refresh(id)
    }
    return () => { openRequest = null }
  }, [refresh])

  useEffect(() => {
    if (!sessionId || !selected) return
    const sample = () => getJavaJvmSample(sessionId, selected.pid)
      .then((next) => { setHistory((current) => pushSample(current, next)); setError('') })
      .catch((reason: unknown) => setError(reasonOf(reason)))
    void sample()
    pollRef.current = window.setInterval(() => void sample(), POLL_MILLIS)
    return () => { if (pollRef.current !== null) window.clearInterval(pollRef.current) }
  }, [sessionId, selected])

  const latest = history[history.length - 1]
  const ceiling = Math.max(latest?.heapCapacityKb ?? 0, ...history.map((item) => item.heapUsedKb))

  const toggleRecording = async () => {
    if (!sessionId || !selected) return
    try {
      if (recording?.active) {
        await stopJavaJfr(sessionId, selected.pid, recording.recording.name)
        setRecording({ recording: recording.recording, active: false })
      } else {
        setRecording({ recording: await startJavaJfr(sessionId, selected.pid), active: true })
      }
      setError('')
    } catch (reason) {
      setError(reasonOf(reason))
    }
  }

  return (
    <CodeStudioModal
      open={!!sessionId}
      onClose={() => { setSessionId(null); setSelected(null) }}
      title="JVM monitor"
      subtitle={selected ? `${shortClass(selected)} · PID ${selected.pid}` : 'Local JVMs (jcmd and jstat from the project JDK)'}
      icon={Activity}
      size="lg"
      divided
      flush
      top
      actions={sessionId ? <button type="button" className="gs-badge cursor-pointer" onClick={() => refresh(sessionId)}><RefreshCw size={11} /> Refresh</button> : undefined}
    >
      <div className="flex max-h-[70vh] min-h-0 flex-col overflow-auto">
        <div className="gs-list">
          {!jvms && !error && <p className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" /> Looking for JVMs…</p>}
          {jvms?.map((jvm) => (
            <button key={jvm.pid} type="button" onClick={() => { setSelected(jvm); setHistory([]); setRecording(null) }} className={`gs-list-row w-full text-left ${selected?.pid === jvm.pid ? 'bg-surface-2' : ''}`}>
              <span className="w-14 shrink-0 font-mono text-[11px] text-text-3">{jvm.pid}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-text-1">{shortClass(jvm)}</span>
              <span className="hidden min-w-0 max-w-[45%] truncate font-mono text-[10.5px] text-text-4 sm:block">{jvm.args}</span>
            </button>
          ))}
          {jvms && jvms.length === 0 && <p className="px-3 py-3 text-[11px] text-text-3">No JVM is running. Start the application from the Run bar and press Refresh.</p>}
        </div>
        {selected && (
          <div className="border-t border-border-1 px-3 py-3">
            <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} className="h-24 w-full rounded bg-surface-2" preserveAspectRatio="none" role="img" aria-label="Heap usage over time">
              <polyline fill="none" stroke="currentColor" className="text-accent" strokeWidth="1.5" points={sparkline(history.map((item) => item.heapUsedKb), ceiling, CHART.width, CHART.height)} />
              <polyline fill="none" stroke="currentColor" className="text-text-4" strokeDasharray="3 3" strokeWidth="1" points={sparkline(history.map((item) => item.heapCapacityKb), ceiling, CHART.width, CHART.height)} />
            </svg>
            {latest && (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-4">
                <div><dt className="text-text-4">Heap used</dt><dd className="text-text-1">{formatKb(latest.heapUsedKb)} / {formatKb(latest.heapCapacityKb)}</dd></div>
                <div><dt className="text-text-4">Young · Old</dt><dd className="text-text-1">{formatKb(latest.youngUsedKb)} · {formatKb(latest.oldUsedKb)}</dd></div>
                <div><dt className="text-text-4">GC young / full</dt><dd className="text-text-1">{latest.youngGcs} ({latest.youngGcSeconds.toFixed(2)}s) / {latest.fullGcs} ({latest.fullGcSeconds.toFixed(2)}s)</dd></div>
                <div><dt className="text-text-4">GC overhead</dt><dd className="text-text-1">{gcOverheadPercent(latest).toFixed(2)}% of {Math.round(latest.uptimeSeconds)}s uptime</dd></div>
              </dl>
            )}
            <div className="mt-3 flex items-center gap-2">
              <button type="button" className="gs-badge cursor-pointer" onClick={() => void toggleRecording()}>
                {recording?.active ? <><Square size={11} /> Stop JFR recording</> : <><Circle size={11} className="text-danger" /> Start JFR recording</>}
              </button>
              {recording && <span className="min-w-0 truncate font-mono text-[10.5px] text-text-3" title={recording.recording.file}>{recording.active ? 'recording to ' : 'saved: '}{recording.recording.file}</span>}
            </div>
          </div>
        )}
        {error && <p className="whitespace-pre-wrap border-t border-border-1 px-3 py-2 text-[11px] text-danger">{error}</p>}
      </div>
    </CodeStudioModal>
  )
}

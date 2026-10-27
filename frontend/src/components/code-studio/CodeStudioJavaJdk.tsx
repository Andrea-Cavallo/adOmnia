import { useEffect, useState } from 'react'
import { Check, Coffee, Loader2 } from 'lucide-react'
import { CodeStudioModal } from './CodeStudioModal'
import { getJavaJdks, setJavaJdk } from '@/lib/code-studio-api'
import type { JavaJDKReport } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/codestudio/models'

let openRequest: ((sessionId: string) => void) | null = null

/** Apre la scelta del JDK del progetto. */
export function openJavaJdkDialog(sessionId: string): void {
  openRequest?.(sessionId)
}

/**
 * JDK del progetto: Run, Debug e Test usano la stessa toolchain. Si propone il più piccolo JDK installato che
 * soddisfa la versione dichiarata dal build (release/source di Maven, toolchain di Gradle).
 */
export function CodeStudioJavaJdk() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [report, setReport] = useState<JavaJDKReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    openRequest = (id) => {
      setSessionId(id)
      setReport(null)
      setError('')
      getJavaJdks(id).then(setReport).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
    }
    return () => { openRequest = null }
  }, [])

  const choose = async (home: string) => {
    if (!sessionId) return
    setBusy(true)
    try {
      await setJavaJdk(sessionId, home)
      setReport(await getJavaJdks(sessionId))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const rows = report ? [{ home: '', title: 'System default', detail: report.default.available ? `${report.default.version} · ${report.default.source}` : report.default.problem ?? 'No JDK found', major: report.default.major ?? 0 }, ...report.installed.map((jdk) => ({ home: jdk.home ?? '', title: `JDK ${jdk.major || '?'}`, detail: `${jdk.version || 'unknown version'} · ${jdk.home}`, major: jdk.major ?? 0 }))] : []
  const required = report?.required ?? 0

  return (
    <CodeStudioModal
      open={!!sessionId}
      onClose={() => setSessionId(null)}
      title="Project JDK"
      subtitle={required ? `The build declares Java ${required}` : 'The build does not declare a Java version'}
      icon={Coffee}
      size="lg"
      divided
      flush
      top
    >
      <div className="gs-list max-h-[60vh] overflow-auto">
        {!report && !error && <p className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" /> Looking for JDKs…</p>}
        {rows.map((row) => {
          const selected = (report?.selected ?? '') === row.home
          const tooOld = required > 0 && row.major > 0 && row.major < required
          return (
            <button key={row.home || 'system'} type="button" disabled={busy} onClick={() => void choose(row.home)} className="gs-list-row w-full text-left disabled:opacity-60">
              <span className="grid w-4 shrink-0 place-items-center text-success">{selected ? <Check size={13} /> : null}</span>
              <span className="w-28 shrink-0 text-[12px] text-text-1">{row.title}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-3">{row.detail}</span>
              {row.home && row.home === report?.suggested && <span className="gs-badge shrink-0">suggested</span>}
              {tooOld && <span className="gs-badge shrink-0 text-warning" title={`The build needs Java ${required} or newer`}>too old</span>}
            </button>
          )
        })}
        {report && report.installed.length === 0 && <p className="px-3 py-3 text-[11px] text-text-3">No JDK found in the usual folders. Install one (e.g. Eclipse Temurin) or set JAVA_HOME.</p>}
      </div>
      {error && <p className="border-t border-border-1 px-3 py-2 text-[11px] text-danger">{error}</p>}
      <p className="border-t border-border-1 px-3 py-2 text-[10.5px] text-text-4">Saved in .adomnia/java.local.json (not shared via Git). Run, Debug and Test use the same JDK; a configuration can override it with its own JDK home.</p>
    </CodeStudioModal>
  )
}

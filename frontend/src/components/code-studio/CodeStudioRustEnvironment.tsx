import { useCallback, useEffect, useState } from 'react'
import { Eraser, Loader2, Terminal } from 'lucide-react'
import { CodeStudioButton, CodeStudioModal } from './CodeStudioModal'
import { cleanRustAnalyzerCache, getRustEnvironment } from '@/lib/code-studio-api'
import { environmentRows, formatBytes } from '@/lib/code-studio/rustEnvironment'
import type { RustEnvironmentReport } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/codestudio/models'

let openRequest: ((sessionId: string) => void) | null = null

/** Apre la vista dell'ambiente Rust del progetto (RS-2). */
export function openRustEnvironmentDialog(sessionId: string): void {
  openRequest?.(sessionId)
}

/**
 * Ambiente Rust del progetto: le variabili, il `.cargo/config.toml` (alias, env, target runner/linker)
 * e la cartella target che rust-analyzer usa, con la sua dimensione. "Clean analyzer cache" ferma il
 * server e cancella **solo** quella cartella, mai la `target/` dell'utente (RS-2, RS-M9).
 */
export function CodeStudioRustEnvironment() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [report, setReport] = useState<RustEnvironmentReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async (id: string) => {
    setReport(await getRustEnvironment(id))
  }, [])

  useEffect(() => {
    openRequest = (id) => {
      setSessionId(id)
      setReport(null)
      setError('')
      setNotice('')
      load(id).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
    }
    return () => { openRequest = null }
  }, [load])

  const clean = async () => {
    if (!sessionId) return
    if (!window.confirm('Clean the rust-analyzer cache?\n\nadOmnia stops the Rust language server and deletes only the analyzer target folder under the user cache. Your project target/ is never touched; the analyzer re-indexes on the next request.')) return
    setBusy(true)
    try {
      const result = await cleanRustAnalyzerCache(sessionId, true)
      setNotice(`Freed ${formatBytes(result.freedBytes)}. The analyzer restarts on the next request.`)
      setError('')
      await load(sessionId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const rows = report ? environmentRows(report.environment) : []
  return (
    <CodeStudioModal
      open={!!sessionId}
      onClose={() => setSessionId(null)}
      title="Rust environment"
      subtitle="Read from the filesystem and from .cargo/config.toml. Nothing is executed to show this."
      icon={Terminal}
      size="lg"
      divided
      flush
      top
    >
      <div className="max-h-[60vh] overflow-auto">
        {!report && !error && <p className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" /> Reading the Rust environment…</p>}
        {report && (
          <>
            <div className="gs-list mx-3 mt-2">
              {rows.map((row) => (
                <div key={`${row.source}:${row.key}`} className="gs-list-row">
                  <span className="w-44 shrink-0 truncate font-mono text-[11px] text-text-2" title={row.key}>{row.key}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-3" title={row.value || '—'}>{row.value || '—'}</span>
                  <span className="gs-badge shrink-0">{row.source}</span>
                </div>
              ))}
            </div>
            <div className="mx-3 mt-3 border-t border-border-1 pt-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-[12px] text-text-2">rust-analyzer cache</span>
                {report.analyzerCacheManaged ? (
                  <span className="shrink-0 text-[11px] text-text-3">{formatBytes(report.analyzerCacheBytes)}</span>
                ) : (
                  <span className="shrink-0 text-[11px] text-text-4">not managed (CARGO_TARGET_DIR is set)</span>
                )}
                <CodeStudioButton small variant="ghost" disabled={busy || !report.analyzerCacheManaged} onClick={() => void clean()}>
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Eraser size={12} />} Clean analyzer cache…
                </CodeStudioButton>
              </div>
              {report.analyzerTargetDir && <p className="mt-1 break-all font-mono text-[10.5px] text-text-4">{report.analyzerTargetDir}</p>}
              <p className="mt-1 text-[10.5px] text-text-4">
                Low resources: {report.lowResources ? 'on (proc-macro and build scripts off)' : 'off'}. {report.analyzerCacheManaged ? 'Only this folder is deleted; your target/ and cargo registry are never touched.' : 'adOmnia cleans only its own cache folder, never a folder you chose.'}
              </p>
            </div>
          </>
        )}
        {notice && <p className="border-t border-border-1 px-3 py-2 text-[11px] text-success">{notice}</p>}
        {error && <p className="border-t border-border-1 px-3 py-2 text-[11px] text-danger">{error}</p>}
      </div>
    </CodeStudioModal>
  )
}

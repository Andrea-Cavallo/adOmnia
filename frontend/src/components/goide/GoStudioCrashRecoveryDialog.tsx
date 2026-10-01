import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileClock, LifeBuoy } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import { acknowledgeGoIDECrash, getGoIDECrashStatus, type GoIDECrashStatus } from '@/lib/goide-api'
import { useGoIDEStore, type GoIDEState } from '@/stores/goide'
import { RECOVERY_STATUS_LABEL, recoverySummary, type GoStudioRecoveryStatus } from './goStudioCrashRecovery'

const EMPTY: GoIDEState['recoveredBySession'][string] = []

const STATUS_CLASS: Record<GoStudioRecoveryStatus, string> = {
  safe: 'bg-success/15 text-success',
  'already-applied': 'bg-surface-3 text-text-3',
  conflict: 'bg-warning/15 text-warning',
  missing: 'bg-danger/15 text-danger',
}

/**
 * Dopo un crash (heartbeat del runtime lock fermo) propone i buffer non salvati: Restore All, Review o Discard.
 * Niente viene scritto sul disco: il testo recuperato torna nell'editor come modifica non salvata.
 */
export function GoStudioCrashRecoveryDialog({ sessionId }: { sessionId: string }) {
  const [crash, setCrash] = useState<GoIDECrashStatus | null>(null)
  const [review, setReview] = useState<Set<string>>(new Set())
  const dialogRef = useRef<HTMLDivElement>(null)
  const recovered = useGoIDEStore((state) => state.recoveredBySession[sessionId] ?? EMPTY)
  const recoverBuffer = useGoIDEStore((state) => state.recoverBuffer)
  const discardRecoveredBuffer = useGoIDEStore((state) => state.discardRecoveredBuffer)
  const open = !!crash?.previousCrashed && recovered.length > 0

  useEffect(() => {
    void getGoIDECrashStatus().then(setCrash).catch(() => setCrash(null))
  }, [])

  const close = () => {
    setCrash(null)
    void acknowledgeGoIDECrash().catch(() => undefined)
  }
  useModalFocusTrap(open, close, dialogRef)

  // Crash senza nulla da recuperare: basta chiudere la proposta, il banner non serve.
  useEffect(() => {
    if (crash?.previousCrashed && recovered.length === 0) void acknowledgeGoIDECrash().catch(() => undefined)
  }, [crash, recovered.length])

  const rows = useMemo(() => recovered.map((buffer) => ({
    buffer,
    status: (buffer.status || (buffer.missing ? 'missing' : buffer.diskChanged ? 'conflict' : 'safe')) as GoStudioRecoveryStatus,
    summary: recoverySummary(buffer.diskContent ?? '', buffer.content),
  })), [recovered])

  if (!open) return null

  const useRecovered = (path: string) => void recoverBuffer(sessionId, path, { confirmConflict: false })
  const keepDisk = (path: string) => void discardRecoveredBuffer(sessionId, path)
  const toggleDiff = (path: string) => setReview((current) => {
    const next = new Set(current)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })
  const restoreAll = async () => {
    for (const row of rows) {
      if (row.status === 'missing' || row.status === 'already-applied') await discardRecoveredBuffer(sessionId, row.buffer.relativePath)
      else await recoverBuffer(sessionId, row.buffer.relativePath, { confirmConflict: false })
    }
    close()
  }
  const discardAll = async () => {
    for (const row of rows) await discardRecoveredBuffer(sessionId, row.buffer.relativePath)
    close()
  }
  const conflicts = rows.filter((row) => row.status === 'conflict').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center ad-modal-backdrop">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="go-crash-title" tabIndex={-1} className="flex max-h-[84vh] w-[720px] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl">
        <div className="flex shrink-0 items-start gap-3 border-b border-border-1 px-5 py-4">
          <LifeBuoy size={18} className="mt-0.5 text-accent" />
          <div className="min-w-0">
            <h2 id="go-crash-title" className="text-sm font-semibold text-text-1">adOmnia closed unexpectedly</h2>
            <p className="mt-0.5 text-[11px] leading-4 text-text-3">
              {rows.length} unsaved file{rows.length === 1 ? ' was' : 's were'} recovered{crash?.lastHeartbeat ? ` (last seen ${new Date(crash.lastHeartbeat).toLocaleString()})` : ''}.
              Restored text opens as unsaved changes: nothing is written to disk until you save.
              {conflicts > 0 && ` ${conflicts} file${conflicts === 1 ? '' : 's'} changed on disk after the snapshot.`}
            </p>
          </div>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-border-1 overflow-auto">
          {rows.map(({ buffer, status, summary }) => (
            <li key={buffer.relativePath} className="px-5 py-2">
              <div className="flex items-center gap-2 text-[11px]">
                <FileClock size={12} className="shrink-0 text-text-4" />
                <span className="min-w-0 flex-1 truncate font-mono text-text-1" title={buffer.relativePath}>{buffer.relativePath}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px] ${STATUS_CLASS[status]}`}>
                  {status === 'conflict' && <AlertTriangle size={9} className="mr-0.5 inline" />}{RECOVERY_STATUS_LABEL[status]}
                </span>
                {status !== 'missing' && <span className="shrink-0 font-mono text-[10px]"><span className="text-success">+{summary.added}</span> <span className="text-danger">−{summary.removed}</span></span>}
                <span className="shrink-0 text-[10px] text-text-4">{new Date(buffer.savedAt).toLocaleTimeString()}</span>
              </div>
              <div className="mt-1 flex gap-1.5 pl-5">
                <button type="button" disabled={status === 'missing'} onClick={() => useRecovered(buffer.relativePath)} className="rounded border border-border-1 px-2 py-0.5 text-[10px] text-text-1 hover:border-accent disabled:opacity-35">Use Recovered</button>
                <button type="button" onClick={() => keepDisk(buffer.relativePath)} className="rounded border border-border-1 px-2 py-0.5 text-[10px] text-text-2 hover:border-accent">Keep Disk</button>
                {status !== 'missing' && <button type="button" aria-expanded={review.has(buffer.relativePath)} onClick={() => toggleDiff(buffer.relativePath)} className="rounded px-2 py-0.5 text-[10px] text-accent hover:bg-accent/10">{review.has(buffer.relativePath) ? 'Hide Diff' : 'Open Diff'}</button>}
              </div>
              {review.has(buffer.relativePath) && (
                <div className="mt-1.5 ml-5 max-h-56 overflow-auto rounded border border-border-1 bg-surface-0 font-mono text-[10.5px] leading-4">
                  <div className="sticky top-0 flex justify-between border-b border-border-1 bg-surface-1 px-2 py-0.5 text-[9.5px] text-text-4"><span>− Disk Version</span><span>+ Recovered Version</span></div>
                  {summary.lines.length === 0 && <p className="px-2 py-1 text-text-4">No difference.</p>}
                  {summary.lines.map((line, index) => (
                    <div key={index} className={`${line.hunkStart && index > 0 ? 'mt-1 border-t border-border-1/60' : ''} flex whitespace-pre ${line.kind === 'added' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                      <span className="w-10 shrink-0 select-none pr-1 text-right text-text-4">{line.line}</span>
                      <span>{line.kind === 'added' ? '+' : '−'} {line.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="flex shrink-0 items-center gap-2 border-t border-border-1 bg-surface-0 px-5 py-3">
          <button type="button" onClick={() => void discardAll()} className="h-7 rounded px-3 text-xs text-danger hover:bg-danger/10">Discard</button>
          <button type="button" onClick={() => setReview(new Set(rows.filter((row) => row.status !== 'missing').map((row) => row.buffer.relativePath)))} className="ml-auto h-7 rounded px-3 text-xs text-text-2 hover:bg-surface-2">Review</button>
          <button type="button" onClick={() => void restoreAll()} className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white">Restore All</button>
        </div>
      </div>
    </div>
  )
}

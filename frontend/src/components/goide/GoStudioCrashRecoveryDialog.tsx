import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileClock, LifeBuoy, Play, RotateCcw } from 'lucide-react'
import { acknowledgeGoIDECrash, dismissGoIDEInterruptedProcess, getGoIDECrashStatus, listGoIDEInterruptedProcesses, type GoIDECrashStatus, type GoIDEProcessDescriptor } from '@/lib/goide-api'
import { useGoIDEStore, type GoIDEState } from '@/stores/goide'
import { RECOVERY_STATUS_LABEL, recoverySummary, type GoStudioRecoveryStatus } from './goStudioCrashRecovery'
import { GoStudioButton, GoStudioModal } from './GoStudioModal'

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
  const [processes, setProcesses] = useState<GoIDEProcessDescriptor[]>([])
  const [relaunched, setRelaunched] = useState<string[]>([])
  const trusted = useGoIDEStore((state) => state.sessions.find((item) => item.id === sessionId)?.project.authorization === 'tooling-permitted')
  const recovered = useGoIDEStore((state) => state.recoveredBySession[sessionId] ?? EMPTY)
  const recoverBuffer = useGoIDEStore((state) => state.recoverBuffer)
  const discardRecoveredBuffer = useGoIDEStore((state) => state.discardRecoveredBuffer)
  const open = !!crash?.previousCrashed && (recovered.length > 0 || processes.length > 0 || relaunched.length > 0)

  useEffect(() => {
    void getGoIDECrashStatus().then(setCrash).catch(() => setCrash(null))
    void listGoIDEInterruptedProcesses().then((list) => setProcesses(list.filter((item) => item.sessionId === sessionId))).catch(() => undefined)
  }, [sessionId])

  // Restart policy "always": l'utente l'ha scelta per quella configurazione, si rilancia da sola (se il progetto è fidato).
  useEffect(() => {
    if (!crash?.previousCrashed || !trusted) return
    const automatic = processes.filter((item) => item.restartPolicy === 'always')
    if (automatic.length === 0) return
    for (const item of automatic) relaunch(item)
    setRelaunched((current) => [...current, ...automatic.map((item) => item.configName)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crash, processes, trusted])

  const close = () => {
    setCrash(null)
    void acknowledgeGoIDECrash().catch(() => undefined)
  }

  // Crash senza nulla da recuperare: basta chiudere la proposta, il banner non serve.
  useEffect(() => {
    if (crash?.previousCrashed && recovered.length === 0 && processes.length === 0 && relaunched.length === 0) void acknowledgeGoIDECrash().catch(() => undefined)
  }, [crash, processes.length, recovered.length, relaunched.length])

  function dismiss(item: GoIDEProcessDescriptor) {
    setProcesses((current) => current.filter((other) => other.runId !== item.runId))
    void dismissGoIDEInterruptedProcess(item.runId).catch(() => undefined)
  }

  // Il rilancio passa dal Run normale: Trust, segreti e task before launch restano quelli della configurazione.
  function relaunch(item: GoIDEProcessDescriptor) {
    useGoIDEStore.getState().selectRunConfiguration(item.configId)
    document.dispatchEvent(new CustomEvent('adomnia:go-studio-command', { detail: 'run.run' }))
    dismiss(item)
  }

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

  const reviewAll = () => setReview(new Set(rows.filter((row) => row.status !== 'missing').map((row) => row.buffer.relativePath)))
  return (
    <GoStudioModal
      open={open}
      onClose={close}
      persistent
      size="lg"
      tall
      divided
      flush
      icon={LifeBuoy}
      tone="warning"
      title="adOmnia closed unexpectedly"
      subtitle={<>
        {rows.length > 0 ? `${rows.length} unsaved file${rows.length === 1 ? ' was' : 's were'} recovered` : 'No unsaved file was lost'}{crash?.lastHeartbeat ? ` · last seen ${new Date(crash.lastHeartbeat).toLocaleString()}` : ''}.
        {' '}Restored text opens as unsaved changes: nothing is written to disk until you save.
        {conflicts > 0 && ` ${conflicts} file${conflicts === 1 ? '' : 's'} changed on disk after the snapshot.`}
      </>}
      footerStart={<GoStudioButton variant="danger-ghost" onClick={() => void discardAll()}>Discard all</GoStudioButton>}
      footer={<>
        <GoStudioButton variant="ghost" onClick={reviewAll}>Review all</GoStudioButton>
        <GoStudioButton variant="primary" data-autofocus icon={RotateCcw} onClick={() => void restoreAll()}>Restore all</GoStudioButton>
      </>}
    >
      {(processes.length > 0 || relaunched.length > 0) && (
        <section className="flex shrink-0 flex-col gap-1.5 border-b border-border-1 px-5 py-3">
          <h3 className="gs-section-title">Runs interrupted by the crash</h3>
          {relaunched.map((name) => (
            <p key={name} className="flex items-center gap-2 text-[12.5px] text-success"><RotateCcw size={13} /> {name}: relaunched automatically (restart policy: always)</p>
          ))}
          {processes.map((item) => (
            <div key={item.runId} className="flex min-h-[36px] items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-text-1" title={item.command}>{item.configName} <span className="gs-mono text-[11px] text-text-4">{item.command}</span></span>
              {item.restartPolicy === 'never'
                ? <span className="gs-badge">Not relaunched · restart policy: never</span>
                : <GoStudioButton small variant="secondary" icon={Play} disabled={!trusted} title={trusted ? 'Run this configuration again' : 'Trust the project to run it'} onClick={() => relaunch(item)}>Relaunch</GoStudioButton>}
              <GoStudioButton small variant="ghost" onClick={() => dismiss(item)}>Dismiss</GoStudioButton>
            </div>
          ))}
        </section>
      )}
      <ul className="min-h-0 flex-1 overflow-auto p-2">
        {rows.length === 0 && <li className="gs-list-empty">Nothing to restore.</li>}
        {rows.map(({ buffer, status, summary }) => (
          <li key={buffer.relativePath} className="rounded-lg px-3 py-2.5 hover:bg-surface-2/40">
            <div className="flex items-center gap-2.5">
              <FileClock size={15} className="shrink-0 text-text-4" />
              <span className="gs-mono min-w-0 flex-1 truncate text-text-1" title={buffer.relativePath}>{buffer.relativePath}</span>
              <span className={`gs-badge h-[20px] text-[11px] ${STATUS_CLASS[status]}`}>
                {status === 'conflict' && <AlertTriangle size={11} className="mr-1" />}{RECOVERY_STATUS_LABEL[status]}
              </span>
              {status !== 'missing' && <span className="gs-mono shrink-0 text-[11px]"><span className="text-success">+{summary.added}</span> <span className="text-danger">−{summary.removed}</span></span>}
              <span className="shrink-0 text-[11.5px] text-text-4">{new Date(buffer.savedAt).toLocaleTimeString()}</span>
            </div>
            <div className="mt-2 flex gap-1.5 pl-[25px]">
              <GoStudioButton small variant="secondary" disabled={status === 'missing'} onClick={() => useRecovered(buffer.relativePath)}>Use recovered</GoStudioButton>
              <GoStudioButton small variant="ghost" onClick={() => keepDisk(buffer.relativePath)}>Keep disk</GoStudioButton>
              {status !== 'missing' && <GoStudioButton small variant="ghost" aria-expanded={review.has(buffer.relativePath)} onClick={() => toggleDiff(buffer.relativePath)}>{review.has(buffer.relativePath) ? 'Hide diff' : 'Show diff'}</GoStudioButton>}
            </div>
            {review.has(buffer.relativePath) && (
              <div className="gs-surface gs-mono mt-2 ml-[25px] max-h-56 overflow-auto text-[11.5px] leading-5">
                <div className="sticky top-0 flex justify-between border-b border-border-1 bg-surface-1 px-3 py-1 text-[11px] text-text-4"><span>− Disk version</span><span>+ Recovered version</span></div>
                {summary.lines.length === 0 && <p className="px-3 py-2 text-text-4">No difference.</p>}
                {summary.lines.map((line, index) => (
                  <div key={index} className={`${line.hunkStart && index > 0 ? 'mt-1 border-t border-border-1/60' : ''} flex whitespace-pre ${line.kind === 'added' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                    <span className="w-10 shrink-0 select-none pr-2 text-right text-text-4">{line.line}</span>
                    <span>{line.kind === 'added' ? '+' : '−'} {line.text}</span>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </GoStudioModal>
  )
}

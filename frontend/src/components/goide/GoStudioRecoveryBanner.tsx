import { AlertTriangle, FileClock, X } from 'lucide-react'
import { useGoIDEStore, type GoIDEState } from '@/stores/goide'

/** Riferimento stabile: un array nuovo nel selettore Zustand fa ridisegnare all'infinito. */
const EMPTY_RECOVERED: GoIDEState['recoveredBySession'][string] = []

interface GoStudioRecoveryBannerProps {
  sessionId: string
}

function savedAgo(savedAt: string): string {
  const saved = new Date(savedAt).getTime()
  if (Number.isNaN(saved)) return 'unknown time'
  const minutes = Math.max(0, Math.round((Date.now() - saved) / 60000))
  if (minutes < 1) return 'less than a minute ago'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

/**
 * Propone i buffer non salvati ritrovati dopo un riavvio. Il recupero è sempre
 * una scelta esplicita: nessun contenuto viene riapplicato da solo.
 */
export function GoStudioRecoveryBanner({ sessionId }: GoStudioRecoveryBannerProps) {
  const recovered = useGoIDEStore((state) => state.recoveredBySession[sessionId] ?? EMPTY_RECOVERED)
  const recoverBuffer = useGoIDEStore((state) => state.recoverBuffer)
  const discardRecoveredBuffer = useGoIDEStore((state) => state.discardRecoveredBuffer)
  if (recovered.length === 0) return null

  return (
    <div role="status" className="shrink-0 border-b border-warning/30 bg-warning/10 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-warning">
        <FileClock size={12} />
        {recovered.length} unsaved buffer{recovered.length === 1 ? '' : 's'} recovered from the previous session
      </div>
      <ul className="flex flex-col gap-1">
        {recovered.map((buffer) => (
          <li key={buffer.relativePath} className="flex items-center gap-2 text-[10px] text-text-2">
            <span className="min-w-0 flex-1 truncate font-mono">{buffer.relativePath}</span>
            <span className="shrink-0 text-text-4">{savedAgo(buffer.savedAt)}</span>
            {buffer.missing && (
              <span className="flex shrink-0 items-center gap-1 text-danger" title="The file no longer exists on disk">
                <AlertTriangle size={10} /> file missing
              </span>
            )}
            {buffer.diskChanged && !buffer.missing && (
              <span className="flex shrink-0 items-center gap-1 text-warning" title="The file changed on disk after this buffer was saved">
                <AlertTriangle size={10} /> disk changed
              </span>
            )}
            <button
              type="button"
              disabled={buffer.missing}
              onClick={() => void recoverBuffer(sessionId, buffer.relativePath)}
              className="shrink-0 rounded border border-border-1 px-1.5 py-0.5 text-text-1 hover:border-accent disabled:opacity-35"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={() => void discardRecoveredBuffer(sessionId, buffer.relativePath)}
              title="Discard this recovered buffer"
              className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-4 hover:bg-danger/10 hover:text-danger"
            >
              <X size={11} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

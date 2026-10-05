import { useEffect, useState } from 'react'
import { BookOpen, FileText, Loader2 } from 'lucide-react'
import { listGoIDEDirectory, type GoIDEFileEntry } from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'
import { GoStudioAlert, GoStudioButton, GoStudioModal } from './GoStudioModal'

interface Props {
  open: boolean
  sessionId: string
  onClose: () => void
}

export function GoStudioADRLinks({ open, sessionId, onClose }: Props) {
  const [entries, setEntries] = useState<GoIDEFileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setEntries([])
    setError(null)
    setLoading(true)
    void listGoIDEDirectory(sessionId, 'docs/adr').then((items) => {
      if (!cancelled) setEntries(items.filter((item) => !item.directory && /\.md$/i.test(item.name)))
    }).catch((reason) => {
      if (!cancelled) setError(String(reason))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [open, sessionId])

  return (
    <GoStudioModal open={open} onClose={onClose} icon={BookOpen} title="Architecture decisions" subtitle="ADRs in docs/adr" size="md" footer={<GoStudioButton variant="ghost" onClick={onClose}>Close</GoStudioButton>}>
      {error && <GoStudioAlert>{error}</GoStudioAlert>}
      {loading && <div className="flex items-center gap-2 text-xs text-text-3"><Loader2 size={14} className="animate-spin" />Reading ADRs…</div>}
      {!loading && !error && entries.length === 0 && <div className="gs-list-empty">No Markdown ADRs in docs/adr.</div>}
      {entries.length > 0 && <div className="gs-list min-h-0 overflow-y-auto">{entries.map((entry) => (
        <button key={entry.relativePath} type="button" className="gs-list-row flex w-full items-center gap-2 text-left hover:bg-surface-2" onClick={() => { void useGoIDEStore.getState().openDocument(entry.relativePath); onClose() }}>
          <FileText size={14} className="shrink-0 text-text-4" />
          <span className="min-w-0 truncate text-xs text-text-1">{entry.name}</span>
        </button>
      ))}</div>}
    </GoStudioModal>
  )
}

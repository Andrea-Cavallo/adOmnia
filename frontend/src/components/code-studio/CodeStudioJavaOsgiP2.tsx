import { useEffect, useState } from 'react'
import { CloudDownload, Loader2 } from 'lucide-react'
import { confirm } from '@/lib/confirmDialog'
import { cancelJavaOsgiP2, downloadJavaOsgiP2, previewJavaOsgiP2, subscribeGoIDEEvents } from '@/lib/code-studio-api'
import { studioToast } from '@/stores/codeStudioToast'
import type { P2DownloadResult, P2Preview } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde/models'

/** Payload of `osgi.p2.progress` (eclipsepde.P2Progress, sent as an event, not a binding model). */
interface P2Progress {
  phase: string
  done: number
  total: number
}

interface Props {
  sessionId: string
  /** The active target path: the strip appears only for a .target file. */
  targetPath: string
  /** Called after a download, to read the report again. */
  onDownloaded: () => void
}

const messageOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

/** Testo di conferma: i repository esatti, così l'utente vede dove va la rete prima di accettare. */
export function p2ConfirmMessage(preview: P2Preview): string {
  const repositories = (preview.repositories ?? []).map((repository) => `• ${repository}`).join('\n')
  return `Resolves ${preview.units} unit(s) of ${preview.locations} p2 location(s) and downloads their bundles from:\n${repositories}\n\n`
    + 'Bundles go to the adOmnia cache of this machine and are checked against the repository checksums. After this the target works offline.'
}

/** Riepilogo dell'esito di un download, per il toast. */
export function p2ResultMessage(result: P2DownloadResult): string {
  const problems = result.problems?.length ?? 0
  const base = `${result.bundles} p2 bundle(s) ready: ${result.downloaded} downloaded, ${result.reused} already cached`
  return problems > 0 ? `${base}. ${problems} problem(s) listed below.` : `${base}.`
}

/** Striscia p2 del pannello OSGi: stato del download delle location p2 del .target, avvio, avanzamento e annullamento. */
export function CodeStudioJavaOsgiP2({ sessionId, targetPath, onDownloaded }: Readonly<Props>) {
  const isTargetFile = targetPath.toLowerCase().endsWith('.target')
  const [preview, setPreview] = useState<P2Preview | null>(null)
  const [progress, setProgress] = useState<P2Progress | null>(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!isTargetFile) return
    let cancelled = false
    previewJavaOsgiP2(sessionId)
      .then((next) => { if (!cancelled) setPreview(next) })
      .catch(() => { if (!cancelled) setPreview(null) })
    return () => { cancelled = true }
  }, [sessionId, targetPath, isTargetFile, downloading])

  useEffect(() => subscribeGoIDEEvents((event) => {
    if (event.type === 'osgi.p2.progress' && event.sessionId === sessionId) setProgress(event.payload as P2Progress)
  }), [sessionId])

  if (!isTargetFile || !preview || preview.locations === 0) return null

  const download = async (): Promise<void> => {
    const approved = await confirm({ title: 'Download the p2 bundles of this target?', message: p2ConfirmMessage(preview), confirmLabel: 'Download' })
    if (!approved) return
    setDownloading(true)
    setProgress(null)
    try {
      const result = await downloadJavaOsgiP2(sessionId)
      if (result) studioToast(p2ResultMessage(result), (result.problems?.length ?? 0) > 0 ? 'info' : 'success')
      onDownloaded()
    } catch (reason) {
      studioToast(messageOf(reason), 'info')
    } finally {
      setDownloading(false)
      setProgress(null)
    }
  }

  const status = preview.downloaded ? `${preview.bundles} bundle(s) downloaded` : 'not downloaded yet'
  return (
    <div className="flex items-center gap-2 border-b border-border-1 px-3 py-1.5 text-[12px] text-text-3">
      <CloudDownload size={13} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate" title={(preview.repositories ?? []).join('\n')}>
        {downloading
          ? <><Loader2 size={11} className="mr-1 inline animate-spin" />{progress ? `${progress.phase} ${progress.total > 0 ? `${progress.done}/${progress.total}` : ''}` : 'Reading the p2 repositories…'}</>
          : <>p2: {preview.locations} location(s), {preview.units} unit(s) · <span className={preview.downloaded ? 'text-success' : 'text-warning'}>{status}</span></>}
      </span>
      {downloading
        ? <button type="button" className="gs-btn shrink-0" onClick={() => { void cancelJavaOsgiP2(sessionId) }}>Cancel</button>
        : <button type="button" className="gs-btn shrink-0" onClick={() => { void download() }}>{preview.downloaded ? 'Update p2 bundles…' : 'Download p2 bundles…'}</button>}
    </div>
  )
}

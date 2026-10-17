import { AppWindow, ExternalLink, Loader2, Radio, RotateCw, Square } from 'lucide-react'
import { useLivePreviewStore, selectSessionPreview } from '@/stores/livePreview'
import { currentPreview, phaseOf } from '@/lib/code-studio/livePreview'
import { CodeStudioStatusMenu } from './CodeStudioStatusMenu'

interface PreviewStatusProps {
  sessionId: string
  /** Classi del bottone della status bar, per restare identico agli altri elementi. */
  className: string
}

/** "Go Live" nella status bar: un clic avvia l'anteprima; da live apre il menu per mostrarla, aprirla fuori o fermarla. */
export function CodeStudioPreviewStatus({ sessionId, className }: PreviewStatusProps) {
  const view = useLivePreviewStore((state) => selectSessionPreview(state, sessionId))
  const actions = useLivePreviewStore.getState
  const preview = currentPreview(view.previews, view.activeId)
  const phase = phaseOf(preview)

  if (view.starting || phase === 'starting') {
    return (
      <button type="button" className={`${className} text-accent`} onClick={() => actions().show(sessionId)} title="Starting the preview server…">
        <Loader2 size={12} className="animate-spin" aria-hidden="true" />Starting…
      </button>
    )
  }

  if (phase === 'ready' && preview) {
    return (
      <CodeStudioStatusMenu
        label={`Live · :${preview.port ?? ''}`}
        title={`${preview.label ?? 'Live Preview'} is running at ${preview.directUrl ?? preview.url}`}
        className={`${className} text-success`}
        items={[
          { id: 'show', label: 'Show Live Preview', title: 'Show the preview where you placed it', icon: <Radio size={12} />, onSelect: () => actions().show(sessionId) },
          { id: 'browser', label: 'Open in browser', title: 'Open the page in your default browser', icon: <ExternalLink size={12} />, onSelect: () => void actions().openExternal(sessionId) },
          { id: 'window', label: 'Open in window', title: 'Show the page in a separate adOmnia window', icon: <AppWindow size={12} />, onSelect: () => void actions().openWindow(sessionId) },
          { id: 'restart', label: 'Restart server', title: 'Stop and start the server again', icon: <RotateCw size={12} />, onSelect: () => void actions().restart(sessionId) },
          { id: 'stop', label: 'Stop server', title: 'Stop the server and free its port', icon: <Square size={11} />, onSelect: () => void actions().stop(sessionId) },
        ]}
      />
    )
  }

  return (
    <button
      type="button" className={`${className} ${phase === 'failed' ? 'text-danger' : ''}`}
      onClick={() => (phase === 'failed' ? actions().show(sessionId) : void actions().goLive(sessionId, view.lastRequest ?? undefined))}
      title={phase === 'failed' ? (preview?.error ?? 'The preview could not start') : 'Go Live: start the preview server for this project · Alt+L'}
    >
      <Radio size={12} aria-hidden="true" />{phase === 'failed' ? 'Preview failed' : 'Go Live'}
    </button>
  )
}

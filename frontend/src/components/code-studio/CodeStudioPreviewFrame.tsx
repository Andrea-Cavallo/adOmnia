import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { parseBridgeMessage, type BridgeMessage } from '@/lib/code-studio/livePreview'

/** Comandi che la toolbar manda alla pagina incorniciata tramite il bridge. */
export interface PreviewFrameHandle {
  reload: () => void
  back: () => void
  forward: () => void
  navigate: (url: string) => void
}

interface PreviewFrameProps {
  /** Pagina da caricare (URL del proxy/server di anteprima). */
  src: string
  title: string
  /** La pagina passa dal proxy di adOmnia: il bridge risponde a ricarica, indietro e avanti. */
  bridged: boolean
  autoReload: boolean
  /** Larghezza/altezza della viewport in pixel; null = tutto lo spazio. */
  width: number | null
  height: number | null
  onMessage: (message: BridgeMessage) => void
}

/**
 * La pagina vera, in un iframe isolato: stessa origine di nessun altro pezzo di adOmnia, nessuna
 * navigazione del contenitore (niente allow-top-navigation), quindi il frontend dell'IDE non si
 * ricarica mai. Il bridge nella pagina riporta console, errori e navigazione via postMessage.
 */
export const CodeStudioPreviewFrame = forwardRef<PreviewFrameHandle, PreviewFrameProps>(function CodeStudioPreviewFrame({ src, title, bridged, autoReload, width, height, onMessage }, ref) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [generation, setGeneration] = useState(0)
  const [loadedKey, setLoadedKey] = useState('')
  const frameKey = `${src}#${generation}`
  const loading = loadedKey !== frameKey
  const origin = originOf(src)

  const send = useCallback((message: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ source: 'adomnia-host', ...message }, origin || '*')
  }, [origin])

  useImperativeHandle(ref, () => ({
    reload: () => {
      if (bridged) send({ type: 'reload' })
      else setGeneration((value) => value + 1)
    },
    back: () => send({ type: 'back' }),
    forward: () => send({ type: 'forward' }),
    navigate: (url) => send({ type: 'navigate', url }),
  }), [bridged, send])

  useEffect(() => { send({ type: 'auto-reload', enabled: autoReload }) }, [autoReload, send])

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      if (origin && event.origin !== origin) return
      const message = parseBridgeMessage(event.data)
      if (!message) return
      if (message.type === 'ready') send({ type: 'auto-reload', enabled: autoReload })
      onMessage(message)
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [autoReload, onMessage, origin, send])

  const sized = width !== null
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 items-start justify-center overflow-auto bg-[var(--gs-ground)] p-0" data-testid="preview-viewport">
      <div
        className={sized ? 'my-3 shrink-0 overflow-hidden rounded-lg border border-border-2 shadow-lg' : 'h-full w-full'}
        style={sized ? { width, height: height ?? 'calc(100% - 24px)', minHeight: 240 } : undefined}
      >
        {/* bg-white below is intentional: the previewed page assumes a white canvas, whatever the IDE theme. */}
        <iframe
          key={frameKey}
          ref={frame}
          title={title}
          src={src}
          onLoad={() => { setLoadedKey(frameKey); send({ type: 'auto-reload', enabled: autoReload }) }}
          className="h-full w-full border-0 bg-white"
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write; fullscreen"
          // oxlint-disable-next-line react/iframe-missing-sandbox -- the previewed dev server needs its own origin (storage, cookies, fetch); it is a different origin from the IDE, never same-origin with it.
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock"
        />
      </div>
      {loading && (
        <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-md bg-surface-2/90 px-2 py-1 text-[11px] text-text-3 shadow" role="status">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Loading page…
        </div>
      )}
    </div>
  )
})

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

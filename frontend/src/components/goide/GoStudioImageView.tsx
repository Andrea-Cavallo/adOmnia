import { useEffect, useState } from 'react'
import { FileWarning, Maximize2, Minus, Plus } from 'lucide-react'
import type { GoIDEEditorDocument } from '@/stores/goide'

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i

/** Una tab è un'immagine quando il backend la classifica così o l'estensione è nota. */
export function isImageDocument(document: GoIDEEditorDocument | null): boolean {
  if (!document) return false
  return document.document.language === 'image' || IMAGE_EXTENSION.test(document.document.relativePath)
}

/** Anteprima immagine: il file arriva dal backend come data URL, mai dal filesystem del WebView. */
export function GoStudioImageView({ document }: { document: GoIDEEditorDocument }) {
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(true)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const url = document.dataUrl ?? ''

  useEffect(() => { setZoom(1); setFit(true); setNatural(null) }, [document.document.id])

  if (!url) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-text-4">
        <FileWarning size={22} />
        <p className="text-[12.5px]">Image preview unavailable. The file may be too large (limit 16 MB) or not a supported format.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" role="img" aria-label={document.document.name}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-3 py-1 text-[11.5px] text-text-3">
        <span className="min-w-0 truncate font-medium text-text-2" title={document.document.relativePath}>{document.document.name}</span>
        {natural && <span className="font-mono text-text-4">{natural.width}×{natural.height}</span>}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => { setFit(false); setZoom((value) => Math.max(0.1, value - 0.25)) }} aria-label="Zoom out" title="Zoom out" className="go-studio-icon-button h-6 w-6"><Minus size={12} /></button>
          <span className="w-12 text-center font-mono tabular-nums text-text-4">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => { setFit(false); setZoom((value) => Math.min(8, value + 0.25)) }} aria-label="Zoom in" title="Zoom in" className="go-studio-icon-button h-6 w-6"><Plus size={12} /></button>
          <button type="button" onClick={() => setFit(true)} aria-pressed={fit} title="Fit to window" className={`go-studio-icon-button h-6 w-6 ${fit ? 'text-accent' : ''}`}><Maximize2 size={12} /></button>
        </span>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto p-4"
        style={{
          display: 'grid',
          placeItems: 'center',
          backgroundImage: 'conic-gradient(from 90deg at 50% 50%, transparent 25%, rgba(127,127,127,0.14) 0 50%, transparent 0 75%, rgba(127,127,127,0.14) 0)',
          backgroundSize: '22px 22px',
        }}
      >
        <img
          src={url}
          alt={document.document.name}
          draggable={false}
          onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          className={fit ? 'max-h-full max-w-full object-contain shadow-sm' : 'shadow-sm'}
          style={fit ? undefined : { width: natural ? natural.width * zoom : undefined, maxWidth: 'none' }}
        />
      </div>
    </div>
  )
}

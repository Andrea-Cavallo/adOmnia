import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Eraser, Check, Upload } from 'lucide-react'

interface SignatureModalProps {
  onClose: () => void
  onApply: (pngDataUrl: string) => void
}

// Draw or upload a signature. Returns a trimmed PNG data URL via onApply.
export function SignatureModal({ onClose, onApply }: SignatureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const [hasInk, setHasInk] = useState(false)
  const [uploaded, setUploaded] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
  }, [])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handleDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    drawingRef.current = true
    const { x, y } = pos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    setHasInk(true)
  }

  const handleUp = () => {
    drawingRef.current = false
  }

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    setUploaded(null)
  }, [])

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setUploaded(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(file)
  }

  const apply = () => {
    if (uploaded) {
      onApply(uploaded)
      return
    }
    const canvas = canvasRef.current
    if (!canvas || !hasInk) return
    onApply(canvas.toDataURL('image/png'))
  }

  const canApply = hasInk || uploaded !== null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[460px] rounded-xl border border-border-1 bg-surface-1 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-1">Add signature</h2>
          <button onClick={onClose} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text-1">
            <X size={15} />
          </button>
        </div>

        {uploaded ? (
          <div className="grid h-[180px] place-items-center rounded-lg border border-border-2 bg-surface-0">
            <img src={uploaded} alt="signature" className="max-h-[160px] max-w-[400px] object-contain" />
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            width={420}
            height={180}
            onPointerDown={handleDown}
            onPointerMove={handleMove}
            onPointerUp={handleUp}
            onPointerLeave={handleUp}
            className="touch-none rounded-lg border border-border-2 bg-surface-0"
            style={{ cursor: 'crosshair' }}
          />
        )}

        <p className="mt-2 text-[11px] text-text-4">Draw above, or upload a PNG/JPG image of your signature.</p>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={clear}
              className="flex items-center gap-1.5 rounded-md border border-border-2 px-2.5 py-1.5 text-[11px] text-text-3 hover:text-text-1"
            >
              <Eraser size={13} /> Clear
            </button>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border-2 px-2.5 py-1.5 text-[11px] text-text-3 hover:text-text-1">
              <Upload size={13} /> Upload
              <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleUpload} />
            </label>
          </div>
          <button
            onClick={apply}
            disabled={!canApply}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] font-bold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={14} /> Place signature
          </button>
        </div>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import type { GoIDESession } from '@/lib/code-studio-api'
import { CodeStudioLivePreview } from './CodeStudioLivePreview'

const STORAGE_KEY = 'adomnia.livePreview.split'
const MIN_FRACTION = 0.2
const MAX_FRACTION = 0.8
const DEFAULT_FRACTION = 0.5
const KEY_STEP = 0.02

function readFraction(): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY))
    return stored >= MIN_FRACTION && stored <= MAX_FRACTION ? stored : DEFAULT_FRACTION
  } catch {
    return DEFAULT_FRACTION
  }
}

function writeFraction(value: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // Storage unavailable (private window, blocked data): the split just resets next time.
  }
}

interface SplitProps {
  session: GoIDESession | undefined
  /** Lo split è aperto: l'anteprima sta a destra. Chiuso, l'editor occupa tutto lo spazio. */
  open: boolean
  /** Editor (con le sue tab) mostrato a sinistra. */
  editor: ReactNode
}

/** Codice a sinistra, Live Preview a destra, separatore trascinabile. */
export function CodeStudioPreviewSplit({ session, open, editor }: SplitProps) {
  const [fraction, setFraction] = useState(readFraction)
  const [dragging, setDragging] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  const clamp = (value: number) => Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, value))

  const beginDrag = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const move = (event: MouseEvent) => {
      const rect = container.current?.getBoundingClientRect()
      if (rect && rect.width > 0) setFraction(clamp((event.clientX - rect.left) / rect.width))
    }
    const end = () => setDragging(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', end)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', end)
    }
  }, [dragging])

  useEffect(() => { if (!dragging) writeFraction(fraction) }, [dragging, fraction])

  return (
    // Il contenitore dell'editor c'è sempre, aperto o no: così aprire la preview non rimonta Monaco.
    <div ref={container} className="relative flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-col" style={open ? { flexBasis: `${fraction * 100}%`, flexGrow: 0, flexShrink: 0 } : { flex: '1 1 0%' }}>{editor}</div>
      {open && session && <>
      <ResizeHandle
        variant="splitter" label="Resize live preview" onMouseDown={beginDrag}
        onArrow={(delta) => setFraction((value) => clamp(value + Math.sign(delta) * KEY_STEP))}
        onDoubleClick={() => setFraction(DEFAULT_FRACTION)}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-border-1">
        <CodeStudioLivePreview session={session} embedded />
      </div>
      </>}
      {/* Mentre si trascina, l'iframe catturerebbe il mouse: un velo trasparente lo impedisce. */}
      {dragging && <div className="fixed inset-0 z-50 cursor-ew-resize" aria-hidden="true" />}
    </div>
  )
}

import { useCallback, useRef, useState } from 'react'
import {
  screenToPoint,
  pointToScreen,
  normalizeRect,
  createTextAnnotation,
  createShapeAnnotation,
  createHighlightAnnotation,
  createInkAnnotation,
  createSignatureAnnotation,
  type PdfAnnotation,
  type PdfToolId,
  type ShapeKind,
  type Rect,
} from '@/lib/pdf/annotationModel'

interface AnnotationLayerProps {
  page: number
  widthPt: number
  heightPt: number
  zoom: number
  tool: PdfToolId
  color: string
  annotations: PdfAnnotation[]
  selectedId: string | null
  signatureImage: string | null
  onSelect: (id: string | null) => void
  onCreate: (annotation: PdfAnnotation) => void
  onUpdate: (annotation: PdfAnnotation) => void
  onToolHandled: () => void
  onNeedSignature: () => void
}

type Draft =
  | { kind: 'shape'; shape: ShapeKind | 'highlight'; start: { x: number; y: number }; rect: Rect }
  | { kind: 'ink'; points: number[] }
  | null

export function AnnotationLayer({
  page,
  widthPt,
  heightPt,
  zoom,
  tool,
  color,
  annotations,
  selectedId,
  signatureImage,
  onSelect,
  onCreate,
  onUpdate,
  onToolHandled,
  onNeedSignature,
}: AnnotationLayerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Draft>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const toLocal = useCallback(
    (clientX: number, clientY: number) => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: screenToPoint(clientX - rect.left, zoom),
        y: screenToPoint(clientY - rect.top, zoom),
      }
    },
    [zoom],
  )

  const handleBackgroundDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const p = toLocal(e.clientX, e.clientY)

    if (tool === 'select') {
      onSelect(null)
      setEditingId(null)
      return
    }
    if (tool === 'text') {
      const a = { ...createTextAnnotation(page, p.x, p.y), color }
      onCreate(a)
      onSelect(a.id)
      setEditingId(a.id)
      onToolHandled()
      return
    }
    if (tool === 'signature') {
      if (!signatureImage) {
        onNeedSignature()
        return
      }
      const a = createSignatureAnnotation(page, p.x, p.y, signatureImage)
      onCreate(a)
      onSelect(a.id)
      onToolHandled()
      return
    }
    if (tool === 'ink') {
      setDraft({ kind: 'ink', points: [p.x, p.y] })
      return
    }
    // shape / highlight rubber-band
    const shape = tool === 'highlight' ? 'highlight' : (tool as ShapeKind)
    setDraft({ kind: 'shape', shape, start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } })
  }

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draft) return
    const p = toLocal(e.clientX, e.clientY)
    if (draft.kind === 'ink') {
      setDraft({ kind: 'ink', points: [...draft.points, p.x, p.y] })
    } else {
      setDraft({ ...draft, rect: { x: draft.start.x, y: draft.start.y, w: p.x - draft.start.x, h: p.y - draft.start.y } })
    }
  }

  const handleUp = () => {
    if (!draft) return
    if (draft.kind === 'ink') {
      if (draft.points.length >= 4) onCreate(createInkAnnotation(page, draft.points))
    } else {
      const norm = normalizeRect(draft.rect)
      const big = Math.abs(draft.rect.w) > 3 || Math.abs(draft.rect.h) > 3
      if (big) {
        if (draft.shape === 'highlight') {
          onCreate({ ...createHighlightAnnotation(page, norm) })
        } else if (draft.shape === 'line' || draft.shape === 'arrow') {
          onCreate({ ...createShapeAnnotation(draft.shape, page, draft.rect), color })
        } else {
          onCreate({ ...createShapeAnnotation(draft.shape, page, norm), color })
        }
      }
    }
    setDraft(null)
    onToolHandled()
  }

  // ── Element move / resize via window listeners ──────────────────────────────
  const beginElementDrag = (
    e: React.PointerEvent,
    annotation: PdfAnnotation,
    mode: 'move' | 'resize',
  ) => {
    if (tool !== 'select') return
    e.stopPropagation()
    onSelect(annotation.id)
    const startClient = { x: e.clientX, y: e.clientY }
    const startGeo = annotation.type === 'ink'
      ? null
      : { x: annotation.x, y: annotation.y, w: annotation.w, h: annotation.h }
    if (!startGeo) return

    const onMoveWin = (me: PointerEvent) => {
      const dx = screenToPoint(me.clientX - startClient.x, zoom)
      const dy = screenToPoint(me.clientY - startClient.y, zoom)
      if (mode === 'move') {
        onUpdate({ ...annotation, x: startGeo.x + dx, y: startGeo.y + dy } as PdfAnnotation)
      } else {
        onUpdate({
          ...annotation,
          w: Math.max(8, startGeo.w + dx),
          h: Math.max(8, startGeo.h + dy),
        } as PdfAnnotation)
      }
    }
    const onUpWin = () => {
      window.removeEventListener('pointermove', onMoveWin)
      window.removeEventListener('pointerup', onUpWin)
    }
    window.addEventListener('pointermove', onMoveWin)
    window.addEventListener('pointerup', onUpWin)
  }

  const px = (pt: number) => pointToScreen(pt, zoom)
  const selectable = tool === 'select'

  return (
    <div
      ref={ref}
      onPointerDown={handleBackgroundDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerLeave={handleUp}
      className="absolute inset-0"
      style={{
        width: px(widthPt),
        height: px(heightPt),
        cursor: tool === 'select' ? 'default' : 'crosshair',
        touchAction: 'none',
      }}
    >
      {annotations.map((a) => (
        <AnnotationView
          key={a.id}
          annotation={a}
          zoom={zoom}
          selected={a.id === selectedId}
          selectable={selectable}
          editing={editingId === a.id}
          onBeginDrag={beginElementDrag}
          onSelect={() => selectable && onSelect(a.id)}
          onStartEdit={() => a.type === 'text' && selectable && setEditingId(a.id)}
          onEndEdit={() => setEditingId(null)}
          onUpdate={onUpdate}
        />
      ))}

      {draft?.kind === 'shape' && <DraftView shape={draft.shape} rect={draft.rect} zoom={zoom} color={color} />}
      {draft?.kind === 'ink' && <InkPath points={draft.points} zoom={zoom} color={color} width={2} />}
    </div>
  )
}

// ── Single annotation view ────────────────────────────────────────────────────

interface AnnotationViewProps {
  annotation: PdfAnnotation
  zoom: number
  selected: boolean
  selectable: boolean
  editing: boolean
  onBeginDrag: (e: React.PointerEvent, a: PdfAnnotation, mode: 'move' | 'resize') => void
  onSelect: () => void
  onStartEdit: () => void
  onEndEdit: () => void
  onUpdate: (a: PdfAnnotation) => void
}

function AnnotationView({
  annotation: a,
  zoom,
  selected,
  selectable,
  editing,
  onBeginDrag,
  onSelect,
  onStartEdit,
  onEndEdit,
  onUpdate,
}: AnnotationViewProps) {
  const px = (pt: number) => pointToScreen(pt, zoom)

  if (a.type === 'ink') {
    return <InkPath points={a.paths} zoom={zoom} color={a.color} width={a.width} selected={selected} onSelect={onSelect} />
  }

  const boxStyle: React.CSSProperties = {
    position: 'absolute',
    left: px(a.x),
    top: px(a.y),
    width: px(a.w),
    height: px(a.h),
    outline: selected ? '1.5px solid var(--color-accent, #6366f1)' : undefined,
    cursor: selectable ? 'move' : 'default',
  }

  const handle = selected && selectable && (
    <span
      onPointerDown={(e) => onBeginDrag(e, a, 'resize')}
      style={{ position: 'absolute', right: -5, bottom: -5, width: 10, height: 10, background: 'var(--color-accent, #6366f1)', borderRadius: 2, cursor: 'nwse-resize' }}
    />
  )

  if (a.type === 'text') {
    return (
      <div style={boxStyle} onPointerDown={(e) => onBeginDrag(e, a, 'move')} onDoubleClick={onStartEdit}>
        {editing ? (
          <textarea
            autoFocus
            value={a.text}
            onChange={(e) => onUpdate({ ...a, text: e.target.value })}
            onBlur={onEndEdit}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              height: '100%',
              resize: 'none',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: a.color,
              fontSize: px(a.fontSize),
              lineHeight: 1.2,
              textAlign: a.align,
              padding: 0,
              fontFamily: 'Helvetica, Arial, sans-serif',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              color: a.color,
              fontSize: px(a.fontSize),
              lineHeight: 1.2,
              textAlign: a.align,
              whiteSpace: 'pre-wrap',
              overflow: 'hidden',
              fontFamily: 'Helvetica, Arial, sans-serif',
            }}
          >
            {a.text}
          </div>
        )}
        {handle}
      </div>
    )
  }

  if (a.type === 'highlight') {
    return (
      <div
        style={{ ...boxStyle, background: a.color, opacity: a.opacity }}
        onPointerDown={(e) => onBeginDrag(e, a, 'move')}
      >
        {handle}
      </div>
    )
  }

  if (a.type === 'signature') {
    return (
      <div style={boxStyle} onPointerDown={(e) => onBeginDrag(e, a, 'move')}>
        <img src={a.imageDataUrl} alt="signature" style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
        {handle}
      </div>
    )
  }

  // shapes: rect / ellipse / line / arrow
  return (
    <div style={{ ...boxStyle, width: px(Math.abs(a.w)) || 1, height: px(Math.abs(a.h)) || 1, left: px(Math.min(a.x, a.x + a.w)), top: px(Math.min(a.y, a.y + a.h)) }} onPointerDown={(e) => onBeginDrag(e, a, 'move')}>
      <ShapeSvg type={a.type} w={Math.abs(a.w)} h={Math.abs(a.h)} flipX={a.w < 0} flipY={a.h < 0} zoom={zoom} color={a.color} strokeWidth={a.strokeWidth} />
      {handle}
    </div>
  )
}

// ── Shape SVG ─────────────────────────────────────────────────────────────────

function ShapeSvg({
  type,
  w,
  h,
  flipX,
  flipY,
  zoom,
  color,
  strokeWidth,
}: {
  type: 'rect' | 'ellipse' | 'line' | 'arrow'
  w: number
  h: number
  flipX: boolean
  flipY: boolean
  zoom: number
  color: string
  strokeWidth: number
}) {
  const W = Math.max(1, w * zoom)
  const H = Math.max(1, h * zoom)
  const sw = strokeWidth * zoom
  const markerId = `arrow_${color.replace('#', '')}`

  if (type === 'rect') {
    return (
      <svg width={W} height={H} style={{ overflow: 'visible' }}>
        <rect x={sw / 2} y={sw / 2} width={Math.max(1, W - sw)} height={Math.max(1, H - sw)} fill="none" stroke={color} strokeWidth={sw} />
      </svg>
    )
  }
  if (type === 'ellipse') {
    return (
      <svg width={W} height={H} style={{ overflow: 'visible' }}>
        <ellipse cx={W / 2} cy={H / 2} rx={Math.max(1, W / 2 - sw / 2)} ry={Math.max(1, H / 2 - sw / 2)} fill="none" stroke={color} strokeWidth={sw} />
      </svg>
    )
  }
  // line / arrow: from one corner to the opposite, respecting draw direction
  const x1 = flipX ? W : 0
  const y1 = flipY ? H : 0
  const x2 = flipX ? 0 : W
  const y2 = flipY ? 0 : H
  return (
    <svg width={W} height={H} style={{ overflow: 'visible' }}>
      {type === 'arrow' && (
        <defs>
          <marker id={markerId} markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill={color} />
          </marker>
        </defs>
      )}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={sw} markerEnd={type === 'arrow' ? `url(#${markerId})` : undefined} />
    </svg>
  )
}

// ── Ink path ──────────────────────────────────────────────────────────────────

function InkPath({
  points,
  zoom,
  color,
  width,
  selected,
  onSelect,
}: {
  points: number[]
  zoom: number
  color: string
  width: number
  selected?: boolean
  onSelect?: () => void
}) {
  if (points.length < 2) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i])
    maxX = Math.max(maxX, points[i])
    minY = Math.min(minY, points[i + 1])
    maxY = Math.max(maxY, points[i + 1])
  }
  const pad = width + 2
  const left = (minX - pad) * zoom
  const top = (minY - pad) * zoom
  const w = (maxX - minX + pad * 2) * zoom
  const h = (maxY - minY + pad * 2) * zoom
  let d = ''
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = (points[i] - minX + pad) * zoom
    const y = (points[i + 1] - minY + pad) * zoom
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `
  }
  return (
    <svg
      onPointerDown={(e) => { if (onSelect) { e.stopPropagation(); onSelect() } }}
      style={{ position: 'absolute', left, top, outline: selected ? '1px solid var(--color-accent, #6366f1)' : undefined }}
      width={Math.max(1, w)}
      height={Math.max(1, h)}
    >
      <path d={d.trim()} fill="none" stroke={color} strokeWidth={width * zoom} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DraftView({ shape, rect, zoom, color }: { shape: ShapeKind | 'highlight'; rect: Rect; zoom: number; color: string }) {
  const norm = normalizeRect(rect)
  const px = (pt: number) => pointToScreen(pt, zoom)
  if (shape === 'highlight') {
    return <div style={{ position: 'absolute', left: px(norm.x), top: px(norm.y), width: px(norm.w), height: px(norm.h), background: '#facc15', opacity: 0.4 }} />
  }
  return (
    <div style={{ position: 'absolute', left: px(norm.x), top: px(norm.y) }}>
      <ShapeSvg type={shape} w={norm.w} h={norm.h} flipX={rect.w < 0} flipY={rect.h < 0} zoom={zoom} color={color} strokeWidth={2} />
    </div>
  )
}

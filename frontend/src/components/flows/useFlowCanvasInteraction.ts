import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { FlowNodeDefinition } from '@/lib/flowStorage'

export function useFlowCanvasInteraction({ zoom, onZoom, onSelect, onMove }: {
  zoom: number
  onZoom: (zoom: number) => void
  onSelect: (id: string | null) => void
  onMove: (id: string, position: { x: number; y: number }) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [panning, setPanning] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  const pendingScroll = useRef<{ left: number; top: number } | null>(null)
  useEffect(() => () => cleanupRef.current?.(), [])
  useLayoutEffect(() => {
    if (pendingScroll.current) { scrollRef.current?.scrollTo(pendingScroll.current); pendingScroll.current = null }
  }, [zoom])
  const changeZoom = (value: number, clientX?: number, clientY?: number) => {
    const scroll = scrollRef.current
    if (!scroll) return
    const next = Math.max(.2, Math.min(2, value))
    if (next === zoom) return
    const rect = scroll.getBoundingClientRect()
    const x = clientX === undefined ? scroll.clientWidth / 2 : clientX - rect.left
    const y = clientY === undefined ? scroll.clientHeight / 2 : clientY - rect.top
    pendingScroll.current = { left: (scroll.scrollLeft + x) * next / zoom - x, top: (scroll.scrollTop + y) * next / zoom - y }
    onZoom(next)
  }
  const resetScroll = () => {
    pendingScroll.current = { left: 0, top: 0 }
    scrollRef.current?.scrollTo(pendingScroll.current)
  }
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      changeZoom(zoom * Math.exp(-event.deltaY * .004), event.clientX, event.clientY)
    }
    scroll.addEventListener('wheel', wheel, { passive: false })
    return () => scroll.removeEventListener('wheel', wheel)
  }, [zoom, onZoom])
  const gesture = (event: ReactPointerEvent, onPointerMove: (next: PointerEvent) => void, onEnd: (moved: boolean) => void) => {
    cleanupRef.current?.()
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    const startX = event.clientX, startY = event.clientY
    let moved = false, frame = 0, latest: PointerEvent | null = null
    const flush = () => { frame = 0; if (latest && moved) onPointerMove(latest) }
    const move = (next: PointerEvent) => {
      latest = next
      moved ||= Math.hypot(next.clientX - startX, next.clientY - startY) > 3
      if (!frame) frame = requestAnimationFrame(flush)
    }
    const cleanup = () => {
      cancelAnimationFrame(frame)
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', cancel)
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
      cleanupRef.current = null
    }
    const up = () => { cancelAnimationFrame(frame); flush(); cleanup(); setPanning(false); onEnd(moved) }
    const cancel = () => { cleanup(); setPanning(false) }
    cleanupRef.current = cleanup
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', cancel)
  }
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button') || !scrollRef.current || ![0, 1].includes(event.button)) return
    event.preventDefault()
    event.currentTarget.focus()
    const scroll = scrollRef.current
    const origin = { x: event.clientX, y: event.clientY, left: scroll.scrollLeft, top: scroll.scrollTop }
    setPanning(true)
    gesture(event, next => scroll.scrollTo({ left: origin.left - next.clientX + origin.x, top: origin.top - next.clientY + origin.y }), moved => { if (!moved) onSelect(null) })
  }
  const startDrag = (event: ReactPointerEvent, node: FlowNodeDefinition) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX, startY = event.clientY
    gesture(event, next => {
      const x = node.x + (next.clientX - startX) / zoom, y = node.y + (next.clientY - startY) / zoom
      onMove(node.id, { x: Math.max(24, next.shiftKey ? Math.round(x / 22) * 22 : x), y: Math.max(24, next.shiftKey ? Math.round(y / 22) * 22 : y) })
    }, moved => { if (!moved) onSelect(node.id) })
  }
  return { scrollRef, panning, changeZoom, resetScroll, startPan, startDrag }
}

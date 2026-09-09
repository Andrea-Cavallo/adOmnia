import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react'
import { GripHorizontal, Maximize2, Minimize2, PanelLeft, Pin, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Panels keep their children mounted when closed, preserving editor and tab state. */
export function FlowDockPanel({ title, side, open, onClose, children, initialFloating = false, initialWidth }: {
  title: string
  side: 'left' | 'right' | 'bottom'
  open: boolean
  onClose: () => void
  children: ReactNode
  initialFloating?: boolean
  initialWidth?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const [floating, setFloating] = useState(initialFloating)
  const [maximized, setMaximized] = useState(false)
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 1000, height: 700 })
  const [frame, setFrame] = useState({ x: 32, y: 80, width: initialWidth ?? (side === 'bottom' ? 720 : 440), height: 480 })
  const [dockSize, setDockSize] = useState(side === 'left' ? 276 : side === 'right' ? 420 : 218)
  useEffect(() => {
    const workspace = ref.current?.closest('[data-flow-workspace]')
    if (!workspace) return
    const measure = () => {
      const rect = workspace.getBoundingClientRect()
      setBounds({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(workspace)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); cleanup.current?.() }
  }, [])
  const width = Math.min(frame.width, bounds.width)
  const height = Math.min(frame.height, bounds.height)
  const x = Math.max(0, Math.min(frame.x, bounds.width - width))
  const y = Math.max(0, Math.min(frame.y, bounds.height - height))
  const gesture = (event: PointerEvent, kind: 'move' | 'resize') => {
    if (event.button !== 0 || maximized) return
    if (kind === 'move' && (!floating || (event.target as HTMLElement).closest('button'))) return
    event.preventDefault()
    const origin = { x: event.clientX, y: event.clientY }
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    cleanup.current?.()
    const move = (next: globalThis.PointerEvent) => {
      const dx = next.clientX - origin.x, dy = next.clientY - origin.y
      if (kind === 'move') setFrame({ ...frame, x: Math.max(0, Math.min(bounds.width - width, x + dx)), y: Math.max(0, Math.min(bounds.height - height, y + dy)) })
      else if (floating) setFrame({ x, y, width: Math.max(Math.min(280, bounds.width), Math.min(bounds.width - x, width + dx)), height: Math.max(Math.min(160, bounds.height), Math.min(bounds.height - y, height + dy)) })
      else setDockSize(Math.max(side === 'bottom' ? 120 : 240, Math.min(side === 'bottom' ? bounds.height * .65 : bounds.width * .55, dockSize + (side === 'left' ? dx : side === 'right' ? -dx : -dy))))
    }
    const stop = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', stop)
      target.removeEventListener('pointercancel', stop)
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
      cleanup.current = null
    }
    cleanup.current = stop
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', stop)
    target.addEventListener('pointercancel', stop)
  }
  const button = 'grid h-7 w-7 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent'
  return (
    <div ref={ref} role="region" aria-label={title} hidden={!open}
      onKeyDown={event => { if (event.key === 'Escape' && maximized) { event.stopPropagation(); setMaximized(false) } }}
      className={cn(open ? 'flex' : 'hidden', 'relative min-h-0 min-w-0 shrink-0 flex-col border border-border-1 bg-surface-1', (floating || maximized) && 'rounded-lg shadow-2xl')}
      style={maximized
        ? { position: 'absolute', left: 0, top: 0, width: bounds.width, height: bounds.height, zIndex: 50 }
        : floating ? { position: 'absolute', left: x, top: y, width, height, zIndex: 40 }
          : side === 'bottom' ? { height: dockSize, maxHeight: '65%' } : { width: dockSize, maxWidth: '55%' }}>
      <div onPointerDown={event => gesture(event, 'move')} className={cn('flex h-9 shrink-0 select-none items-center gap-1 border-b border-border-1 px-2', floating && !maximized && 'cursor-move touch-none')}>
        <GripHorizontal size={14} className="shrink-0 text-text-4" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-2">{title}</span>
        <button className={button} title={`${floating ? 'Dock' : 'Float'} ${title}`} aria-label={`${floating ? 'Dock' : 'Float'} ${title}`} onClick={() => { setMaximized(false); setFloating(value => !value) }}>{floating ? <Pin size={13} /> : <PanelLeft size={13} />}</button>
        <button className={button} title={`${maximized ? 'Restore' : 'Maximize'} ${title}`} aria-label={`${maximized ? 'Restore' : 'Maximize'} ${title}`} onClick={() => setMaximized(value => !value)}>{maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
        <button className={button} title={`Close ${title}`} aria-label={`Close ${title}`} onClick={onClose}><X size={14} /></button>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      {!maximized && <div role="separator" aria-label={`Resize ${title}`} aria-orientation={side === 'bottom' ? 'horizontal' : 'vertical'} aria-valuenow={Math.round(floating ? width : dockSize)} tabIndex={0}
        onPointerDown={event => gesture(event, 'resize')}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
          event.preventDefault()
          const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 24 : -24
          if (floating) setFrame(current => event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? { ...current, width: Math.max(280, Math.min(bounds.width - x, width + delta)) } : { ...current, height: Math.max(160, Math.min(bounds.height - y, height + delta)) })
          else setDockSize(current => Math.max(side === 'bottom' ? 120 : 240, Math.min(side === 'bottom' ? bounds.height * .65 : bounds.width * .55, current + (side === 'left' ? delta : -delta))))
        }}
        className={cn('z-10 touch-none shrink-0 hover:bg-accent/40 focus:bg-accent/40', floating ? 'absolute bottom-0 right-0 h-4 w-4 cursor-se-resize rounded-tl border-l border-t border-border-2' : side === 'bottom' ? 'absolute inset-x-0 top-0 h-1 cursor-row-resize' : side === 'left' ? 'absolute inset-y-0 right-0 w-1 cursor-col-resize' : 'absolute inset-y-0 left-0 w-1 cursor-col-resize')}
      />}
    </div>
  )
}

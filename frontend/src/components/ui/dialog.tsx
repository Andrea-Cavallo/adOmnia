import { useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useModalFocusTrap } from '@/lib/accessibility'

interface DialogProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
}

export function DialogOverlay({ open, onClose, children, className }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useModalFocusTrap(open, onClose, overlayRef)

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose()
    },
    [onClose]
  )

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      data-a11y-click-exempt="dialog-backdrop"
      tabIndex={-1}
      onClick={handleBackdropClick}
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center',
        'bg-black/60 backdrop-blur-sm',
        'animate-in fade-in duration-150',
        className
      )}
    >
      {children}
    </div>
  )
}

type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

const sizeClasses: Record<DialogSize, string> = {
  sm: 'w-[min(420px,calc(100vw-32px))] max-w-[420px]',
  md: 'w-[min(560px,calc(100vw-32px))] max-w-[560px]',
  lg: 'w-[min(760px,calc(100vw-32px))] max-w-[760px]',
  xl: 'w-[min(960px,calc(100vw-32px))] max-w-[960px]',
  full: 'w-[min(1200px,calc(100vw-32px))] max-w-[1200px]',
}

interface DialogContentProps {
  size?: DialogSize
  children: React.ReactNode
  className?: string
}

export function DialogContent({ size = 'md', children, className }: DialogContentProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        sizeClasses[size],
        'max-h-[min(680px,calc(100vh-32px))] overflow-hidden',
        'rounded-xl border border-border-2 bg-surface-1 shadow-2xl',
        'flex flex-col',
        'animate-in zoom-in-95 duration-150',
        className
      )}
    >
      {children}
    </div>
  )
}

interface DialogHeaderProps {
  children: React.ReactNode
  className?: string
}

export function DialogHeader({ children, className }: DialogHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between',
        'px-5 py-4',
        'border-b border-border-1 bg-surface-0',
        'shrink-0',
        className
      )}
    >
      {children}
    </div>
  )
}

interface DialogBodyProps {
  children: React.ReactNode
  className?: string
}

export function DialogBody({ children, className }: DialogBodyProps) {
  return (
    <div
      className={cn(
        'flex-1 overflow-y-auto',
        'p-5',
        className
      )}
    >
      {children}
    </div>
  )
}

interface DialogFooterProps {
  children: React.ReactNode
  className?: string
}

export function DialogFooter({ children, className }: DialogFooterProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2',
        'px-5 py-3.5',
        'border-t border-border-1 bg-surface-0',
        'shrink-0',
        className
      )}
    >
      {children}
    </div>
  )
}

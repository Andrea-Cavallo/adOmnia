import { useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface DialogProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
}

export function DialogOverlay({ open, onClose, children, className }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [open, onClose])

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
  sm: 'w-modal-sm max-w-modal-sm',
  md: 'w-modal-md max-w-modal-md',
  lg: 'w-modal-lg max-w-modal-lg',
  xl: 'w-modal-xl max-w-modal-xl',
  full: 'w-modal-full max-w-modal-full',
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
        'max-h-modal-content overflow-hidden',
        'rounded-lg border border-border-2 bg-surface-1 shadow-2xl',
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
        'px-fluid-4 py-fluid-2',
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
        'p-fluid-4',
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
        'flex items-center justify-end gap-fluid-2',
        'px-fluid-4 py-fluid-2',
        'border-t border-border-1 bg-surface-0',
        'shrink-0',
        className
      )}
    >
      {children}
    </div>
  )
}

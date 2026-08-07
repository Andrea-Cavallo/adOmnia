import { useId, useRef } from 'react'
import { Trash2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiTranslation } from '@/lib/uiI18n'
import { useModalFocusTrap } from '@/lib/accessibility'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const tr = useUiTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const isDanger = variant === 'danger'
  const resolvedConfirmLabel = confirmLabel === 'Confirm' ? tr('Confirm') : confirmLabel
  const resolvedCancelLabel = cancelLabel === 'Cancel' ? tr('Cancel') : cancelLabel

  useModalFocusTrap(open, onCancel, dialogRef)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px] animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-[320px] overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top accent line */}
        <div className={cn('h-px', isDanger ? 'bg-status-err/60' : 'bg-accent/60')} />

        <div className="px-5 pt-5 pb-4">
          {/* Icon badge */}
          <div
            className={cn(
              'mb-4 flex h-9 w-9 items-center justify-center rounded-full ring-1',
              isDanger
                ? 'bg-status-err/10 ring-status-err/20'
                : 'bg-accent/10 ring-accent/20'
            )}
          >
            {isDanger
              ? <Trash2 size={16} className="text-status-err" />
              : <AlertTriangle size={16} className="text-accent" />
            }
          </div>

          {/* Title */}
          <h2 id={titleId} className="mb-1.5 text-[13px] font-semibold leading-snug text-text-1">
            {title}
          </h2>

          {/* Body */}
          <p className="text-xs leading-relaxed text-text-3">
            {message}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3">
          <button
            onClick={onCancel}
            className="h-7 rounded px-3 text-xs font-medium text-text-2 transition-colors hover:bg-surface-3 hover:text-text-1"
          >
            {resolvedCancelLabel}
          </button>
          <button
            onClick={() => { onConfirm(); onCancel() }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium text-white transition-colors',
              isDanger
                ? 'bg-status-err hover:bg-status-err/85'
                : 'bg-accent hover:bg-accent-light'
            )}
          >
            {isDanger && <Trash2 size={11} />}
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

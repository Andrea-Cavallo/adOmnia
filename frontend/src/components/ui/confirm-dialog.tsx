import { DialogOverlay } from './dialog'
import { AlertTriangle, Trash2 } from 'lucide-react'

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
  return (
    <DialogOverlay open={open} onClose={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-[420px] bg-surface-1 border border-border-2 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          {variant === 'danger' && (
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-error/15 flex items-center justify-center">
              <AlertTriangle size={16} className="text-error" />
            </div>
          )}
          <h2 className="text-sm font-semibold text-text-1">{title}</h2>
        </div>

        {/* Body */}
        <div className="px-5 pb-5">
          <p className="text-sm text-text-3 leading-relaxed">{message}</p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-1 bg-surface-0">
          <button
            onClick={onCancel}
            className="h-8 px-4 rounded text-xs font-medium text-text-2 bg-surface-2 border border-border-2 hover:text-text-1 hover:bg-surface-3 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => { onConfirm(); onCancel() }}
            className={
              variant === 'danger'
                ? 'h-8 px-4 rounded text-xs font-medium flex items-center gap-1.5 bg-error text-white hover:bg-error/85 transition-colors'
                : 'h-8 px-4 rounded text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors'
            }
          >
            {variant === 'danger' && <Trash2 size={11} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </DialogOverlay>
  )
}

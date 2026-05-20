import { DialogOverlay, DialogContent, DialogHeader, DialogBody, DialogFooter } from './dialog'
import { Button } from './button'

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
      <DialogContent size="sm">
        <DialogHeader>
          <h2 className="text-sm font-semibold text-text-1">{title}</h2>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-text-2">{message}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'destructive' : 'default'}
            size="sm"
            onClick={() => {
              onConfirm()
              onCancel()
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogOverlay>
  )
}

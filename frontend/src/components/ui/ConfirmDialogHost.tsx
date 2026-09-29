import { useConfirmStore } from '@/lib/confirmDialog'
import { ConfirmDialog } from './confirm-dialog'

/**
 * Single mounted host that renders the globally-requested confirmation dialog.
 * Mount once near the app root; call `confirm(...)` from anywhere.
 */
export function ConfirmDialogHost() {
  const { open, title, message, details, confirmLabel, cancelLabel, variant, settle } = useConfirmStore()
  return (
    <ConfirmDialog
      open={open}
      title={title}
      message={message}
      details={details}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      variant={variant}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )
}

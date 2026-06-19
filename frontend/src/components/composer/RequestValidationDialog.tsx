import { AlertTriangle, X } from 'lucide-react'
import type { RequestParamIssue } from '@/lib/requestParamValidation'
import { DialogBody, DialogContent, DialogFooter, DialogHeader, DialogOverlay } from '@/components/ui/dialog'

interface RequestValidationDialogProps {
  issues: RequestParamIssue[]
  onClose: () => void
}

export function RequestValidationDialog({ issues, onClose }: RequestValidationDialogProps) {
  return (
    <DialogOverlay open={issues.length > 0} onClose={onClose}>
      <DialogContent size="sm">
        <DialogHeader className="px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle size={15} className="shrink-0 text-warning" />
            <h2 className="truncate text-[13px] font-semibold text-text-1">Invalid request parameters</h2>
          </div>
          <button onClick={onClose} title="Close" className="grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1">
            <X size={13} />
          </button>
        </DialogHeader>
        <DialogBody className="p-4">
          <p className="mb-3 text-xs leading-relaxed text-text-3">
            The request was not sent. Correct the highlighted parameter data and try again.
          </p>
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {issues.map((issue, index) => (
              <div key={`${issue.kind}-${issue.field}-${index}`} className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2">
                <p className="font-mono text-[11px] font-semibold text-warning">{issue.field}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-text-2">{issue.message}</p>
              </div>
            ))}
          </div>
        </DialogBody>
        <DialogFooter className="px-4 py-3">
          <button onClick={onClose} autoFocus className="h-7 rounded bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover">
            Review parameters
          </button>
        </DialogFooter>
      </DialogContent>
    </DialogOverlay>
  )
}

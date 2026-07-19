import type { DropFeedback } from '@/hooks/useFileDrop'
import { AlertCircle, CheckCircle2, Copy, ExternalLink } from 'lucide-react'

interface DropToastProps {
  feedback: DropFeedback
}

export function DropToast({ feedback }: DropToastProps) {
  const Icon = feedback.ok ? CheckCircle2 : AlertCircle
  const copy = () => void navigator.clipboard?.writeText(feedback.msg)

  return (
    <div className={[
      'absolute right-4 top-12 z-[9999] flex max-w-[420px] items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium shadow-2xl shadow-black/40 backdrop-blur-md toast-enter',
      feedback.ok ? 'border-success/25 bg-surface-1/95 text-success' : 'border-error/25 bg-surface-1/95 text-error',
    ].join(' ')}>
      <Icon size={14} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-text-2">{feedback.msg}</span>
      <button
        type="button"
        onClick={copy}
        className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1"
        title="Copy message"
      >
        <Copy size={11} />
      </button>
      {feedback.ok && (
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-4" title="Opened in adOmnia">
          <ExternalLink size={11} />
        </span>
      )}
    </div>
  )
}

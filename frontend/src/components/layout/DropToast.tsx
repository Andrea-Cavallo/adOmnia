import type { DropFeedback } from '@/hooks/useFileDrop'

interface DropToastProps {
  feedback: DropFeedback
}

export function DropToast({ feedback }: DropToastProps) {
  return (
    <div className={[
      'absolute bottom-16 left-1/2 z-[9999] -translate-x-1/2 rounded-md border px-4 py-2 text-xs font-medium shadow-xl transition-all',
      feedback.ok ? 'border-success/30 bg-success/15 text-success' : 'border-error/30 bg-error/15 text-error',
    ].join(' ')}>
      {feedback.msg}
    </div>
  )
}

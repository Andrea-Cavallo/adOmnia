import { useEffect, useId, useRef } from 'react'
import { AlertTriangle, CircleHelp, SquareTerminal, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiTranslation } from '@/lib/uiI18n'
import { useModalFocusTrap } from '@/lib/accessibility'
import type { ConfirmDetail } from '@/lib/confirmDialog'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  details?: ConfirmDetail[]
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

/** Icona che dice subito di che conferma si tratta: eliminazione, comando da eseguire o domanda. */
function DialogIcon({ danger, command }: { danger: boolean; command: boolean }) {
  const Icon = danger ? (command ? AlertTriangle : Trash2) : command ? SquareTerminal : CircleHelp
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1',
        danger ? 'bg-status-err/12 text-status-err ring-status-err/25' : 'bg-accent/12 text-accent ring-accent/25',
      )}
    >
      <Icon size={18} strokeWidth={2} />
    </span>
  )
}

const LEGACY_DETAIL = /^(Command|Working directory|Directory|Path|File): (.+)$/

/**
 * Le conferme che scrivono "Command: …" o "Working directory: …" in testa al
 * messaggio diventano dettagli strutturati: i chiamanti esistenti ottengono il
 * nuovo layout senza cambiare.
 */
export function splitConfirmMessage(message: string, details: ConfirmDetail[] = []): { message: string; details: ConfirmDetail[] } {
  const lines = message.split('\n')
  const extracted: ConfirmDetail[] = []
  while (lines.length > 0) {
    const match = LEGACY_DETAIL.exec(lines[0])
    if (!match) break
    extracted.push({ label: match[1], value: match[2], mono: true })
    lines.shift()
  }
  return { message: lines.join('\n').trim(), details: [...extracted, ...details] }
}

export function ConfirmDialog({
  open,
  title,
  message: rawMessage,
  details: rawDetails = [],
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const tr = useUiTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const messageId = useId()
  const { message, details } = splitConfirmMessage(rawMessage, rawDetails)
  const isDanger = variant === 'danger'
  const hasCommand = details.some((detail) => detail.mono)
  const resolvedConfirmLabel = confirmLabel === 'Confirm' ? tr('Confirm') : confirmLabel
  const resolvedCancelLabel = cancelLabel === 'Cancel' ? tr('Cancel') : cancelLabel

  useModalFocusTrap(open, onCancel, dialogRef)

  // Invio conferma solo le azioni sicure: per quelle distruttive il focus parte da Annulla.
  useEffect(() => {
    if (open) (isDanger ? cancelRef : confirmRef).current?.focus()
  }, [isDanger, open])

  if (!open) return null

  return (
    <div className="ad-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        tabIndex={-1}
        className="w-[min(460px,100%)] overflow-hidden rounded-2xl border border-border-2 bg-surface-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cn('h-0.5 bg-gradient-to-r from-transparent to-transparent', isDanger ? 'via-status-err/70' : 'via-accent/70')} />

        <div className="flex gap-3.5 px-5 pb-4 pt-5">
          <DialogIcon danger={isDanger} command={hasCommand} />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[14px] font-semibold leading-snug text-text-1">{title}</h2>
            {message && (
              <p id={messageId} className="mt-1 whitespace-pre-line break-words text-[12px] leading-relaxed text-text-3">{message}</p>
            )}
          </div>
        </div>

        {details.length > 0 && (
          <dl className="mx-5 mb-4 space-y-2 rounded-xl border border-border-1 bg-surface-0/70 p-3">
            {details.map((detail) => (
              <div key={detail.label} className="min-w-0">
                <dt className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-text-4">{detail.label}</dt>
                <dd
                  className={cn(
                    'mt-0.5 break-all text-[11.5px] leading-snug',
                    detail.mono ? 'font-mono text-text-1' : 'text-text-2',
                  )}
                  title={detail.value}
                >
                  {detail.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border-1 bg-surface-0/60 px-5 py-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="h-8 rounded-lg px-3.5 text-xs font-medium text-text-2 transition-colors hover:bg-surface-3 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {resolvedCancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => { onConfirm(); onCancel() }}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-lg px-4 text-xs font-semibold text-white shadow-sm transition-[background-color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-surface-1',
              isDanger
                ? 'bg-status-err hover:bg-status-err/85 focus-visible:ring-status-err/60'
                : 'bg-accent hover:bg-accent-light focus-visible:ring-accent/60',
            )}
          >
            {isDanger && <Trash2 size={12} />}
            {!isDanger && hasCommand && <SquareTerminal size={12} />}
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

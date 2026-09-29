import { useEffect, useRef, useState } from 'react'
import { KeyRound, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'

interface GoStudioSecretsPromptProps {
  open: boolean
  configurationName: string
  keys: string[]
  onSubmit: (secrets: Record<string, string>) => void
  onCancel: () => void
}

/**
 * Chiede i valori segreti di una configurazione al momento dell'avvio. I valori
 * restano in memoria per questa esecuzione e non vengono mai persistiti.
 */
export function GoStudioSecretsPrompt({ open, configurationName, keys, onSubmit, onCancel }: GoStudioSecretsPromptProps) {
  const dialogRef = useRef<HTMLFormElement>(null)
  useModalFocusTrap(open, onCancel, dialogRef)
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) setValues({})
  }, [open, configurationName])

  if (!open) return null
  const complete = keys.every((key) => (values[key] ?? '').length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center ad-modal-backdrop" onClick={onCancel}>
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Run secrets"
        tabIndex={-1}
        className="w-[420px] overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); if (complete) onSubmit(values) }}
      >
        <div className="flex h-10 items-center gap-1.5 border-b border-border-1 px-4">
          <KeyRound size={12} className="text-accent" />
          <h2 className="text-xs font-semibold text-text-1">Secrets for “{configurationName}”</h2>
          <button type="button" onClick={onCancel} className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3">
            <X size={12} />
          </button>
        </div>
        <div className="flex flex-col gap-2 p-4">
          {keys.map((key) => (
            <label key={key} className="block text-[10px] font-medium text-text-3">
              {key}
              <input
                type="password"
                autoComplete="off"
                value={values[key] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent"
              />
            </label>
          ))}
        </div>
        <p className="border-t border-border-1 px-4 py-2 text-[9px] leading-4 text-text-4">
          These values are used for this run only. They are never written to disk and never appear in execution logs.
        </p>
        <div className="flex items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3">
          <button type="button" onClick={onCancel} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Cancel</button>
          <button type="submit" disabled={!complete} className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">
            Run
          </button>
        </div>
      </form>
    </div>
  )
}

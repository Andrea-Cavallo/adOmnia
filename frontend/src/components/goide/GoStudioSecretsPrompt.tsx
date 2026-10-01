import { useEffect, useState } from 'react'
import { KeyRound, Play } from 'lucide-react'
import { GoStudioButton, GoStudioField, GoStudioModal } from './GoStudioModal'

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
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) setValues({})
  }, [open, configurationName])

  if (!open) return null
  const complete = keys.every((key) => (values[key] ?? '').length > 0)

  return (
    <GoStudioModal
      open={open}
      onClose={onCancel}
      size="sm"
      icon={KeyRound}
      title="Run secrets"
      subtitle={<>Values for “{configurationName}”. Used for this run only, never written to disk or logs.</>}
      footer={<>
        <GoStudioButton variant="ghost" onClick={onCancel}>Cancel</GoStudioButton>
        <GoStudioButton variant="primary" type="submit" form="go-studio-secrets-form" icon={Play} disabled={!complete}>Run</GoStudioButton>
      </>}
    >
      <form id="go-studio-secrets-form" className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (complete) onSubmit(values) }}>
        {keys.map((key) => (
          <GoStudioField key={key} label={<span className="gs-mono text-[12px]">{key}</span>}>
            <input type="password" autoComplete="off" value={values[key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} className="gs-input gs-mono" />
          </GoStudioField>
        ))}
      </form>
    </GoStudioModal>
  )
}

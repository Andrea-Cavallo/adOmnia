import { useState } from 'react'
import { KeyRound, Play } from 'lucide-react'
import { CodeStudioButton, CodeStudioField, CodeStudioModal } from './CodeStudioModal'

interface CodeStudioSecretsPromptProps {
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
export function CodeStudioSecretsPrompt(props: CodeStudioSecretsPromptProps) {
  // Mounted per opening (and per configuration), so typed values never leak into the next prompt.
  return props.open ? <SecretsForm key={props.configurationName} {...props} /> : null
}

function SecretsForm({ open, configurationName, keys, onSubmit, onCancel }: CodeStudioSecretsPromptProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const complete = keys.every((key) => (values[key] ?? '').length > 0)

  return (
    <CodeStudioModal
      open={open}
      onClose={onCancel}
      size="sm"
      icon={KeyRound}
      title="Run secrets"
      subtitle={<>Values for “{configurationName}”. Used for this run only, never written to disk or logs.</>}
      footer={<>
        <CodeStudioButton variant="ghost" onClick={onCancel}>Cancel</CodeStudioButton>
        <CodeStudioButton variant="primary" type="submit" form="code-studio-secrets-form" icon={Play} disabled={!complete}>Run</CodeStudioButton>
      </>}
    >
      <form id="code-studio-secrets-form" className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (complete) onSubmit(values) }}>
        {keys.map((key) => (
          <CodeStudioField key={key} label={<span className="gs-mono text-[12px]">{key}</span>}>
            <input type="password" autoComplete="off" value={values[key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} className="gs-input gs-mono" />
          </CodeStudioField>
        ))}
      </form>
    </CodeStudioModal>
  )
}

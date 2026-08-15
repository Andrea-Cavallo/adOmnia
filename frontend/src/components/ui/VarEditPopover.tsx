import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { uid, type EnvVariable } from '@/lib/types'
import { useEnvironmentsStore } from '@/stores/environments'
import { useUiTranslation } from '@/lib/uiI18n'

export interface VarEditTarget {
  varName: string
  envId: string
  x: number
  y: number
}

/**
 * Target for the inline `{{VAR}}` editor. When no environment is active one is
 * created on the spot, so the user can give the variable a value immediately
 * instead of detouring through the Environments panel.
 */
export function varEditTarget(varName: string, x: number, y: number): VarEditTarget {
  const store = useEnvironmentsStore.getState()
  let env = store.activeEnvId ? store.environments.find((e) => e.id === store.activeEnvId) : undefined
  if (!env) {
    env = store.addEnvironment('Development')
    store.setActiveEnv(env.id)
  }
  return { varName, envId: env.id, x, y }
}

/** Small floating editor for a single environment variable, anchored at a click. */
export function VarEditPopover({ target, onClose }: { target: VarEditTarget; onClose: () => void }) {
  const tr = useUiTranslation()
  const popoverRef = useRef<HTMLDivElement>(null)
  const environments = useEnvironmentsStore((s) => s.environments)
  const updateVariables = useEnvironmentsStore((s) => s.updateVariables)

  const env = environments.find((e) => e.id === target.envId)
  const existing = env?.variables.find((variable) => variable.key === target.varName)
  const [value, setValue] = useState(existing?.value ?? '')

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (popoverRef.current?.contains(event.target as Node)) return
      onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [onClose])

  const save = () => {
    // Re-read from the store: the environment may have just been created.
    const current = useEnvironmentsStore.getState().environments.find((e) => e.id === target.envId)
    if (!current) { onClose(); return }
    // Reuse the blank row a fresh environment starts with instead of leaving it behind.
    const row = current.variables.find((variable) => variable.key === target.varName)
      ?? current.variables.find((variable) => !variable.key.trim() && !variable.value)
    const variables: EnvVariable[] = row
      ? current.variables.map((variable) => (
          variable.id === row.id ? { ...variable, key: target.varName, value, enabled: true } : variable
        ))
      : [...current.variables, { id: uid(), key: target.varName, value, enabled: true, type: 'text' }]
    updateVariables(current.id, variables)
    onClose()
  }

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[10000] w-80 rounded-md border border-border-2 bg-surface-1 p-2 shadow-xl"
      style={{
        left: Math.min(target.x, window.innerWidth - 336),
        top: Math.min(target.y + 8, window.innerHeight - 136),
      }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-accent">
          {`{{${target.varName}}}`}
        </span>
        <span className="text-[9px] uppercase tracking-wide text-text-4">
          {existing ? tr('Edit env') : tr('Create env')}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save()
            if (event.key === 'Escape') onClose()
          }}
          placeholder={tr('Environment value')}
          className="h-7 min-w-0 flex-1 rounded border border-border-2 bg-surface-2 px-2 font-mono text-xs text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
        />
        <button
          onClick={save}
          className="h-7 rounded bg-accent px-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
        >
          {tr('Save')}
        </button>
      </div>
      <div className="mt-1.5 truncate text-[10px] text-text-4">
        {env?.name ?? tr('Active environment')}
      </div>
    </div>,
    document.body,
  )
}

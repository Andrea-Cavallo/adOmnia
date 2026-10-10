import { lazy, Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEnvironmentsStore } from '@/stores/environments'

const EnvModal = lazy(() => import('./EnvModal').then((module) => ({ default: module.EnvModal })))

/** Opens the environment manager from anywhere (Hub, collections, palette): dispatch `adomnia:open-environments`. */
export function openEnvironmentManager(): void {
  document.dispatchEvent(new CustomEvent('adomnia:open-environments'))
}

export function EnvironmentManagerHost() {
  const [open, setOpen] = useState(false)
  const env = useEnvironmentsStore()
  useEffect(() => {
    const show = () => setOpen(true)
    document.addEventListener('adomnia:open-environments', show)
    return () => document.removeEventListener('adomnia:open-environments', show)
  }, [])
  if (!open) return null
  return createPortal(
    <Suspense fallback={null}>
      <EnvModal
        environments={env.environments}
        activeEnvId={env.activeEnvId}
        onClose={() => setOpen(false)}
        onAdd={(name) => env.addEnvironment(name)}
        onDelete={env.deleteEnvironment}
        onRename={env.renameEnvironment}
        onUpdateVars={env.updateVariables}
        onSetPrivate={env.setEnvironmentPrivate}
      />
    </Suspense>,
    document.body,
  )
}

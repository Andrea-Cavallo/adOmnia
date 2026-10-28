import { logBackgroundError } from '@/lib/code-studio/backgroundError'
import * as GoIDEBindings from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/goide'
import { useEnvironmentsStore } from '@/stores/environments'
import { isVaultRef, resolveVaultReferences } from '@/lib/vaultRefs'

// Keeps Code Studio runs in sync with the active adOmnia environment: its enabled
// variables become process environment for every run (run entries still win).
let started = false

async function push(): Promise<void> {
  const vars = useEnvironmentsStore.getState().getResolvedVars()
  let resolved: Record<string, string>
  try {
    resolved = await resolveVaultReferences(vars)
  } catch {
    // Vault locked: pass the plain variables, never the encrypted references.
    resolved = Object.fromEntries(Object.entries(vars).filter(([, value]) => !isVaultRef(value)))
  }
  await GoIDEBindings.SetSharedEnvironment(resolved)
}

export function startSharedEnvironmentSync(): void {
  if (started) return
  started = true
  void push().catch(logBackgroundError('environment sync'))
  useEnvironmentsStore.subscribe((state, previous) => {
    if (state.environments !== previous.environments || state.activeEnvId !== previous.activeEnvId) void push().catch(logBackgroundError('environment sync'))
  })
}

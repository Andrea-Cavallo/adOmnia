import { createContext, useContext } from 'react'
import type { FlowGraphDefinition } from '@/lib/flowStorage'
import { useEnvironmentsStore } from '@/stores/environments'

/**
 * Extra `{{vars}}` visible to editors rendered inside a scope (e.g. a Flow step),
 * layered over the active environment. Null outside any scope.
 */
export const ScopedVarsContext = createContext<Record<string, string> | null>(null)

/** Placeholder value of a flow variable whose real value is only known after a run. */
export const FLOW_PENDING_PREFIX = '‹extracted by '

/** Env vars + scope vars, for highlighting and "unresolved" hints. */
export function useScopedResolvedVars(): { resolvedVars: Record<string, string>; hasActiveEnv: boolean } {
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const scope = useContext(ScopedVarsContext)
  const envVars = getResolvedVars()
  if (!scope || Object.keys(scope).length === 0) return { resolvedVars: envVars, hasActiveEnv: activeEnvId !== null }
  return { resolvedVars: { ...envVars, ...scope }, hasActiveEnv: true }
}

/**
 * Variables a Flow step can reference: every other step's extractions (value from
 * the last run when known, otherwise a label naming the producer) plus run vars.
 * ponytail: ignores graph order, a step may reference a later producer; add
 * reachability when that misleads anyone.
 */
export function flowScopeVars(graph: FlowGraphDefinition, nodeId: string, runVars: Record<string, string>): Record<string, string> {
  const scope: Record<string, string> = { ...runVars }
  for (const node of graph.nodes) {
    if (node.id === nodeId) continue
    for (const mapping of node.config.extractions ?? []) {
      const name = mapping.name.trim()
      if (name && !scope[name]) scope[name] = `${FLOW_PENDING_PREFIX}${node.label}›`
    }
  }
  return scope
}

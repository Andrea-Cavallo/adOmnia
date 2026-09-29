import { showEntityNotice } from './notice'
import type { EntityKind, EntityRef, Opener } from './types'

const openers = new Map<EntityKind | '*', Opener[]>()

export function registerOpener(kind: EntityKind | '*', opener: Opener): () => void {
  openers.set(kind, [...(openers.get(kind) ?? []), opener])
  return () => openers.set(kind, (openers.get(kind) ?? []).filter((o) => o !== opener))
}

export function actionsFor(ref: EntityRef): Opener[] {
  return [...(openers.get(ref.kind) ?? []), ...(openers.get('*') ?? [])]
    .filter((opener) => opener.available?.(ref) ?? true)
}

export async function openEntity(ref: EntityRef, intent?: string): Promise<void> {
  const actions = actionsFor(ref)
  const opener = intent
    ? actions.find((action) => action.intent === intent)
    : actions.find((action) => action.isDefault) ?? actions[0]
  if (!opener) {
    showEntityNotice(`Nothing can open ${ref.label} yet.`)
    return
  }
  try {
    await opener.run(ref)
  } catch (error) {
    showEntityNotice(`${opener.title} failed for ${ref.label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Test helper. */
export function clearOpeners(): void {
  openers.clear()
}

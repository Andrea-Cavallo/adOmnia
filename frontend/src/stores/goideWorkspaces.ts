import {
  activateGoIDEStudioWorkspace, createGoIDEStudioWorkspace, deleteGoIDEStudioWorkspace, renameGoIDEStudioWorkspace,
  type GoIDEStudioWorkspaces,
} from '@/lib/goide-workspaces-api'
import { sessionsInWorkspace, useGoIDEStore } from './goide'

/** Ultimo progetto attivo per workspace, così tornando a un workspace si ritrova dove si era. */
const lastSessionByWorkspace: Record<string, string> = {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function applyWorkspaces(state: GoIDEStudioWorkspaces): void {
  useGoIDEStore.setState({ studioWorkspaces: state.workspaces, activeWorkspaceId: state.activeId })
}

/** Porta in primo piano il progetto giusto del workspace attivo, o nessuno se il workspace è vuoto. */
async function showActiveWorkspace(): Promise<void> {
  const store = useGoIDEStore.getState()
  const visible = sessionsInWorkspace(store.sessions, store.activeWorkspaceId)
  const remembered = lastSessionByWorkspace[store.activeWorkspaceId]
  const next = visible.find((session) => session.id === remembered) ?? visible[0] ?? null
  if (!next) return useGoIDEStore.setState({ activeSessionId: null })
  await store.selectSession(next.id)
}

async function run(action: () => Promise<GoIDEStudioWorkspaces>, afterApply = showActiveWorkspace): Promise<boolean> {
  const { activeWorkspaceId, activeSessionId } = useGoIDEStore.getState()
  if (activeSessionId) lastSessionByWorkspace[activeWorkspaceId] = activeSessionId
  try {
    applyWorkspaces(await action())
    await afterApply()
    return true
  } catch (error) {
    useGoIDEStore.setState({ error: errorMessage(error) })
    return false
  }
}

/** Cambia workspace Go Studio: i progetti degli altri restano aperti, con i loro processi. */
export function switchGoStudioWorkspace(id: string): Promise<boolean> {
  if (id === useGoIDEStore.getState().activeWorkspaceId) return Promise.resolve(true)
  return run(() => activateGoIDEStudioWorkspace(id))
}

/** Crea un workspace vuoto e ci entra, pronto per aprire progetti. */
export function createGoStudioWorkspace(name: string): Promise<boolean> {
  return run(() => createGoIDEStudioWorkspace(name))
}

export function renameGoStudioWorkspace(id: string, name: string): Promise<boolean> {
  return run(() => renameGoIDEStudioWorkspace(id, name), async () => undefined)
}

/** Elimina un workspace senza progetti aperti; il backend rifiuta gli altri. */
export function deleteGoStudioWorkspace(id: string): Promise<boolean> {
  delete lastSessionByWorkspace[id]
  return run(() => deleteGoIDEStudioWorkspace(id))
}

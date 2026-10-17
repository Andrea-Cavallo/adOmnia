import {
  activateGoIDEStudioWorkspace, createGoIDEStudioWorkspace, deleteGoIDEStudioWorkspace, renameGoIDEStudioWorkspace,
  type GoIDEStudioWorkspaces,
} from '@/lib/code-studio-workspaces-api'
import { sessionsInWorkspace, useCodeStudioStore } from './codeStudio'

/** Ultimo progetto attivo per workspace, così tornando a un workspace si ritrova dove si era. */
const lastSessionByWorkspace: Record<string, string> = {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function applyWorkspaces(state: GoIDEStudioWorkspaces): void {
  useCodeStudioStore.setState({ studioWorkspaces: state.workspaces, activeWorkspaceId: state.activeId })
}

/** Porta in primo piano il progetto giusto del workspace attivo, o nessuno se il workspace è vuoto. */
async function showActiveWorkspace(): Promise<void> {
  const store = useCodeStudioStore.getState()
  const visible = sessionsInWorkspace(store.sessions, store.activeWorkspaceId)
  const remembered = lastSessionByWorkspace[store.activeWorkspaceId]
  const next = visible.find((session) => session.id === remembered) ?? visible[0] ?? null
  if (!next) return useCodeStudioStore.setState({ activeSessionId: null })
  await store.selectSession(next.id)
}

async function run(action: () => Promise<GoIDEStudioWorkspaces>, afterApply = showActiveWorkspace): Promise<boolean> {
  const { activeWorkspaceId, activeSessionId } = useCodeStudioStore.getState()
  if (activeSessionId) lastSessionByWorkspace[activeWorkspaceId] = activeSessionId
  try {
    applyWorkspaces(await action())
    await afterApply()
    return true
  } catch (error) {
    useCodeStudioStore.setState({ error: errorMessage(error) })
    return false
  }
}

/** Cambia workspace Code Studio: i progetti degli altri restano aperti, con i loro processi. */
export function switchCodeStudioWorkspace(id: string): Promise<boolean> {
  if (id === useCodeStudioStore.getState().activeWorkspaceId) return Promise.resolve(true)
  return run(() => activateGoIDEStudioWorkspace(id))
}

/** Crea un workspace vuoto e ci entra, pronto per aprire progetti. */
export function createCodeStudioWorkspace(name: string): Promise<boolean> {
  return run(() => createGoIDEStudioWorkspace(name))
}

export function renameCodeStudioWorkspace(id: string, name: string): Promise<boolean> {
  return run(() => renameGoIDEStudioWorkspace(id, name), async () => undefined)
}

/** Elimina un workspace senza progetti aperti; il backend rifiuta gli altri. */
export function deleteCodeStudioWorkspace(id: string): Promise<boolean> {
  delete lastSessionByWorkspace[id]
  return run(() => deleteGoIDEStudioWorkspace(id))
}

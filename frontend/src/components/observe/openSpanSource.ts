import { relativeToRoots } from '@/lib/sourcePaths'

/** Open the span's code in Go Studio: inside an open project when possible, else as an external file. */
export async function openSpanSource(file: string, line: number): Promise<void> {
  const [{ useGoIDEStore }, { useAppStore }] = await Promise.all([import('@/stores/goide'), import('@/stores/app')])
  const store = useGoIDEStore.getState()
  const match = relativeToRoots(file, store.sessions.map((session) => ({ id: session.id, root: session.project.rootPath })))
  useAppStore.getState().setActiveRail('goide')
  if (match) {
    if (store.activeSessionId !== match.sessionId) await store.selectSession(match.sessionId)
    await useGoIDEStore.getState().openLocation(match.relativePath, line, 1)
  } else {
    await store.openExternalLocation(file, line, 1)
  }
}

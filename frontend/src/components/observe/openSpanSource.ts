import { relativeToRoots } from '@/lib/sourcePaths'

type Sessions = ReadonlyArray<{ id: string; project: { rootPath: string } }>

/** The project file of a span: absolute paths by project root; a relative path (some SDKs report one) in the active project. */
function projectFile(file: string, sessions: Sessions, activeSessionId: string | null): { sessionId: string; relativePath: string } | null {
  const match = relativeToRoots(file, sessions.map((session) => ({ id: session.id, root: session.project.rootPath })))
  if (match) return match
  const relative = !/^([a-z]:)?[\\/]/i.test(file)
  const sessionId = activeSessionId ?? (sessions.length === 1 ? sessions[0].id : null)
  return relative && sessionId ? { sessionId, relativePath: file.replace(/\\/g, '/').replace(/^\.\//, '') } : null
}

/** Open the span's code in Code Studio: inside an open project when possible, else as an external file. */
export async function openSpanSource(file: string, line: number): Promise<void> {
  const [{ useCodeStudioStore }, { useAppStore }] = await Promise.all([import('@/stores/codeStudio'), import('@/stores/app')])
  const store = useCodeStudioStore.getState()
  const match = projectFile(file, store.sessions, store.activeSessionId)
  useAppStore.getState().setActiveRail('goide')
  if (match) {
    if (store.activeSessionId !== match.sessionId) await store.selectSession(match.sessionId)
    await useCodeStudioStore.getState().openLocation(match.relativePath, line, 1)
  } else {
    await store.openExternalLocation(file, line, 1)
  }
}

/**
 * Trace → debugger: a breakpoint on the span's line in the project that owns the file, so the next
 * request through that service stops there (under Debug, or with Debug Request from the API client).
 * Returns what happened, for the caller to show.
 */
export async function breakAtSpanSource(file: string, line: number): Promise<string> {
  const [{ useCodeStudioStore }, { useCodeStudioDebugStore }] = await Promise.all([import('@/stores/codeStudio'), import('@/stores/codeStudioDebug')])
  const store = useCodeStudioStore.getState()
  if (!store.initialized) await store.initialize()
  const current = useCodeStudioStore.getState()
  const match = projectFile(file, current.sessions, current.activeSessionId)
  if (!match) return 'Open the project of this service in Code Studio to set a breakpoint in it.'
  const debug = useCodeStudioDebugStore.getState()
  const already = (debug.breakpoints[match.sessionId]?.[match.relativePath] ?? []).some((item) => item.line === line)
  if (!already) await debug.toggleBreakpoint(match.sessionId, match.relativePath, line)
  await openSpanSource(file, line)
  return `Breakpoint on ${match.relativePath}:${line}: the next request through this service stops there when it runs under the debugger.`
}

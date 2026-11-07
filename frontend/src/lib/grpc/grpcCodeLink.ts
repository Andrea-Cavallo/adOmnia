/**
 * From a gRPC call to the Go method that serves it, like "Go to handler" for a REST request. It reads the
 * architecture Code Studio already analyzed (the type passed to RegisterXServer and its method); it never
 * starts an analysis. Code Studio modules load on demand, so the API workspace stays light.
 */

export interface GrpcHandlerLink {
  sessionId: string
  name: string
  relativePath: string
  line: number
}

/** The handler of service/method in any open Code Studio project, or null. */
export async function findGrpcHandler(service: string, method: string): Promise<GrpcHandlerLink | null> {
  if (!service || !method) return null
  const [{ useCodeStudioStore }, { cachedArchitecture }, { goHandlerFor }] = await Promise.all([
    import('@/stores/codeStudio'),
    import('@/lib/code-studio/architectureCache'),
    import('@/lib/code-studio/protoLinks'),
  ])
  // Code finds services by the Go registration name: Greeter for helloworld.Greeter.
  const shortName = service.split('.').pop() ?? service
  for (const session of useCodeStudioStore.getState().sessions) {
    const report = cachedArchitecture(session.id)?.report
    const handler = report ? goHandlerFor(report, shortName, method) ?? goHandlerFor(report, service, method) : null
    if (handler) return { sessionId: session.id, name: handler.name, relativePath: handler.site.relativePath, line: handler.site.line }
  }
  return null
}

/** Opens the handler in Code Studio at its line. */
export async function openGrpcHandler(link: GrpcHandlerLink): Promise<void> {
  const [{ useCodeStudioStore }, { useAppStore }] = await Promise.all([import('@/stores/codeStudio'), import('@/stores/app')])
  // The handler is in the project that declares it, which may not be the one in front.
  if (useCodeStudioStore.getState().activeSessionId !== link.sessionId) await useCodeStudioStore.getState().selectSession(link.sessionId)
  useAppStore.getState().setActiveRail('codestudio')
  await useCodeStudioStore.getState().openLocation(link.relativePath, link.line || 1)
}

/**
 * From a gRPC call to the method that serves it, like "Go to handler" for a REST request: Go from the
 * architecture Code Studio already analyzed (it never starts an analysis), Rust from the detected tonic impls.
 * Code Studio modules load on demand, so the API workspace stays light.
 */

export interface GrpcHandlerLink {
  sessionId: string
  name: string
  /** "go", "rust"…: shown next to the method name. */
  language: string
  relativePath: string
  line: number
}

/**
 * The handler of service/method in any open Code Studio project, or null: a Go method from the architecture
 * analysis Code Studio already ran, or the method a detected grpc entity names (Rust tonic).
 */
export async function findGrpcHandler(service: string, method: string): Promise<GrpcHandlerLink | null> {
  if (!service || !method) return null
  const [{ useCodeStudioStore }, { cachedArchitecture }, { goHandlerFor, entityHandlerFor }, { useDevContextStore }] = await Promise.all([
    import('@/stores/codeStudio'),
    import('@/lib/code-studio/architectureCache'),
    import('@/lib/code-studio/protoLinks'),
    import('@/stores/devcontext'),
  ])
  // Code finds services by their registration name: Greeter for helloworld.Greeter.
  const shortName = service.split('.').pop() ?? service
  for (const session of useCodeStudioStore.getState().sessions) {
    const report = cachedArchitecture(session.id)?.report
    const goHandler = report ? goHandlerFor(report, shortName, method) ?? goHandlerFor(report, service, method) : null
    if (goHandler) return { sessionId: session.id, name: goHandler.name, language: 'go', relativePath: goHandler.site.relativePath, line: goHandler.site.line }
    // oxlint-disable-next-line eslint/no-await-in-loop -- projects are few; the first one that serves the rpc wins
    await useDevContextStore.getState().ensure(session.id).catch(() => undefined)
    const other = entityHandlerFor(useDevContextStore.getState().snapshots[session.id]?.entities ?? [], service, method)
    if (other) return { sessionId: session.id, name: other.name, language: other.language, relativePath: other.site.relativePath, line: other.site.line }
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

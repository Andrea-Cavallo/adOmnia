import { monaco } from '@/lib/monacoSetup'
import { useGoIDEStore } from '@/stores/goide'
import { handoffToPanel } from '@/lib/entities/dispatch'
import { architectureFor, cachedArchitecture } from '@/lib/goide/architectureCache'
import { goHandlerFor, protoRpcs, type ProtoRpc } from '@/lib/goide/protoLinks'
import { documentForModel } from './goStudioLanguageFeatures'
import { openArchSite } from './GoStudioInterfaceExplorer'

// .proto → Go: on every rpc, the Go method that serves it, Debug and a call in the gRPC client.
const LANGUAGE = 'proto'
const HANDLER_COMMAND = 'goStudio.protoHandler'
const CALL_COMMAND = 'goStudio.protoCall'
const DEBUG_COMMAND = 'goStudio.protoDebug'
const LINK_COMMAND = 'goStudio.protoLink'

let registered = false
const changed = new monaco.Emitter<monaco.languages.CodeLensProvider>()

function lens(line: number, id: string, title: string, tooltip: string, args: unknown[]): monaco.languages.CodeLens {
  return { range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, command: { id, title, tooltip, arguments: args } }
}

function lensesFor(sessionId: string, documentId: string, text: string): monaco.languages.CodeLens[] {
  const rpcs = protoRpcs(text)
  if (!rpcs.length) return []
  const report = cachedArchitecture(sessionId)?.report
  const out: monaco.languages.CodeLens[] = []
  if (!report) out.push(lens(rpcs[0].line, LINK_COMMAND, 'Link rpcs to Go handlers', 'Analyze the project (nothing runs) to find the Go method serving each rpc', [sessionId]))
  for (const rpc of rpcs) {
    const handler = report ? goHandlerFor(report, rpc.service, rpc.method) : null
    if (handler) {
      out.push(lens(rpc.line, HANDLER_COMMAND, `→ ${handler.name}`, `${handler.site.relativePath}:${handler.site.line}`, [sessionId, rpc.service, rpc.method]))
      out.push(lens(rpc.line, DEBUG_COMMAND, 'Debug', 'Breakpoint in the Go handler, run under Delve, then call the rpc from the gRPC client', [sessionId, documentId, rpc.service, rpc.method]))
    } else if (report) {
      out.push(lens(rpc.line, HANDLER_COMMAND, 'No Go handler', 'No RegisterXServer type implements this rpc in this project', [sessionId, rpc.service, rpc.method]))
    }
    out.push(lens(rpc.line, CALL_COMMAND, 'Call in gRPC client', 'Load this .proto in the gRPC client with the rpc selected', [documentId, rpc.service, rpc.method]))
  }
  return out
}

function handlerOf(sessionId: string, service: string, method: string) {
  const report = cachedArchitecture(sessionId)?.report
  return report ? goHandlerFor(report, service, method) : null
}

function callInClient(documentId: string, rpc: Pick<ProtoRpc, 'service' | 'method'>, address?: string): void {
  const document = useGoIDEStore.getState().documents.find((item) => item.document.id === documentId)
  if (!document) return
  const name = document.document.relativePath.split('/').pop() ?? 'contract.proto'
  handoffToPanel('grpc', { kind: 'contract', id: `proto:${document.document.relativePath}`, label: name, attrs: { type: 'proto', path: document.document.relativePath } }, 'open',
    { text: document.buffer, name, service: rpc.service, method: rpc.method, ...(address ? { address } : {}) })
}

/** The port the debugged service listens on, once the live session has detected it (up to 10 s). */
async function livePort(liveId: string): Promise<number | undefined> {
  const { useDevSessionStore } = await import('@/stores/devSession')
  for (let i = 0; i < 40; i++) {
    const port = useDevSessionStore.getState().sessions[liveId]?.port
    if (port) return port
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return undefined
}

/** Registra i CodeLens dei file .proto, una sola volta per processo. */
export function registerGoStudioProtoLens(): void {
  if (registered) return
  registered = true
  monaco.editor.registerCommand(LINK_COMMAND, (_accessor, sessionId: string) => {
    void architectureFor(sessionId).then(() => changed.fire(provider), () => undefined)
  })
  monaco.editor.registerCommand(HANDLER_COMMAND, (_accessor, sessionId: string, service: string, method: string) => {
    const handler = handlerOf(sessionId, service, method)
    if (handler) openArchSite(handler.site)
  })
  monaco.editor.registerCommand(CALL_COMMAND, (_accessor, documentId: string, service: string, method: string) => callInClient(documentId, { service, method }))
  monaco.editor.registerCommand(DEBUG_COMMAND, (_accessor, sessionId: string, documentId: string, service: string, method: string) => {
    const handler = handlerOf(sessionId, service, method)
    if (!handler) return
    void (async () => {
      const { debugGoAt } = await import('@/lib/devsession/debugMessage')
      const live = await debugGoAt({ goSessionId: sessionId, relativePath: handler.site.relativePath, line: handler.site.line })
      const port = await livePort(live.id)
      callInClient(documentId, { service, method }, port ? `127.0.0.1:${port}` : undefined)
    })()
  })
  const provider: monaco.languages.CodeLensProvider = {
    onDidChange: changed.event,
    provideCodeLenses: (model) => {
      const document = documentForModel(model)
      if (!document || document.document.external) return { lenses: [], dispose: () => undefined }
      return { lenses: lensesFor(document.document.sessionId, document.document.id, model.getValue()), dispose: () => undefined }
    },
  }
  monaco.languages.registerCodeLensProvider(LANGUAGE, provider)
}

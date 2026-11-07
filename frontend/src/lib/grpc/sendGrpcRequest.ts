/**
 * Sends a gRPC request item through the sidecar and returns it as a ResponseData, so the shared pipeline
 * (scripts, Response panel, history, Flow recording, Flows) treats a gRPC call like any request. A call that
 * reaches a running dev session is registered with it (correlation id, traceparent) like an HTTP request.
 */
import { beginGrpcCapture, endGrpcCapture } from '@/lib/devsession/grpcCapture'
import type { RequestItem, ResponseData } from '@/lib/types'
import { invokeGrpc } from './grpcApi'
import { grpcCallBody, grpcStatusName, responseFromCall } from './grpcRequest'

function failed(code: string, message: string, ms = 0): ResponseData {
  return { status: 0, statusText: '', headers: {}, body: '', contentType: '', ms, size: 0, error: { code, message } }
}

export async function sendGrpcRequest(request: RequestItem, vars: Record<string, string>, signal?: AbortSignal): Promise<ResponseData> {
  let body
  try {
    body = grpcCallBody(request, vars)
  } catch (error) {
    return failed('GRPC_REQUEST', error instanceof Error ? error.message : String(error))
  }
  const started = performance.now()
  const capture = await beginGrpcCapture(body.address, body.service, body.method, body.tls, body.metadata ?? {}).catch(() => null)
  try {
    const result = await invokeGrpc({ ...body, metadata: capture?.metadata ?? body.metadata }, signal)
    if (capture) void endGrpcCapture(capture.run, grpcStatusName(result.status), performance.now() - started, result.error ?? '')
    return responseFromCall(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (capture) void endGrpcCapture(capture.run, 'UNAVAILABLE', performance.now() - started, message)
    return failed(signal?.aborted ? 'ABORTED' : 'GRPC_UNAVAILABLE', message, Math.round(performance.now() - started))
  }
}

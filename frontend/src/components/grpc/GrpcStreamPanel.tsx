/** The right half of a streaming gRPC tab: the messages as they arrive, on the shared frame view. */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { RPC_KIND_LABEL } from '@/lib/grpc/grpcSchema'
import { idleStream, useGrpcStreams, type GrpcStreamStatus } from '@/stores/grpcStreams'
import { FrameStreamView, useUptime } from '@/components/websocket/FrameStreamView'

const IDLE = idleStream()

const STATE_LABEL: Record<GrpcStreamStatus, string> = { idle: 'Idle', running: 'Streaming…', done: 'Completed', error: 'Failed' }
const STATE_DOT: Record<GrpcStreamStatus, string> = {
  idle: 'bg-text-4',
  running: 'bg-accent motion-safe:animate-pulse',
  done: 'bg-success',
  error: 'bg-error',
}

export function GrpcStreamPanel({ tabId, headerActions }: { tabId: string; headerActions?: ReactNode }) {
  const stream = useGrpcStreams((state) => state.byTab[tabId]) ?? IDLE
  const clear = useGrpcStreams((state) => state.clear)
  const uptime = useUptime(stream.status === 'running' ? stream.startedAt : null)
  const headers = Object.keys(stream.headers).length + Object.keys(stream.trailers).length
  return (
    <FrameStreamView
      title="Stream"
      exportName="grpc-stream"
      frames={stream.frames}
      onClear={() => clear(tabId)}
      emptyHint="Start the stream from the bar above. For a client or bidi stream, send more messages while it is open."
      headerActions={headerActions}
      state={(
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-text-3" data-grpc-stream={stream.status}>
          <span className={cn('h-1.5 w-1.5 rounded-full', STATE_DOT[stream.status])} />
          {stream.status === 'error' && stream.grpcStatus ? stream.grpcStatus : STATE_LABEL[stream.status]}
          {uptime && ` · ${uptime}`}
          {stream.status !== 'running' && stream.timeMs > 0 && ` · ${stream.timeMs} ms`}
        </span>
      )}
      headerExtra={(
        <>
          <span className="shrink-0 rounded bg-surface-3 px-1.5 text-[10px] text-text-3">{RPC_KIND_LABEL[stream.kind]}</span>
          {headers > 0 && (
            <span
              className="hidden shrink-0 font-mono text-[10px] text-text-4 md:inline"
              title={[...Object.entries(stream.headers).map(([key, value]) => `${key}: ${value}`), ...Object.entries(stream.trailers).map(([key, value]) => `trailer ${key}: ${value}`)].join('\n')}
            >
              {headers} metadata
            </span>
          )}
        </>
      )}
    />
  )
}

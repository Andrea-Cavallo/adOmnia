/** Load test of the selected unary rpc: N calls with a concurrency, latency percentiles and error rate. */
import { useState } from 'react'
import { Gauge, Loader2 } from 'lucide-react'
import type { RequestItem } from '@/lib/types'
import { grpcPost } from '@/lib/grpc/grpcApi'
import { grpcCallBody } from '@/lib/grpc/grpcRequest'
import { MiniButton, NumberField, SectionBlock } from '@/components/websocket/wsUi'

const MAX_CONCURRENCY = 50
const MAX_REQUESTS = 5000
const MAX_TIMEOUT_MS = 60_000

interface LoadResult {
  totalRequests: number
  successful: number
  failed: number
  totalTimeMs: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
  throughput: number
  errorRate: number
}

export function GrpcLoadSection({ request, vars }: { request: RequestItem; vars: Record<string, string> }) {
  const [concurrency, setConcurrency] = useState(5)
  const [total, setTotal] = useState(100)
  const [timeoutMs, setTimeoutMs] = useState(5000)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<LoadResult | null>(null)

  const run = async () => {
    setRunning(true)
    setError('')
    setResult(null)
    try {
      const body = grpcCallBody(request, vars)
      setResult(await grpcPost<LoadResult>('/loadtest/grpc', {
        address: body.address, service: body.service, method: body.method, payload: JSON.stringify(body.payload ?? {}),
        tls: body.tls, caCertPath: body.ca_cert_path, clientCertPath: body.client_cert_path, clientKeyPath: body.client_key_path,
        metadata: body.metadata, descriptors: body.descriptors, concurrency, totalReqs: total, timeoutMs,
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRunning(false)
    }
  }

  const metrics: Array<[string, string]> = result ? [
    ['Requests', `${result.successful}/${result.totalRequests} ok`], ['Error rate', `${result.errorRate}%`], ['Throughput', `${result.throughput}/s`],
    ['Average', `${result.avgMs} ms`], ['p50', `${result.p50Ms} ms`], ['p95', `${result.p95Ms} ms`], ['p99', `${result.p99Ms} ms`], ['Max', `${result.maxMs} ms`],
  ] : []
  return (
    <SectionBlock title="Load test" hint="Calls the selected rpc many times with the current message, metadata and schema. Unary methods only." right={<MiniButton onClick={() => void run()} disabled={running}>{running ? <Loader2 size={12} className="animate-spin" /> : <Gauge size={12} />} {running ? 'Running…' : 'Run'}</MiniButton>}>
      <div className="flex flex-wrap items-center gap-4">
        <NumberField label="Calls" value={total} max={MAX_REQUESTS} onChange={setTotal} />
        <NumberField label="Concurrency" value={concurrency} max={MAX_CONCURRENCY} onChange={setConcurrency} />
        <NumberField label="Timeout" min={100} value={timeoutMs} max={MAX_TIMEOUT_MS} onChange={setTimeoutMs} suffix="ms" />
      </div>
      {error && <p className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-error">{error}</p>}
      {result && (
        <dl className="mt-3 grid grid-cols-4 gap-2">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded border border-border-2 bg-surface-0 px-2 py-1.5">
              <dt className="text-[10px] uppercase tracking-wide text-text-4">{label}</dt>
              <dd className="font-mono text-[12px] text-text-1">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </SectionBlock>
  )
}

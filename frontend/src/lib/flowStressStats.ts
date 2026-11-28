import type { FlowRunStatus } from '@/lib/flowStorage'

/** One executed request inside a stress run. */
export interface StressSample {
  /** ms since the run started, taken when the request finished */
  t: number
  vu: number
  iteration: number
  nodeId: string
  step: string
  status: FlowRunStatus
  httpStatus?: number
  /** HTTP time measured by the Go executor — the backend figure */
  latencyMs?: number
  /** Whole step time: IPC, scripts, retries included */
  stepMs: number
  bytes?: number
  error?: string
  phase?: string
  measured?: boolean
}

export interface StepStats {
  nodeId: string
  step: string
  count: number
  errors: number
  errorPct: number
  min: number
  avg: number
  p50: number
  p90: number
  p95: number
  p99: number
  max: number
  statuses: Record<string, number>
}

export interface LatencyStats {
  min: number
  avg: number
  p50: number
  p90: number
  p95: number
  p99: number
  max: number
}

export interface StressErrorGroup {
  fingerprint: string
  count: number
  steps: string[]
  statuses: string[]
}

export interface StressStats {
  totalRequests: number
  totalErrors: number
  excludedRequests: number
  iterationsOk: number
  iterationsFailed: number
  elapsedMs: number
  measuredElapsedMs: number
  rps: number
  bytes: number
  bytesPerSecond: number
  overall: LatencyStats
  statuses: Record<string, number>
  errorGroups: StressErrorGroup[]
  steps: StepStats[]
  timeline: Array<{ s: number; requests: number; errors: number; activeVus?: number }>
  distribution: Array<{ fromMs: number; toMs: number; count: number; percentage: number; overflow?: boolean }>
  apdex: { thresholdMs: number; satisfied: number; tolerated: number; frustrated: number; score: number }
  slowestStep?: string
}

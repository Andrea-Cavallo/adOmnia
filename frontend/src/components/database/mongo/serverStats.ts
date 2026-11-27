import type { BsonDoc } from './bson'
import { numberValue } from './ui'

export const OP_KINDS = ['query', 'insert', 'update', 'delete', 'getmore', 'command'] as const
export type OpKind = typeof OP_KINDS[number]

export interface ServerSample {
  at: number
  ops: Record<OpKind, number>
  connections: number | null
  availableConnections: number | null
  bytesIn: number | null
  bytesOut: number | null
  residentMb: number | null
  uptimeSec: number | null
  version: string
}

export interface ServerRates {
  ops: Record<OpKind, number>
  totalOps: number
  bytesInPerSec: number | null
  bytesOutPerSec: number | null
}

const num = (doc: unknown, key: string): number | null =>
  doc && typeof doc === 'object' ? numberValue((doc as BsonDoc)[key]) : null

/** Reads the counters the Performance tab plots from a canonical serverStatus reply. */
export function readServerStatus(status: BsonDoc, at = Date.now()): ServerSample {
  const counters = status.opcounters as BsonDoc | undefined
  const ops = Object.fromEntries(OP_KINDS.map((k) => [k, num(counters, k) ?? 0])) as Record<OpKind, number>
  return {
    at,
    ops,
    connections: num(status.connections, 'current'),
    availableConnections: num(status.connections, 'available'),
    bytesIn: num(status.network, 'bytesIn'),
    bytesOut: num(status.network, 'bytesOut'),
    residentMb: num(status.mem, 'resident'),
    uptimeSec: numberValue(status.uptime),
    version: typeof status.version === 'string' ? status.version : '',
  }
}

/** Per-second rates between two samples; counters that went backwards (restart) count as 0. */
export function rates(prev: ServerSample, next: ServerSample): ServerRates {
  const secs = Math.max(0.001, (next.at - prev.at) / 1000)
  const per = (a: number | null, b: number | null) => (a == null || b == null ? null : Math.max(0, (b - a) / secs))
  const ops = Object.fromEntries(OP_KINDS.map((k) => [k, Math.max(0, (next.ops[k] - prev.ops[k]) / secs)])) as Record<OpKind, number>
  return {
    ops,
    totalOps: OP_KINDS.reduce((sum, k) => sum + ops[k], 0),
    bytesInPerSec: per(prev.bytesIn, next.bytesIn),
    bytesOutPerSec: per(prev.bytesOut, next.bytesOut),
  }
}

export interface RunningOp {
  opid: unknown
  op: string
  ns: string
  secs: number
  client: string
  desc: string
  command: string
}

/** Running operations from a currentOp reply, slowest first, without the monitoring call itself. */
export function readCurrentOps(reply: BsonDoc): RunningOp[] {
  const list = Array.isArray(reply.inprog) ? (reply.inprog as BsonDoc[]) : []
  return list
    .filter((o) => !(o.command && typeof o.command === 'object' && 'currentOp' in (o.command as BsonDoc)))
    .map((o) => ({
      opid: o.opid,
      op: String(o.op ?? ''),
      ns: String(o.ns ?? ''),
      secs: numberValue(o.secs_running) ?? 0,
      client: String(o.client ?? o.client_s ?? ''),
      desc: String(o.desc ?? ''),
      command: o.command ? JSON.stringify(o.command).slice(0, 300) : '',
    }))
    .sort((a, b) => b.secs - a.secs)
}
